// ── Session de réunion ──
export interface MeetingSession {
  session_id: string;
  title: string;
  created_at: string;
  status: 'active' | 'ended';
  participants: Participant[];
}

// ── Participant ──
export interface Participant {
  participant_id: string;
  session_id: string;
  display_name: string;
  speaker_label: string;       // "speaker_0", "speaker_1", etc.
  color: string;               // couleur hex assignée
  avatar_initials: string;
}

// ── Transcription brute ──
export interface Utterance {
  utterance_id: string;
  session_id: string;
  speaker_label: string;
  transcript: string;
  start_time: number;
  end_time: number;
  confidence: number;
}

// ── Post-it généré ──
export type NoteCategory = 'idea' | 'problem' | 'action' | 'question';
export type NoteStatus = 'suggested' | 'validated' | 'rejected' | 'merged';

export interface StickyNote {
  note_id: string;
  session_id: string;
  text: string;                // max 10 mots
  author_participant_id: string;
  category: NoteCategory;
  status: NoteStatus;
  position: { x: number; y: number };
  created_at: string;
  source_utterance_id: string;
}

// ── Socket.IO Events ──
export interface ServerToClientEvents {
  'note:created': (data: { note: StickyNote }) => void;
  'note:updated': (data: { note: StickyNote }) => void;
  'note:deleted': (data: { note_id: string }) => void;
  'transcript:live': (data: { speaker_label: string; text: string; is_final: boolean }) => void;
  'session:ended': () => void;
}

export interface ClientToServerEvents {
  'session:join': (data: { session_id: string }) => void;
  'note:validate': (data: { note_id: string }) => void;
  'note:reject': (data: { note_id: string }) => void;
  'note:edit': (data: { note_id: string; text: string }) => void;
}

// ── API Request/Response types ──
export interface CreateSessionRequest {
  title: string;
}

export interface AddParticipantRequest {
  display_name: string;
  speaker_label: string;
}

export interface UpdateNoteRequest {
  text?: string;
  status?: NoteStatus;
  position?: { x: number; y: number };
}

// ── Constantes ──
export const PARTICIPANT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F0B27A', '#82E0AA',
] as const;

export const CATEGORY_LABELS: Record<NoteCategory, string> = {
  idea: 'Idées',
  problem: 'Problèmes',
  action: 'Actions',
  question: 'Questions',
};
