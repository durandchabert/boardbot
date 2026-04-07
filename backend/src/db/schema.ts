import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'boardbot.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'ended'))
    );

    CREATE TABLE IF NOT EXISTS participants (
      participant_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      speaker_label TEXT NOT NULL,
      color TEXT NOT NULL,
      avatar_initials TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS utterances (
      utterance_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      speaker_label TEXT NOT NULL,
      transcript TEXT NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      confidence REAL NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes (
      note_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      text TEXT NOT NULL,
      author_participant_id TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL CHECK(category IN ('idea', 'problem', 'action', 'question')),
      status TEXT NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested', 'validated', 'rejected', 'merged')),
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      source_utterance_id TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    );
  `);
}
