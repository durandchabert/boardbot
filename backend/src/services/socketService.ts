import { Server as SocketServer, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import type { StickyNote, Participant } from '../../../shared/types.ts';
import { updateNote } from '../db/noteRepo.js';
import { getDeepgramService } from './deepgramService.js';

let instance: SocketService | null = null;

export function getSocketService(): SocketService | null {
  return instance;
}

export class SocketService {
  private io: SocketServer;

  constructor(httpServer: HttpServer, frontendUrl: string) {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
      maxHttpBufferSize: 1e6, // 1MB max for audio chunks
    });

    this.io.on('connection', (socket: Socket) => {
      console.log(`[Socket] Client connected: ${socket.id}`);

      let audioSessionId: string | null = null;

      socket.on('session:join', (data: { session_id: string }) => {
        socket.join(data.session_id);
        console.log(`[Socket] ${socket.id} joined session ${data.session_id}`);
      });

      // Audio streaming events
      socket.on('audio:start', (data: { session_id: string }) => {
        audioSessionId = data.session_id;
        console.log(`[Audio] ${socket.id} started audio for session ${audioSessionId}`);
        const dg = getDeepgramService();
        if (dg) {
          dg.startSession(audioSessionId);
        }
      });

      socket.on('audio:chunk', (data: ArrayBuffer) => {
        if (!audioSessionId) return;
        const dg = getDeepgramService();
        if (dg) {
          dg.sendAudioBuffer(audioSessionId, data);
        }
      });

      socket.on('audio:stop', () => {
        if (audioSessionId) {
          console.log(`[Audio] ${socket.id} stopped audio for session ${audioSessionId}`);
          const dg = getDeepgramService();
          if (dg) {
            dg.stopSession(audioSessionId);
          }
          audioSessionId = null;
        }
      });

      socket.on('note:validate', (data: { note_id: string }) => {
        const updated = updateNote(data.note_id, { status: 'validated' });
        if (updated) {
          this.emitNoteUpdated(updated.session_id, updated);
        }
      });

      socket.on('note:reject', (data: { note_id: string }) => {
        const updated = updateNote(data.note_id, { status: 'rejected' });
        if (updated) {
          this.emitNoteUpdated(updated.session_id, updated);
        }
      });

      socket.on('note:edit', (data: { note_id: string; text: string }) => {
        const updated = updateNote(data.note_id, { text: data.text });
        if (updated) {
          this.emitNoteUpdated(updated.session_id, updated);
        }
      });

      // User text instructions from the chat panel
      socket.on('bot:message', async (data: { message: string }) => {
        const sid = audioSessionId ?? [...socket.rooms].find(r => r !== socket.id) ?? null;
        if (!sid) return;

        console.log(`[Chat] User instruction: "${data.message}"`);

        // Process the instruction against recent notes
        const { getNotesBySession } = await import('../db/noteRepo.js');
        const { detectInstruction } = await import('./noteGenerator.js');
        const recentNotes = getNotesBySession(sid).slice(-10);

        const instruction = await detectInstruction(data.message, recentNotes);
        if (instruction.type !== 'none' && instruction.noteId) {
          const { updateNote: doUpdate, deleteNote: doDelete, createNote: doCreate } = await import('../db/noteRepo.js');

          if (instruction.type === 'correction' && instruction.correctedText) {
            const updated = doUpdate(instruction.noteId, { text: instruction.correctedText });
            if (updated) {
              this.emitNoteUpdated(sid, updated);
              this.emitBotLog(sid, `Corrigé : "${instruction.correctedText}"`);
            }
          } else if (instruction.type === 'recategorize' && instruction.newCategory) {
            const existing = recentNotes.find(n => n.note_id === instruction.noteId);
            if (existing) {
              doDelete(instruction.noteId);
              this.emitNoteDeleted(sid, instruction.noteId);
              const newNote = doCreate({
                session_id: sid,
                text: existing.text,
                author_participant_id: existing.author_participant_id,
                category: instruction.newCategory,
                position: { x: Math.random() * 600 + 50, y: Math.random() * 400 + 50 },
                source_utterance_id: existing.source_utterance_id,
              });
              this.emitNoteCreated(sid, newNote);
              this.emitBotLog(sid, `Déplacé "${existing.text}" → ${instruction.newCategory}`);
            }
          } else if (instruction.type === 'delete') {
            doDelete(instruction.noteId);
            this.emitNoteDeleted(sid, instruction.noteId);
            this.emitBotLog(sid, `Supprimé`);
          }
        } else {
          this.emitBotLog(sid, `Compris, mais je n'ai pas trouvé de post-it à modifier pour cette instruction.`);
        }
      });

      socket.on('disconnect', () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
        if (audioSessionId) {
          const dg = getDeepgramService();
          if (dg) {
            dg.stopSession(audioSessionId);
          }
        }
      });
    });

    instance = this;
  }

  emitNoteCreated(sessionId: string, note: StickyNote): void {
    this.io.to(sessionId).emit('note:created', { note });
  }

  emitNoteUpdated(sessionId: string, note: StickyNote): void {
    this.io.to(sessionId).emit('note:updated', { note });
  }

  emitNoteDeleted(sessionId: string, noteId: string): void {
    this.io.to(sessionId).emit('note:deleted', { note_id: noteId });
  }

  emitTranscriptLive(sessionId: string, speakerLabel: string, text: string, isFinal: boolean): void {
    this.io.to(sessionId).emit('transcript:live', {
      speaker_label: speakerLabel,
      text,
      is_final: isFinal,
    });
  }

  emitSessionEnded(sessionId: string): void {
    this.io.to(sessionId).emit('session:ended');
  }

  emitParticipantAdded(sessionId: string, participant: Participant): void {
    this.io.to(sessionId).emit('participant:added', { participant });
  }

  emitBotLog(sessionId: string, message: string): void {
    this.io.to(sessionId).emit('bot:log' as never, { message, timestamp: new Date().toISOString() });
  }
}
