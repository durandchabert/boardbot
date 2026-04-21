import { readFile } from 'fs/promises';
import { createClient } from '@deepgram/sdk';
import { v4 as uuid } from 'uuid';
import type {
  Utterance as BoardUtterance,
  NoteCategory,
  StickyNote,
} from '../../../shared/types.ts';
import { createUtterance } from '../db/utteranceRepo.js';
import { createNote } from '../db/noteRepo.js';
import {
  addParticipant,
  getParticipantBySpeaker,
} from '../db/sessionRepo.js';
import { generateNoteText } from './noteGenerator.js';
import { getSocketService } from './socketService.js';

const LANE_X: Record<string, number> = {
  idea: 100,
  problem: 400,
  action: 700,
  question: 400,
};

function makePositioner() {
  const noteCountPerLane: Record<string, number> = {
    idea: 0, problem: 0, action: 0, question: 0,
  };
  return (category: NoteCategory): { x: number; y: number } => {
    const count = noteCountPerLane[category] ?? 0;
    noteCountPerLane[category] = count + 1;
    const col = count % 3;
    const row = Math.floor(count / 3);
    return {
      x: (LANE_X[category] ?? 100) + col * 200 + (Math.random() * 30 - 15),
      y: 80 + row * 140 + (Math.random() * 20 - 10),
    };
  };
}

const IGNORE_PATTERNS = /^(vraiment|ok|okay|d'accord|oui|non|ouais|voilà|exactement|c'est ça|merci|super|bien|ah|hmm|euh|hein|bon|bah|mhm|yeah|yep|nope|right|sure|thanks|uh|um|hmm|well)\s*[?!.]*$/i;

function shouldProcessBatchUtterance(u: { transcript: string; confidence: number }): boolean {
  const text = u.transcript.trim();
  if (!text) return false;
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 3) return false;
  if (IGNORE_PATTERNS.test(text.toLowerCase())) return false;
  if (u.confidence < 0.5) return false;
  return true;
}

export interface TranscribeFileResult {
  durationSec: number;
  speakerCount: number;
  utteranceCount: number;
  notesCreated: number;
  participantsCreated: number;
}

export async function transcribeFileIntoSession(
  wavPath: string,
  sessionId: string,
  language: string,
  onProgress?: (phase: 'transcribe' | 'pipeline', percent: number) => void
): Promise<TranscribeFileResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY is not configured');
  }

  const deepgram = createClient(apiKey);
  const buffer = await readFile(wavPath);

  let fakePct = 0;
  const ticker = setInterval(() => {
    fakePct = Math.min(90, fakePct + 3);
    onProgress?.('transcribe', fakePct);
  }, 800);
  onProgress?.('transcribe', 0);

  let transcribeResult;
  try {
    transcribeResult = await deepgram.listen.prerecorded.transcribeFile(
      buffer,
      {
        model: 'nova-2',
        language,
        smart_format: true,
        punctuate: true,
        diarize: true,
        utterances: true,
        paragraphs: true,
      }
    );
  } finally {
    clearInterval(ticker);
  }
  const { result, error } = transcribeResult;

  if (error) {
    throw new Error(
      `Deepgram prerecorded error: ${error.message ?? JSON.stringify(error)}`
    );
  }
  onProgress?.('transcribe', 100);

  const utterances = result?.results?.utterances ?? [];
  const durationSec = result?.metadata?.duration ?? 0;
  const total = Math.max(1, utterances.length);

  const socketService = getSocketService();
  const getNextPosition = makePositioner();
  const seenSpeakers = new Set<string>();
  let participantsCreated = 0;
  let notesCreated = 0;

  onProgress?.('pipeline', 0);

  for (let i = 0; i < utterances.length; i++) {
    const utt = utterances[i];
    const speakerIdx = typeof utt.speaker === 'number' ? utt.speaker : 0;
    const speakerLabel = `speaker_${speakerIdx}`;
    const transcript = utt.transcript?.trim() ?? '';
    if (!transcript) {
      onProgress?.('pipeline', Math.floor(((i + 1) / total) * 100));
      continue;
    }

    const row: BoardUtterance = {
      utterance_id: utt.id ?? uuid(),
      session_id: sessionId,
      speaker_label: speakerLabel,
      transcript,
      start_time: utt.start ?? 0,
      end_time: utt.end ?? 0,
      confidence: utt.confidence ?? 0,
    };
    try {
      createUtterance(row);
    } catch (err) {
      console.warn('[PreRec] Utterance persist skipped:', (err as Error).message);
    }

    if (!seenSpeakers.has(speakerLabel)) {
      seenSpeakers.add(speakerLabel);
      const existing = getParticipantBySpeaker(sessionId, speakerLabel);
      if (!existing) {
        const newP = addParticipant(
          sessionId,
          `Speaker ${speakerIdx + 1}`,
          speakerLabel
        );
        participantsCreated++;
        socketService?.emitParticipantAdded?.(sessionId, newP);
      }
    }

    if (socketService) {
      socketService.emitTranscriptLive(sessionId, speakerLabel, transcript, true);
    }

    if (!shouldProcessBatchUtterance(row)) {
      onProgress?.('pipeline', Math.floor(((i + 1) / total) * 100));
      continue;
    }
    const generated = await generateNoteText(transcript);
    if (!generated) {
      onProgress?.('pipeline', Math.floor(((i + 1) / total) * 100));
      continue;
    }

    const participant = getParticipantBySpeaker(sessionId, speakerLabel);
    const note: StickyNote = createNote({
      session_id: sessionId,
      text: generated.text,
      author_participant_id: participant?.participant_id ?? '',
      category: generated.category,
      position: getNextPosition(generated.category),
      source_utterance_id: row.utterance_id,
    });

    notesCreated++;
    if (socketService) {
      socketService.emitNoteCreated(sessionId, note);
      socketService.emitBotLog(
        sessionId,
        `Post-it depuis le fichier : "${note.text}" [${note.category}]`
      );
    }
    onProgress?.('pipeline', Math.floor(((i + 1) / total) * 100));
  }

  onProgress?.('pipeline', 100);

  return {
    durationSec,
    speakerCount: seenSpeakers.size,
    utteranceCount: utterances.length,
    notesCreated,
    participantsCreated,
  };
}
