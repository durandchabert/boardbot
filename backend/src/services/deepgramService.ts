import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import type { LiveSchema } from '@deepgram/sdk';
import { v4 as uuid } from 'uuid';
import { detectIdea } from './ideaDetector.js';
import { generateNoteText, detectInstruction, reviewNotes } from './noteGenerator.js';
import { createNote, getNotesBySession, updateNote, deleteNote } from '../db/noteRepo.js';
import { getParticipantBySpeaker } from '../db/sessionRepo.js';
import { getSocketService } from './socketService.js';
import type { Utterance, NoteCategory, StickyNote } from '../../../shared/types.ts';

let instance: DeepgramService | null = null;

export function getDeepgramService(): DeepgramService | null {
  return instance;
}

// Position calculation for new notes
const LANE_X: Record<string, number> = {
  idea: 100,
  problem: 400,
  action: 700,
  question: 400,
};
const noteCountPerLane: Record<string, number> = { idea: 0, problem: 0, action: 0, question: 0 };

function getNextPosition(category: NoteCategory): { x: number; y: number } {
  const count = noteCountPerLane[category] ?? 0;
  noteCountPerLane[category] = count + 1;
  const col = count % 3;
  const row = Math.floor(count / 3);
  return {
    x: (LANE_X[category] ?? 100) + col * 200 + (Math.random() * 30 - 15),
    y: 80 + row * 140 + (Math.random() * 20 - 10),
  };
}

// Transcript buffer per session for periodic review
const transcriptBuffers = new Map<string, string>();
const reviewIntervals = new Map<string, ReturnType<typeof setInterval>>();

export class DeepgramService {
  private connections: Map<string, ReturnType<ReturnType<typeof createClient>['listen']['live']>> = new Map();
  private deepgramClient: ReturnType<typeof createClient> | null = null;

  constructor() {
    if (!process.env.DEEPGRAM_API_KEY) {
      console.warn('[Deepgram] No API key configured — audio processing disabled');
    } else {
      this.deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
    }
    instance = this;
  }

  startSession(sessionId: string, language: string = 'fr'): void {
    if (this.connections.has(sessionId)) return;
    if (!this.deepgramClient) {
      console.warn('[Deepgram] Cannot start session without API key');
      return;
    }

    const options: LiveSchema = {
      model: 'nova-2',
      language,
      smart_format: true,
      diarize: true,
      punctuate: true,
      interim_results: true,
      utterance_end_ms: 1500,
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
    };

    const connection = this.deepgramClient.listen.live(options);

    connection.on(LiveTranscriptionEvents.Open, () => {
      console.log(`[Deepgram] Connection opened for session ${sessionId}`);
    });

    connection.on(LiveTranscriptionEvents.Metadata, (data) => {
      console.log(`[Deepgram] Metadata:`, JSON.stringify(data).slice(0, 200));
    });

    connection.on(LiveTranscriptionEvents.Transcript, async (data) => {
      console.log(`[Deepgram] Transcript event received:`, JSON.stringify(data).slice(0, 300));

      const alternatives = data.channel?.alternatives;
      if (!alternatives?.length) {
        console.log(`[Deepgram] No alternatives in transcript`);
        return;
      }

      const alt = alternatives[0];
      const transcript = alt.transcript?.trim();
      if (!transcript) {
        console.log(`[Deepgram] Empty transcript text`);
        return;
      }

      console.log(`[Deepgram] Got transcript: "${transcript}" (final: ${data.is_final})`);

      const isFinal = data.is_final ?? false;
      const speakerLabel = `speaker_${alt.words?.[0]?.speaker ?? 0}`;

      // Emit live transcript
      const socketService = getSocketService();
      if (socketService) {
        socketService.emitTranscriptLive(sessionId, speakerLabel, transcript, isFinal);
      }

      // Only process final transcripts for note generation
      if (!isFinal) return;

      const utterance: Utterance = {
        utterance_id: uuid(),
        session_id: sessionId,
        speaker_label: speakerLabel,
        transcript,
        start_time: data.start ?? 0,
        end_time: (data.start ?? 0) + (data.duration ?? 0),
        confidence: alt.confidence ?? 0,
      };

      // Persist utterance for transcript export
      try {
        const { createUtterance } = await import('../db/utteranceRepo.js');
        createUtterance(utterance);
      } catch (err) {
        console.error('[Utterance] Save error:', err);
      }

      // Accumulate transcript for periodic review
      const prevBuf = transcriptBuffers.get(sessionId) ?? '';
      transcriptBuffers.set(sessionId, prevBuf + `\n${speakerLabel}: ${transcript}`);

      // Pre-filter: skip very short phrases, fillers, low confidence
      const detection = detectIdea(utterance, sessionId);
      console.log(`[Filter] "${transcript.slice(0, 60)}" → ${detection.shouldCreate ? 'SEND TO CLAUDE' : 'SKIP'} (${detection.reason})`);
      if (!detection.shouldCreate) return;

      // Step 1: Check if this is an instruction (correction, recategorize, delete)
      const recentNotes = getNotesBySession(sessionId).slice(-8);
      if (recentNotes.length > 0) {
        const instruction = await detectInstruction(transcript, recentNotes);
        if (instruction.type !== 'none' && instruction.noteId) {
          if (instruction.type === 'correction' && instruction.correctedText) {
            const updated = updateNote(instruction.noteId, { text: instruction.correctedText });
            if (updated && socketService) {
              socketService.emitNoteUpdated(sessionId, updated);
              socketService.emitBotLog(sessionId, `Corrigé : "${instruction.correctedText}"`);
              console.log(`[Pipeline] CORRECTED: "${instruction.correctedText}"`);
            }
          } else if (instruction.type === 'recategorize' && instruction.newCategory) {
            const updated = updateNote(instruction.noteId, { status: undefined });
            // updateNote doesn't handle category change, so we need a direct approach
            const existingNote = recentNotes.find(n => n.note_id === instruction.noteId);
            if (existingNote && socketService) {
              // Delete old and recreate in new category
              deleteNote(instruction.noteId);
              socketService.emitNoteDeleted(sessionId, instruction.noteId);
              const newNote = createNote({
                session_id: sessionId,
                text: existingNote.text,
                author_participant_id: existingNote.author_participant_id,
                category: instruction.newCategory,
                position: getNextPosition(instruction.newCategory),
                source_utterance_id: existingNote.source_utterance_id,
              });
              socketService.emitNoteCreated(sessionId, newNote);
              socketService.emitBotLog(sessionId, `Déplacé "${existingNote.text}" → ${instruction.newCategory}`);
              console.log(`[Pipeline] RECATEGORIZED: "${existingNote.text}" → ${instruction.newCategory}`);
            }
          } else if (instruction.type === 'delete') {
            deleteNote(instruction.noteId);
            if (socketService) {
              socketService.emitNoteDeleted(sessionId, instruction.noteId);
              socketService.emitBotLog(sessionId, `Supprimé un post-it`);
              console.log(`[Pipeline] DELETED note ${instruction.noteId}`);
            }
          }
          return;
        }
      }

      // Step 2: Claude decides if this is worth a post-it + category
      const generated = await generateNoteText(transcript);
      if (!generated) {
        console.log(`[Pipeline] Claude rejected: "${transcript.slice(0, 60)}"`);
        return;
      }

      // Find participant by speaker label
      const participant = getParticipantBySpeaker(sessionId, speakerLabel);

      // Create the note
      const note = createNote({
        session_id: sessionId,
        text: generated.text,
        author_participant_id: participant?.participant_id ?? '',
        category: generated.category,
        position: getNextPosition(generated.category),
        source_utterance_id: utterance.utterance_id,
      });

      // Emit via Socket.IO
      if (socketService) {
        socketService.emitNoteCreated(sessionId, note);
        socketService.emitBotLog(sessionId, `Nouveau post-it : "${note.text}" [${note.category}]`);
      }

      console.log(`[Pipeline] Note created: "${note.text}" [${note.category}]`);
    });

    connection.on(LiveTranscriptionEvents.Error, (err) => {
      console.error(`[Deepgram] ERROR for session ${sessionId}:`, JSON.stringify(err));
    });

    connection.on(LiveTranscriptionEvents.Close, (event) => {
      console.log(`[Deepgram] Connection closed for session ${sessionId}:`, JSON.stringify(event));
      this.connections.delete(sessionId);
    });

    connection.on('Warning' as never, (warning: unknown) => {
      console.warn(`[Deepgram] Warning:`, JSON.stringify(warning));
    });

    this.connections.set(sessionId, connection);

    // Start periodic review every 30 seconds
    if (!reviewIntervals.has(sessionId)) {
      transcriptBuffers.set(sessionId, '');
      const interval = setInterval(async () => {
        const buf = transcriptBuffers.get(sessionId) ?? '';
        if (buf.length < 50) return; // not enough content to review

        const notes = getNotesBySession(sessionId).filter(n => n.status === 'suggested');
        if (notes.length === 0) return;

        console.log(`[Review] Running periodic review for session ${sessionId} (${notes.length} notes)`);
        const socketService = getSocketService();

        try {
          const changes = await reviewNotes(notes, buf);
          for (const change of changes) {
            if (change.action === 'update') {
              const updates: { text?: string } = {};
              if (change.text) updates.text = change.text;
              // Handle category change by delete + recreate
              if (change.category) {
                const existing = notes.find(n => n.note_id === change.note_id);
                if (existing && change.category !== existing.category) {
                  deleteNote(change.note_id);
                  if (socketService) socketService.emitNoteDeleted(sessionId, change.note_id);
                  const newNote = createNote({
                    session_id: sessionId,
                    text: change.text ?? existing.text,
                    author_participant_id: existing.author_participant_id,
                    category: change.category,
                    position: getNextPosition(change.category),
                    source_utterance_id: existing.source_utterance_id,
                  });
                  if (socketService) {
                    socketService.emitNoteCreated(sessionId, newNote);
                    socketService.emitBotLog(sessionId, `[Revue] Déplacé "${newNote.text}" → ${change.category}`);
                  }
                  continue;
                }
              }
              if (change.text) {
                const updated = updateNote(change.note_id, updates);
                if (updated && socketService) {
                  socketService.emitNoteUpdated(sessionId, updated);
                  socketService.emitBotLog(sessionId, `[Revue] Affiné : "${change.text}"`);
                }
              }
            } else if (change.action === 'delete') {
              deleteNote(change.note_id);
              if (socketService) {
                socketService.emitNoteDeleted(sessionId, change.note_id);
                socketService.emitBotLog(sessionId, `[Revue] Supprimé un post-it redondant`);
              }
            }
          }
          if (changes.length > 0) {
            console.log(`[Review] Applied ${changes.length} changes`);
          }
        } catch (err) {
          console.error('[Review] Error:', err);
        }
      }, 30000);
      reviewIntervals.set(sessionId, interval);
    }
  }

  sendAudio(sessionId: string, audioBuffer: Buffer, language: string = 'fr'): void {
    let connection = this.connections.get(sessionId);
    if (!connection) {
      this.startSession(sessionId, language);
      connection = this.connections.get(sessionId);
    }
    if (connection) {
      connection.send(audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer);
    }
  }

  sendAudioBuffer(sessionId: string, data: ArrayBuffer, language: string = 'fr'): void {
    let connection = this.connections.get(sessionId);
    if (!connection) {
      console.log(`[Deepgram] Reconnecting for session ${sessionId}`);
      this.startSession(sessionId, language);
      connection = this.connections.get(sessionId);
    }
    if (connection) {
      connection.send(data);
    }
  }

  stopSession(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.requestClose();
      this.connections.delete(sessionId);
    }
    // Clean up periodic review
    const interval = reviewIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      reviewIntervals.delete(sessionId);
    }
    transcriptBuffers.delete(sessionId);
  }
}
