import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createSession } from '../hooks/useSession.js';
import styles from './Home.module.css';

export default function Home() {
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleCreate = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      const session = await createSession(title.trim());
      navigate(`/session/${session.session_id}/setup`);
    } catch {
      alert('Erreur lors de la création de la session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <div className={styles.logo}>BoardBot</div>
        <p className={styles.subtitle}>
          Whiteboard collaboratif alimenté par IA en temps réel
        </p>

        <div className={styles.form}>
          <input
            type="text"
            placeholder="Titre de la réunion..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className={styles.input}
            autoFocus
          />
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={loading || !title.trim()}
          >
            {loading ? 'Création...' : 'Créer le board'}
          </button>
        </div>

        <div className={styles.features}>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>🎙️</span>
            <span>Transcription en temps réel</span>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>🤖</span>
            <span>Post-it générés par IA</span>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>👥</span>
            <span>Collaboration en direct</span>
          </div>
        </div>
      </div>
    </div>
  );
}
