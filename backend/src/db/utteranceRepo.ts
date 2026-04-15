import { getDb } from './schema.js';
import type { Utterance, Participant } from '../../../shared/types.ts';

interface UtteranceRow {
  utterance_id: string;
  session_id: string;
  speaker_label: string;
  transcript: string;
  start_time: number;
  end_time: number;
  confidence: number;
}

export interface UtteranceWithSpeaker extends Utterance {
  display_name: string;
  color: string;
  avatar_initials: string;
}

export function createUtterance(utterance: Utterance): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO utterances (utterance_id, session_id, speaker_label, transcript, start_time, end_time, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    utterance.utterance_id,
    utterance.session_id,
    utterance.speaker_label,
    utterance.transcript,
    utterance.start_time,
    utterance.end_time,
    utterance.confidence
  );
}

export function getUtterancesBySession(sessionId: string): UtteranceWithSpeaker[] {
  const db = getDb();

  // Fetch all participants for this session (to build speaker map)
  const participants = db
    .prepare('SELECT * FROM participants WHERE session_id = ?')
    .all(sessionId) as Participant[];

  const speakerMap = new Map<string, Participant>();
  for (const p of participants) {
    speakerMap.set(p.speaker_label, p);
  }

  const rows = db
    .prepare(
      'SELECT * FROM utterances WHERE session_id = ? ORDER BY start_time ASC'
    )
    .all(sessionId) as UtteranceRow[];

  return rows.map((row) => {
    const participant = speakerMap.get(row.speaker_label);
    return {
      utterance_id: row.utterance_id,
      session_id: row.session_id,
      speaker_label: row.speaker_label,
      transcript: row.transcript,
      start_time: row.start_time,
      end_time: row.end_time,
      confidence: row.confidence,
      display_name: participant?.display_name ?? row.speaker_label,
      color: participant?.color ?? '#888888',
      avatar_initials: participant?.avatar_initials ?? row.speaker_label.slice(0, 2).toUpperCase(),
    };
  });
}
