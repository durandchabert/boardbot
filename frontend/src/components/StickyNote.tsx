import { useState } from 'react';
import type { StickyNote as StickyNoteType, Participant, NoteCategory } from '@boardbot/shared';
import styles from './StickyNote.module.css';

const CATEGORY_BG: Record<NoteCategory, string> = {
  idea: '#4ecdc420',
  problem: '#ff6b6b20',
  action: '#ffeaa720',
  question: '#dda0dd20',
};

const CATEGORY_BORDER: Record<NoteCategory, string> = {
  idea: '#4ecdc4',
  problem: '#ff6b6b',
  action: '#ffeaa7',
  question: '#dda0dd',
};

interface Props {
  note: StickyNoteType;
  participant: Participant | undefined;
  onValidate: (noteId: string) => void;
  onReject: (noteId: string) => void;
  onEdit: (noteId: string, text: string) => void;
}

export default function StickyNote({ note, participant, onValidate, onReject, onEdit }: Props) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.text);

  const handleSave = () => {
    if (editText.trim() && editText !== note.text) {
      onEdit(note.note_id, editText.trim());
    }
    setEditing(false);
  };

  const isSuggested = note.status === 'suggested';
  const isRejected = note.status === 'rejected';

  return (
    <div
      className={`${styles.note} ${isSuggested ? styles.suggested : ''} ${isRejected ? styles.rejected : ''} pop-in`}
      style={{
        background: CATEGORY_BG[note.category],
        borderColor: participant?.color ?? CATEGORY_BORDER[note.category],
      }}
    >
      {/* Header */}
      <div className={styles.header}>
        {participant ? (
          <>
            <div
              className={styles.avatar}
              style={{ background: participant.color }}
            >
              {participant.avatar_initials}
            </div>
            <span className={styles.authorName}>{participant.display_name}</span>
          </>
        ) : (
          <span className={styles.authorName}>?</span>
        )}
        <span className={styles.category}>{note.category}</span>
        {note.status !== 'suggested' && (
          <span className={`${styles.badge} ${styles[note.status]}`}>
            {note.status === 'validated' ? '✓' : note.status === 'rejected' ? '✗' : '⊕'}
          </span>
        )}
      </div>

      {/* Body */}
      {editing ? (
        <div className={styles.editArea}>
          <input
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setEditing(false);
            }}
            className={styles.editInput}
            autoFocus
          />
        </div>
      ) : (
        <p className={styles.text}>{note.text}</p>
      )}

      {/* Actions */}
      {isSuggested && (
        <div className={styles.actions}>
          <button
            className={`${styles.actionBtn} ${styles.validate}`}
            onClick={() => onValidate(note.note_id)}
            title="Valider"
          >
            ✓
          </button>
          <button
            className={`${styles.actionBtn} ${styles.reject}`}
            onClick={() => onReject(note.note_id)}
            title="Rejeter"
          >
            ✗
          </button>
          <button
            className={`${styles.actionBtn} ${styles.edit}`}
            onClick={() => setEditing(true)}
            title="Éditer"
          >
            ✎
          </button>
        </div>
      )}
    </div>
  );
}
