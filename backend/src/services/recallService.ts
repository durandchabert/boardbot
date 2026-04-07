import { getDeepgramService } from './deepgramService.js';
import { getSocketService } from './socketService.js';
import { detectIdea } from './ideaDetector.js';
import { generateNoteText, detectInstruction } from './noteGenerator.js';
import { createNote, getNotesBySession, updateNote, deleteNote } from '../db/noteRepo.js';
import { getParticipantBySpeaker } from '../db/sessionRepo.js';
import type { Utterance, NoteCategory } from '../../../shared/types.ts';
import { v4 as uuid } from 'uuid';

const RECALL_API_BASE = process.env.RECALL_API_BASE ?? 'https://eu-central-1.recall.ai/api/v1';

interface RecallBot {
  botId: string;
  sessionId: string;
  meetingUrl: string;
  status: string;
}

const activeBots = new Map<string, RecallBot>();

// Position calculation
const LANE_X: Record<string, number> = { idea: 100, problem: 400, action: 700, question: 400 };
const noteCountPerLane: Record<string, number> = { idea: 0, problem: 0, action: 0, question: 0 };
function getNextPosition(category: NoteCategory): { x: number; y: number } {
  const count = noteCountPerLane[category] ?? 0;
  noteCountPerLane[category] = count + 1;
  return {
    x: (LANE_X[category] ?? 100) + (count % 3) * 200 + (Math.random() * 30 - 15),
    y: 80 + Math.floor(count / 3) * 140 + (Math.random() * 20 - 10),
  };
}

function getApiKey(): string {
  const key = process.env.RECALL_API_KEY;
  if (!key) throw new Error('RECALL_API_KEY not configured');
  return key;
}

export async function startRecallBot(
  sessionId: string,
  meetingUrl: string,
  botName: string = 'BoardBot'
): Promise<{ ok: boolean; botId?: string; error?: string }> {
  if (activeBots.has(sessionId)) {
    return { ok: false, error: 'Bot already running for this session' };
  }

  const socketService = getSocketService();

  try {
    const apiKey = getApiKey();
    socketService?.emitBotLog(sessionId, `Envoi du bot Recall.ai vers ${meetingUrl.slice(0, 50)}...`);

    // Create a bot via Recall.ai API
    const response = await fetch(`${RECALL_API_BASE}/bot`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: botName,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[Recall] API error:', errorData);
      return { ok: false, error: `Recall API error: ${response.status}` };
    }

    const data = await response.json() as { id: string; status_changes: unknown[] };
    const botId = data.id;

    activeBots.set(sessionId, {
      botId,
      sessionId,
      meetingUrl,
      status: 'joining',
    });

    socketService?.emitBotLog(sessionId, `Bot Recall.ai créé (${botId}). En attente de rejoindre le call...`);

    // Poll for status updates
    pollBotStatus(sessionId, botId);

    return { ok: true, botId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    socketService?.emitBotLog(sessionId, `Erreur Recall: ${msg}`);
    return { ok: false, error: msg };
  }
}

async function pollBotStatus(sessionId: string, botId: string): Promise<void> {
  const socketService = getSocketService();
  const apiKey = getApiKey();
  let recordingId: string | null = null;
  let transcriptRequested = false;

  const interval = setInterval(async () => {
    const bot = activeBots.get(sessionId);
    if (!bot) {
      clearInterval(interval);
      return;
    }

    try {
      // Poll bot status
      const res = await fetch(`${RECALL_API_BASE}/bot/${botId}`, {
        headers: { 'Authorization': `Token ${apiKey}` },
      });

      if (!res.ok) return;

      const data = await res.json() as {
        status_changes: Array<{ code: string; created_at: string }>;
        recordings: Array<{ id: string; status: { code: string }; media_shortcuts: { transcript: { id: string; status: { code: string }; data: { download_url: string | null } } | null } }>;
      };

      const latestStatus = data.status_changes?.[data.status_changes.length - 1]?.code;

      // Get recording ID
      if (!recordingId && data.recordings?.length > 0) {
        recordingId = data.recordings[0].id;
        console.log(`[Recall] Recording ID: ${recordingId}`);
      }

      if (latestStatus && latestStatus !== bot.status) {
        bot.status = latestStatus;
        console.log(`[Recall] Bot ${botId} status: ${latestStatus}`);

        if (latestStatus === 'in_call_not_recording') {
          socketService?.emitBotLog(sessionId, `Bot dans le call, en attente d'enregistrement...`);
        } else if (latestStatus === 'in_call_recording') {
          socketService?.emitBotLog(sessionId, `Bot enregistre !`);
        } else if (latestStatus === 'call_ended' || latestStatus === 'done' || latestStatus === 'fatal') {
          socketService?.emitBotLog(sessionId, `Call terminé (${latestStatus})`);

          // Request transcript creation when recording is done
          if (recordingId && !transcriptRequested) {
            transcriptRequested = true;
            socketService?.emitBotLog(sessionId, `Demande de transcription en cours...`);
            try {
              const txCreate = await fetch(`${RECALL_API_BASE}/recording/${recordingId}/create_transcript/`, {
                method: 'POST',
                headers: {
                  'Authorization': `Token ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ language: 'fr' }),
              });
              console.log(`[Recall] Create transcript response: ${txCreate.status}`);
              if (txCreate.ok) {
                socketService?.emitBotLog(sessionId, `Transcription demandée — en attente du résultat...`);
                // Keep polling for the transcript to complete
                pollTranscript(sessionId, recordingId);
              } else {
                const errText = await txCreate.text();
                console.error(`[Recall] Create transcript error:`, errText);
                socketService?.emitBotLog(sessionId, `Erreur transcription: ${errText.slice(0, 100)}`);
              }
            } catch (err) {
              console.error('[Recall] Create transcript error:', err);
            }
          }

          activeBots.delete(sessionId);
          clearInterval(interval);
          return;
        }
      }
    } catch {
      // Poll error, ignore
    }
  }, 3000);
}

async function pollTranscript(sessionId: string, recordingId: string): Promise<void> {
  const socketService = getSocketService();
  const apiKey = getApiKey();
  let attempts = 0;

  const txInterval = setInterval(async () => {
    attempts++;
    if (attempts > 60) { // Max 5 min of polling
      clearInterval(txInterval);
      socketService?.emitBotLog(sessionId, `Timeout transcription`);
      return;
    }

    try {
      // Check recording status to see if transcript is ready
      const res = await fetch(`${RECALL_API_BASE}/recording/${recordingId}/`, {
        headers: { 'Authorization': `Token ${apiKey}` },
      });

      if (!res.ok) return;

      const recording = await res.json() as {
        media_shortcuts: {
          transcript: {
            id: string;
            status: { code: string };
            data: { download_url: string | null };
          } | null;
        };
      };

      const tx = recording.media_shortcuts?.transcript;
      if (!tx) return;

      console.log(`[Recall] Transcript status: ${tx.status.code}`);

      if (tx.status.code === 'done' && tx.data.download_url) {
        clearInterval(txInterval);
        socketService?.emitBotLog(sessionId, `Transcription prête ! Traitement...`);

        // Download and process transcript
        const txRes = await fetch(tx.data.download_url);
        if (!txRes.ok) return;

        const transcript = await txRes.json() as Array<{
          speaker: string;
          speaker_id?: number;
          words: Array<{ text: string; start_time: number; end_time: number }>;
        }>;

        socketService?.emitBotLog(sessionId, `${transcript.length} segments reçus`);

        for (const segment of transcript) {
          const text = segment.words.map(w => w.text).join(' ');
          if (text.trim().length < 10) continue;
          const speakerLabel = `speaker_${segment.speaker_id ?? 0}`;
          await processTranscriptSegment(sessionId, speakerLabel, text);
        }

        socketService?.emitBotLog(sessionId, `Traitement terminé`);
      } else if (tx.status.code === 'failed') {
        clearInterval(txInterval);
        socketService?.emitBotLog(sessionId, `Transcription échouée`);
      }
    } catch (err) {
      console.error('[Recall] Poll transcript error:', err);
    }
  }, 5000);
}

/**
 * Handle real-time webhook from Recall.ai
 */
export async function handleWebhook(
  sessionId: string,
  data: {
    transcript?: { speaker: string; text: string; is_final: boolean };
    event?: string;
  }
): Promise<void> {
  const socketService = getSocketService();

  if (data.event) {
    socketService?.emitBotLog(sessionId, `Recall event: ${data.event}`);
    return;
  }

  if (data.transcript) {
    const { speaker, text, is_final } = data.transcript;

    // Emit live transcript
    socketService?.emitTranscriptLive(sessionId, speaker, text, is_final);

    if (is_final && text.trim().length > 10) {
      await processTranscriptSegment(sessionId, speaker, text);
    }
  }
}

async function processTranscriptSegment(
  sessionId: string,
  speakerLabel: string,
  transcript: string
): Promise<void> {
  const socketService = getSocketService();

  const utterance: Utterance = {
    utterance_id: uuid(),
    session_id: sessionId,
    speaker_label: speakerLabel,
    transcript,
    start_time: 0,
    end_time: 0,
    confidence: 0.95,
  };

  const detection = detectIdea(utterance, sessionId);
  if (!detection.shouldCreate) return;

  // Check for instructions (corrections, recategorization)
  const recentNotes = getNotesBySession(sessionId).slice(-8);
  if (recentNotes.length > 0) {
    const instruction = await detectInstruction(transcript, recentNotes);
    if (instruction.type !== 'none' && instruction.noteId) {
      if (instruction.type === 'correction' && instruction.correctedText) {
        const updated = updateNote(instruction.noteId, { text: instruction.correctedText });
        if (updated && socketService) {
          socketService.emitNoteUpdated(sessionId, updated);
          socketService.emitBotLog(sessionId, `Corrigé : "${instruction.correctedText}"`);
        }
      } else if (instruction.type === 'recategorize' && instruction.newCategory) {
        const existing = recentNotes.find(n => n.note_id === instruction.noteId);
        if (existing && socketService) {
          deleteNote(instruction.noteId);
          socketService.emitNoteDeleted(sessionId, instruction.noteId);
          const newNote = createNote({
            session_id: sessionId,
            text: existing.text,
            author_participant_id: existing.author_participant_id,
            category: instruction.newCategory,
            position: getNextPosition(instruction.newCategory),
            source_utterance_id: existing.source_utterance_id,
          });
          socketService.emitNoteCreated(sessionId, newNote);
          socketService.emitBotLog(sessionId, `Déplacé → ${instruction.newCategory}`);
        }
      } else if (instruction.type === 'delete') {
        deleteNote(instruction.noteId);
        socketService?.emitNoteDeleted(sessionId, instruction.noteId);
        socketService?.emitBotLog(sessionId, `Supprimé`);
      }
      return;
    }
  }

  // Generate note via Claude
  const generated = await generateNoteText(transcript);
  if (!generated) return;

  const participant = getParticipantBySpeaker(sessionId, speakerLabel);

  const note = createNote({
    session_id: sessionId,
    text: generated.text,
    author_participant_id: participant?.participant_id ?? '',
    category: generated.category,
    position: getNextPosition(generated.category),
    source_utterance_id: utterance.utterance_id,
  });

  if (socketService) {
    socketService.emitNoteCreated(sessionId, note);
    socketService.emitBotLog(sessionId, `Nouveau : "${note.text}" [${note.category}]`);
  }
}

export async function stopRecallBot(sessionId: string): Promise<void> {
  const bot = activeBots.get(sessionId);
  if (!bot) return;

  try {
    const apiKey = getApiKey();
    await fetch(`${RECALL_API_BASE}/bot/${bot.botId}/leave_call`, {
      method: 'POST',
      headers: { 'Authorization': `Token ${apiKey}` },
    });
  } catch {
    // Ignore
  }

  activeBots.delete(sessionId);
  getSocketService()?.emitBotLog(sessionId, 'Bot arrêté');
}

export function getRecallBotStatus(sessionId: string) {
  return activeBots.get(sessionId) ?? null;
}
