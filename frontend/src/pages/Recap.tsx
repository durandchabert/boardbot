import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSession } from '../hooks/useSession.js';
import type { StickyNote, NoteCategory } from '@boardbot/shared';
import { CATEGORY_LABELS } from '@boardbot/shared';
import styles from './Recap.module.css';

export default function Recap() {
  const { id } = useParams<{ id: string }>();
  const { session, loading } = useSession(id);
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sessions/${id}/notes`)
      .then((res) => res.json())
      .then(setNotes)
      .catch(console.error);
  }, [id]);

  const validatedNotes = notes.filter((n) => n.status === 'validated');

  const grouped = validatedNotes.reduce<Record<NoteCategory, StickyNote[]>>(
    (acc, note) => {
      acc[note.category].push(note);
      return acc;
    },
    { idea: [], problem: [], action: [], question: [] }
  );

  const handleExportJSON = () => {
    const data = {
      session,
      notes: validatedNotes,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boardbot-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerateSummary = async () => {
    setLoadingSummary(true);
    try {
      const res = await fetch(`/api/sessions/${id}/summary`, { method: 'POST' });
      const data = await res.json();
      setSummary(data.summary);
    } catch {
      setSummary('Erreur lors de la génération du résumé.');
    } finally {
      setLoadingSummary(false);
    }
  };

  if (loading) return <div className={styles.loading}>Chargement...</div>;
  if (!session) return <div className={styles.loading}>Session introuvable</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{session.title}</h1>
          <p className={styles.subtitle}>
            Récapitulatif — {validatedNotes.length} note{validatedNotes.length !== 1 ? 's' : ''} validée{validatedNotes.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className="btn btn-secondary btn-sm" onClick={handleExportJSON}>
            Exporter JSON
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleGenerateSummary}
            disabled={loadingSummary}
          >
            {loadingSummary ? 'Génération...' : 'Générer un résumé IA'}
          </button>
          <Link to={`/session/${id}/board`} className="btn btn-secondary btn-sm">
            Retour au board
          </Link>
        </div>
      </div>

      {summary && (
        <div className={styles.summaryCard}>
          <h3>Résumé IA</h3>
          <p>{summary}</p>
        </div>
      )}

      <div className={styles.grid}>
        {(Object.entries(grouped) as [NoteCategory, StickyNote[]][]).map(([category, categoryNotes]) => (
          <div key={category} className={styles.categoryCard}>
            <h3 className={styles.categoryTitle}>
              <span
                className={styles.categoryDot}
                style={{
                  background:
                    category === 'idea' ? 'var(--cat-idea)' :
                    category === 'problem' ? 'var(--cat-problem)' :
                    category === 'action' ? 'var(--cat-action)' :
                    'var(--cat-question)',
                }}
              />
              {CATEGORY_LABELS[category]}
              <span className={styles.count}>{categoryNotes.length}</span>
            </h3>
            {categoryNotes.length === 0 ? (
              <p className={styles.empty}>Aucune note</p>
            ) : (
              <ul className={styles.noteList}>
                {categoryNotes.map((note) => (
                  <li key={note.note_id} className={styles.noteItem}>
                    {note.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
