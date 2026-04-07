import { useMemo, useRef, useEffect, useState } from 'react';
import type { StickyNote as StickyNoteType, Participant, NoteCategory } from '@boardbot/shared';
import { CATEGORY_LABELS } from '@boardbot/shared';
import StickyNoteComponent from './StickyNote.js';
import styles from './BoardCanvas.module.css';

interface Props {
  notes: StickyNoteType[];
  participants: Participant[];
  onValidate: (noteId: string) => void;
  onReject: (noteId: string) => void;
  onEdit: (noteId: string, text: string) => void;
}

const LANES: NoteCategory[] = ['idea', 'problem', 'action'];

export default function BoardCanvas({ notes, participants, onValidate, onReject, onEdit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const participantMap = useMemo(() => {
    const map = new Map<string, Participant>();
    for (const p of participants) {
      map.set(p.participant_id, p);
    }
    return map;
  }, [participants]);

  const notesByLane = useMemo(() => {
    const map: Record<NoteCategory, StickyNoteType[]> = {
      idea: [],
      problem: [],
      action: [],
      question: [],
    };
    for (const note of notes) {
      map[note.category].push(note);
    }
    return map;
  }, [notes]);

  const laneWidth = containerSize.width > 0 ? containerSize.width / LANES.length : 400;

  return (
    <div ref={containerRef} className={styles.canvas}>
      {LANES.map((lane) => (
        <div
          key={lane}
          className={styles.lane}
          style={{ width: laneWidth }}
        >
          <div className={styles.laneHeader}>
            <span
              className={styles.laneDot}
              style={{
                background:
                  lane === 'idea' ? 'var(--cat-idea)' :
                  lane === 'problem' ? 'var(--cat-problem)' :
                  'var(--cat-action)',
              }}
            />
            {CATEGORY_LABELS[lane]}
            <span className={styles.laneCount}>{notesByLane[lane].length}</span>
          </div>
          <div className={styles.laneContent}>
            {notesByLane[lane].map((note) => (
              <StickyNoteComponent
                key={note.note_id}
                note={note}
                participant={participantMap.get(note.author_participant_id)}
                onValidate={onValidate}
                onReject={onReject}
                onEdit={onEdit}
              />
            ))}
            {/* Questions go under problems */}
            {lane === 'problem' && notesByLane.question.length > 0 && (
              <>
                <div className={styles.subLaneHeader}>
                  <span className={styles.laneDot} style={{ background: 'var(--cat-question)' }} />
                  Questions
                  <span className={styles.laneCount}>{notesByLane.question.length}</span>
                </div>
                {notesByLane.question.map((note) => (
                  <StickyNoteComponent
                    key={note.note_id}
                    note={note}
                    participant={participantMap.get(note.author_participant_id)}
                    onValidate={onValidate}
                    onReject={onReject}
                    onEdit={onEdit}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
