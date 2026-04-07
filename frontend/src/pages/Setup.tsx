import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession.js';
import styles from './Setup.module.css';

export default function Setup() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session, loading, addParticipant } = useSession(id);
  const [name, setName] = useState('');
  const [speakerIndex, setSpeakerIndex] = useState(0);
  const [adding, setAdding] = useState(false);

  if (loading) return <div className={styles.loading}>Chargement...</div>;
  if (!session) return <div className={styles.loading}>Session introuvable</div>;

  const handleAdd = async () => {
    if (!name.trim()) return;
    setAdding(true);
    try {
      await addParticipant(name.trim(), `speaker_${speakerIndex}`);
      setName('');
      setSpeakerIndex((i) => i + 1);
    } catch {
      alert("Erreur lors de l'ajout du participant");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>{session.title}</h1>
        <p className={styles.subtitle}>Configurez les participants</p>
        <p className={styles.hint}>Deepgram numérote les speakers à partir de 0. Le premier à parler sera Speaker 0.</p>

        <div className={styles.addForm}>
          <input
            type="text"
            placeholder="Nom du participant..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className={styles.input}
          />
          <select
            value={speakerIndex}
            onChange={(e) => setSpeakerIndex(Number(e.target.value))}
            className={styles.select}
          >
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i} value={i}>
                Speaker {i}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={adding}>
            Ajouter
          </button>
        </div>

        {session.participants.length > 0 && (
          <div className={styles.participants}>
            {session.participants.map((p) => (
              <div key={p.participant_id} className={styles.participant}>
                <div
                  className={styles.avatar}
                  style={{ background: p.color }}
                >
                  {p.avatar_initials}
                </div>
                <div className={styles.participantInfo}>
                  <span className={styles.participantName}>{p.display_name}</span>
                  <span className={styles.speakerLabel}>{p.speaker_label}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          className={`btn btn-primary ${styles.launchBtn}`}
          onClick={() => navigate(`/session/${id}/board`)}
        >
          Lancer le board
        </button>
      </div>
    </div>
  );
}
