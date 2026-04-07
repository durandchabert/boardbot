import { v4 as uuid } from 'uuid';
import { getDb } from './schema.js';
import type { MeetingSession, Participant } from '../../../shared/types.ts';
import { PARTICIPANT_COLORS } from '../../../shared/types.ts';

export function createSession(title: string): MeetingSession {
  const db = getDb();
  const session_id = uuid();
  const created_at = new Date().toISOString();

  db.prepare(
    'INSERT INTO sessions (session_id, title, created_at, status) VALUES (?, ?, ?, ?)'
  ).run(session_id, title, created_at, 'active');

  return { session_id, title, created_at, status: 'active', participants: [] };
}

export function getSession(sessionId: string): MeetingSession | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as {
    session_id: string;
    title: string;
    created_at: string;
    status: 'active' | 'ended';
  } | undefined;

  if (!row) return null;

  const participants = db
    .prepare('SELECT * FROM participants WHERE session_id = ?')
    .all(sessionId) as Participant[];

  return { ...row, participants };
}

export function endSession(sessionId: string): void {
  const db = getDb();
  db.prepare("UPDATE sessions SET status = 'ended' WHERE session_id = ?").run(sessionId);
}

export function addParticipant(
  sessionId: string,
  displayName: string,
  speakerLabel: string
): Participant {
  const db = getDb();
  const participant_id = uuid();

  const existing = db
    .prepare('SELECT COUNT(*) as count FROM participants WHERE session_id = ?')
    .get(sessionId) as { count: number };

  const colorIndex = existing.count % PARTICIPANT_COLORS.length;
  const color = PARTICIPANT_COLORS[colorIndex];

  const initials = displayName
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);

  const participant: Participant = {
    participant_id,
    session_id: sessionId,
    display_name: displayName,
    speaker_label: speakerLabel,
    color,
    avatar_initials: initials,
  };

  db.prepare(
    'INSERT INTO participants (participant_id, session_id, display_name, speaker_label, color, avatar_initials) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(participant_id, sessionId, displayName, speakerLabel, color, initials);

  return participant;
}

export function getParticipantBySpeaker(
  sessionId: string,
  speakerLabel: string
): Participant | null {
  const db = getDb();
  return (
    (db
      .prepare('SELECT * FROM participants WHERE session_id = ? AND speaker_label = ?')
      .get(sessionId, speakerLabel) as Participant | undefined) ?? null
  );
}
