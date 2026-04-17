import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { StickyNote, Participant } from '@boardbot/shared';
import type { LogEntry } from '../components/BotLogPanel.js';

interface TranscriptMessage {
  speaker_label: string;
  text: string;
  is_final: boolean;
}

export function useSocket(sessionId: string | undefined) {
  const socketRef = useRef<Socket | null>(null);
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [liveTranscript, setLiveTranscript] = useState<TranscriptMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const [noteCount, setNoteCount] = useState(0);
  const [botLogs, setBotLogs] = useState<LogEntry[]>([]);
  const [liveParticipants, setLiveParticipants] = useState<Participant[]>([]);

  useEffect(() => {
    if (!sessionId) return;

    const socket = io(window.location.origin, {
      transports: ['polling', 'websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('session:join', { session_id: sessionId });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('note:created', ({ note }: { note: StickyNote }) => {
      setNotes((prev) => [...prev, note]);
      setNoteCount((prev) => prev + 1);
    });

    socket.on('note:updated', ({ note }: { note: StickyNote }) => {
      setNotes((prev) => prev.map((n) => (n.note_id === note.note_id ? note : n)));
    });

    socket.on('note:deleted', ({ note_id }: { note_id: string }) => {
      setNotes((prev) => prev.filter((n) => n.note_id !== note_id));
    });

    socket.on('transcript:live', (data: TranscriptMessage) => {
      setLiveTranscript(data);
    });

    // Participant auto-détecté par le bot Recall.ai
    socket.on('participant:added', ({ participant }: { participant: Participant }) => {
      setLiveParticipants((prev) =>
        prev.some((p) => p.participant_id === participant.participant_id)
          ? prev
          : [...prev, participant]
      );
    });

    // Bot log events
    socket.on('bot:log', (data: { message: string; timestamp: string }) => {
      setBotLogs((prev) => [...prev, { ...data, type: 'bot' }]);
    });

    // Load existing notes
    fetch(`/api/sessions/${sessionId}/notes`)
      .then((res) => res.json())
      .then((existingNotes: StickyNote[]) => {
        setNotes(existingNotes);
        setNoteCount(existingNotes.length);
      })
      .catch(console.error);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId]);

  const validateNote = useCallback((noteId: string) => {
    socketRef.current?.emit('note:validate', { note_id: noteId });
  }, []);

  const rejectNote = useCallback((noteId: string) => {
    socketRef.current?.emit('note:reject', { note_id: noteId });
  }, []);

  const editNote = useCallback((noteId: string, text: string) => {
    socketRef.current?.emit('note:edit', { note_id: noteId, text });
  }, []);

  const sendBotMessage = useCallback((message: string) => {
    // Add to local logs as user message
    setBotLogs((prev) => [
      ...prev,
      { message, timestamp: new Date().toISOString(), type: 'user' },
    ]);
    // Send to backend for processing
    socketRef.current?.emit('bot:message' as never, { message });
  }, []);

  return {
    notes,
    liveTranscript,
    connected,
    noteCount,
    botLogs,
    liveParticipants,
    validateNote,
    rejectNote,
    editNote,
    sendBotMessage,
  };
}
