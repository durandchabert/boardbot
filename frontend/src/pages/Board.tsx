import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession.js';
import { useSocket } from '../hooks/useSocket.js';
import { useAudioCapture } from '../hooks/useAudioCapture.js';
import BoardCanvas from '../components/BoardCanvas.js';
import ParticipantList from '../components/ParticipantList.js';
import TranscriptBar from '../components/TranscriptBar.js';
import BotLogPanel from '../components/BotLogPanel.js';
import type { NoteCategory } from '@boardbot/shared';
import styles from './Board.module.css';

const TEST_NOTES: { text: string; category: NoteCategory }[] = [
  { text: "Revoir le processus d'onboarding", category: 'idea' },
  { text: 'Problème de performance backend', category: 'problem' },
  { text: 'Migrer la base de données', category: 'action' },
  { text: "Améliorer l'UX du formulaire", category: 'idea' },
  { text: 'Bug critique en production', category: 'problem' },
];

export default function Board() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session, loading } = useSession(id);
  const [testIndex, setTestIndex] = useState(0);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [botActive, setBotActive] = useState(false);
  const {
    notes,
    liveTranscript,
    connected,
    noteCount,
    validateNote,
    rejectNote,
    editNote,
    botLogs,
    sendBotMessage,
  } = useSocket(id);
  const { isActive, isRecording, isCapturingTab, error: audioError, startRecording, startTabCapture, stopRecording } = useAudioCapture(id);

  if (loading) return <div className={styles.loading}>Chargement du board...</div>;
  if (!session) return <div className={styles.loading}>Session introuvable</div>;

  const handleEndSession = () => {
    fetch(`/api/sessions/${id}/end`, { method: 'POST' }).then(() => {
      navigate(`/session/${id}/recap`);
    });
  };

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sessionInfo}>
          <h2 className={styles.sessionTitle}>{session.title}</h2>
          <div className={styles.status}>
            <span
              className={styles.dot}
              style={{ background: connected ? 'var(--success)' : 'var(--danger)' }}
            />
            {connected ? 'Connecté' : 'Déconnecté'}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 8, width: '100%', justifyContent: 'center', fontSize: '0.8rem' }}
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              alert('Lien copié ! Partagez-le aux participants.');
            }}
          >
            Copier le lien du board
          </button>
        </div>

        <ParticipantList participants={session.participants} />

        <div className={styles.actions}>
          {/* Meeting Bot (Recall.ai) */}
          <div className={styles.botSection}>
            <label className={styles.botLabel}>Bot dans un call</label>
            <input
              type="text"
              placeholder="URL Meet / Teams / Zoom..."
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              className={styles.botInput}
            />
            <button
              className={`btn ${botActive ? 'btn-danger' : 'btn-primary'} btn-sm`}
              onClick={async () => {
                if (botActive) {
                  await fetch(`/api/sessions/${id}/bot/stop`, { method: 'POST' });
                  setBotActive(false);
                } else if (meetingUrl.trim()) {
                  const res = await fetch(`/api/sessions/${id}/bot/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ meeting_url: meetingUrl.trim() }),
                  });
                  const data = await res.json();
                  if (data.ok) {
                    setBotActive(true);
                  } else {
                    alert(data.error || 'Erreur');
                  }
                }
              }}
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={!meetingUrl.trim() && !botActive}
            >
              {botActive ? '⏹ Retirer le bot' : '🤖 Envoyer le bot'}
            </button>
          </div>

          <div className={styles.divider} />

          {/* Local mic */}
          <button
            className={`btn ${isRecording ? 'btn-danger' : 'btn-primary'}`}
            onClick={isRecording ? stopRecording : startRecording}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {isRecording ? '⏹ Arrêter l\'écoute' : '🎙️ Micro local'}
          </button>
          {audioError && <p className={styles.error}>{audioError}</p>}

          <button
            className="btn btn-secondary"
            onClick={() => {
              const note = TEST_NOTES[testIndex % TEST_NOTES.length];
              setTestIndex((i) => i + 1);
              fetch(`/api/sessions/${id}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(note),
              });
            }}
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
          >
            + Ajouter une note test
          </button>

          <button
            className="btn btn-secondary"
            onClick={handleEndSession}
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
          >
            Terminer la session
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className={styles.main}>
        {/* Top bar */}
        <div className={styles.topBar}>
          <div className={styles.indicator}>
            <span
              className={styles.dot}
              style={{ background: isRecording ? 'var(--success)' : 'var(--text-muted)' }}
            />
            {isRecording ? 'Bot actif' : 'Bot inactif'}
            <span className={styles.separator}>·</span>
            {noteCount} note{noteCount !== 1 ? 's' : ''} générée{noteCount !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Board */}
        <div className={styles.boardContainer}>
          <BoardCanvas
            notes={notes}
            participants={session.participants}
            onValidate={validateNote}
            onReject={rejectNote}
            onEdit={editNote}
          />
        </div>

        {/* Transcript bar */}
        <TranscriptBar
          transcript={liveTranscript}
          participants={session.participants}
        />
      </main>

      {/* Bot Log Panel */}
      <BotLogPanel logs={botLogs} onSendMessage={sendBotMessage} />
    </div>
  );
}
