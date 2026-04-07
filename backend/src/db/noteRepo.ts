import { v4 as uuid } from 'uuid';
import { getDb } from './schema.js';
import type { StickyNote, NoteCategory, NoteStatus } from '../../../shared/types.ts';

interface NoteRow {
  note_id: string;
  session_id: string;
  text: string;
  author_participant_id: string;
  category: NoteCategory;
  status: NoteStatus;
  position_x: number;
  position_y: number;
  created_at: string;
  source_utterance_id: string;
}

function rowToNote(row: NoteRow): StickyNote {
  return {
    note_id: row.note_id,
    session_id: row.session_id,
    text: row.text,
    author_participant_id: row.author_participant_id,
    category: row.category,
    status: row.status,
    position: { x: row.position_x, y: row.position_y },
    created_at: row.created_at,
    source_utterance_id: row.source_utterance_id,
  };
}

export function createNote(params: {
  session_id: string;
  text: string;
  author_participant_id: string;
  category: NoteCategory;
  position: { x: number; y: number };
  source_utterance_id: string;
}): StickyNote {
  const db = getDb();
  const note_id = uuid();
  const created_at = new Date().toISOString();

  db.prepare(
    `INSERT INTO notes (note_id, session_id, text, author_participant_id, category, status, position_x, position_y, created_at, source_utterance_id)
     VALUES (?, ?, ?, ?, ?, 'suggested', ?, ?, ?, ?)`
  ).run(
    note_id,
    params.session_id,
    params.text,
    params.author_participant_id,
    params.category,
    params.position.x,
    params.position.y,
    created_at,
    params.source_utterance_id
  );

  return {
    note_id,
    session_id: params.session_id,
    text: params.text,
    author_participant_id: params.author_participant_id,
    category: params.category,
    status: 'suggested',
    position: params.position,
    created_at,
    source_utterance_id: params.source_utterance_id,
  };
}

export function getNotesBySession(sessionId: string): StickyNote[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM notes WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as NoteRow[];
  return rows.map(rowToNote);
}

export function getNote(noteId: string): StickyNote | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM notes WHERE note_id = ?').get(noteId) as NoteRow | undefined;
  return row ? rowToNote(row) : null;
}

export function updateNote(
  noteId: string,
  updates: { text?: string; status?: NoteStatus; position?: { x: number; y: number } }
): StickyNote | null {
  const db = getDb();
  const existing = getNote(noteId);
  if (!existing) return null;

  if (updates.text !== undefined) {
    db.prepare('UPDATE notes SET text = ? WHERE note_id = ?').run(updates.text, noteId);
  }
  if (updates.status !== undefined) {
    db.prepare('UPDATE notes SET status = ? WHERE note_id = ?').run(updates.status, noteId);
  }
  if (updates.position !== undefined) {
    db.prepare('UPDATE notes SET position_x = ?, position_y = ? WHERE note_id = ?').run(
      updates.position.x,
      updates.position.y,
      noteId
    );
  }

  return getNote(noteId);
}

export function deleteNote(noteId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM notes WHERE note_id = ?').run(noteId);
  return result.changes > 0;
}

export function getLastNoteTimeBySpeaker(sessionId: string, speakerLabel: string): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT n.created_at FROM notes n
       JOIN participants p ON n.author_participant_id = p.participant_id
       WHERE n.session_id = ? AND p.speaker_label = ?
       ORDER BY n.created_at DESC LIMIT 1`
    )
    .get(sessionId, speakerLabel) as { created_at: string } | undefined;

  return row ? new Date(row.created_at).getTime() : null;
}
