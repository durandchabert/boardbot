import { useState, useRef, useEffect, type DragEvent, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { createSession } from '../hooks/useSession.js';
import { LANGUAGE_LABELS, type SessionLanguage } from '@boardbot/shared';
import styles from './Import.module.css';

const ACCEPTED_EXT = ['mp3', 'm4a', 'wav', 'ogg', 'webm', 'aac', 'flac', 'mp4', 'mov'];

type Phase = 'idle' | 'upload' | 'denoise' | 'transcribe' | 'pipeline' | 'done' | 'error';

const PHASE_LABEL: Record<Phase, string> = {
  idle: '',
  upload: 'Upload du fichier',
  denoise: 'Nettoyage du bruit',
  transcribe: 'Transcription Deepgram',
  pipeline: 'Génération des post-it',
  done: 'Terminé',
  error: 'Erreur',
};

export default function Import() {
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState<SessionLanguage>('fr');
  const [file, setFile] = useState<File | null>(null);
  const [denoise, setDenoise] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [percent, setPercent] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    return () => { socketRef.current?.disconnect(); };
  }, []);

  const pickFile = (f: File | null) => {
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ACCEPTED_EXT.includes(ext) && !f.type.startsWith('audio/') && !f.type.startsWith('video/')) {
      setError("Format non supporté (." + ext + "). Utilisez " + ACCEPTED_EXT.join(', ') + '.');
      return;
    }
    setError(null);
    setFile(f);
    if (!title) {
      const stem = f.name.replace(/\.[^.]+$/, '');
      setTitle(stem);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    pickFile(e.dataTransfer.files?.[0] ?? null);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    pickFile(e.target.files?.[0] ?? null);
  };

  const busy = phase !== 'idle' && phase !== 'done' && phase !== 'error';
  const canStart = title.trim().length > 0 && file !== null && !busy;

  const handleStart = async () => {
    if (!file || !title.trim()) return;
    setError(null);
    setPhase('upload');
    setPercent(0);
    setStatusMsg('Création de la session...');

    try {
      const session = await createSession(title.trim(), language);

      // Open the socket connection BEFORE sending the file, join the session
      // room, and listen for progress events pushed from the server during
      // ffmpeg / Deepgram / note generation.
      const socket = io({ path: '/socket.io' });
      socketRef.current = socket;
      socket.on('connect', () => {
        socket.emit('session:join', { session_id: session.session_id });
      });
      socket.on('upload:progress', (data: { phase: Exclude<Phase, 'idle' | 'upload'>; percent: number; message?: string }) => {
        setPhase(data.phase);
        setPercent(data.percent);
        if (data.message) setStatusMsg(data.message);
        if (data.phase === 'done') {
          // Small delay so user sees 100%
          setTimeout(() => navigate('/session/' + session.session_id + '/board'), 600);
        }
      });

      const form = new FormData();
      form.append('audio', file);
      form.append('denoise', denoise ? 'true' : 'false');

      setStatusMsg('Upload de ' + file.name + '...');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/sessions/' + session.session_id + '/audio/upload');
      // Upload phase: map XHR bytes to 0-15% of the overall bar.
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return;
        const uploadPct = (ev.loaded / ev.total) * 100;
        setPhase('upload');
        setPercent(Math.round(uploadPct * 0.15));
        setStatusMsg('Upload de ' + file.name + '... ' + Math.floor(uploadPct) + '%');
      };
      xhr.onerror = () => {
        setPhase('error');
        setError('Erreur réseau pendant upload.');
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Server-side 'done' event will navigate us. If we got here without
          // receiving it (race), fall back to a direct navigation.
          if (phase !== 'done') {
            setPhase('done');
            setPercent(100);
            setStatusMsg('Terminé - ouverture du board...');
            setTimeout(() => navigate('/session/' + session.session_id + '/board'), 600);
          }
        } else {
          let msg = 'Erreur serveur (' + xhr.status + ')';
          try {
            const body = JSON.parse(xhr.responseText);
            if (body.error) msg = body.error;
          } catch { /* noop */ }
          setPhase('error');
          setError(msg);
        }
      };
      xhr.send(form);
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Importer un audio</h1>
        <p className={styles.subtitle}>
          Transcription avec diarisation, post-it générés automatiquement.
        </p>

        <div className={styles.field}>
          <label className={styles.label}>Titre de la réunion</label>
          <input
            type="text"
            className={styles.input}
            placeholder="Ex : Rétro sprint 14"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Langue de l'audio</label>
          <select
            className={styles.select}
            value={language}
            onChange={(e) => setLanguage(e.target.value as SessionLanguage)}
            disabled={busy}
          >
            {(Object.keys(LANGUAGE_LABELS) as SessionLanguage[]).map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_LABELS[code]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Fichier audio</label>
          <div
            className={styles.dropzone + ' ' + (isDragging ? styles.dropzoneActive : '')}
            onClick={() => busy || inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <span className={styles.dropzoneIcon}>🎧</span>
            <div className={styles.dropzoneMain}>
              Glissez un fichier ici ou cliquez pour parcourir
            </div>
            <div className={styles.dropzoneHint}>
              Formats : {ACCEPTED_EXT.join(', ')} — jusqu'à 500 Mo
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="audio/*,video/*"
              style={{ display: 'none' }}
              onChange={onFileChange}
              disabled={busy}
            />
          </div>

          {file && (
            <div className={styles.fileInfo}>
              <span>🎵</span>
              <span className={styles.fileName}>{file.name}</span>
              <span className={styles.fileSize}>
                {(file.size / 1024 / 1024).toFixed(1)} Mo
              </span>
            </div>
          )}
        </div>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={denoise}
            onChange={(e) => setDenoise(e.target.checked)}
            disabled={busy}
          />
          <span>
            Nettoyer le bruit de fond (highpass + afftdn + loudnorm).
          </span>
        </label>

        <div className={styles.actions}>
          <button className="btn btn-secondary" onClick={() => navigate('/')} disabled={busy}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={handleStart} disabled={canStart === false}>
            {busy ? 'Traitement...' : 'Lancer la transcription'}
          </button>
        </div>

        {(busy || phase === 'done') && (
          <div className={styles.progress}>
            <div className={styles.progressHeader}>
              <span className={styles.progressPhase}>{PHASE_LABEL[phase]}</span>
              <span className={styles.progressPercent}>{percent}%</span>
            </div>
            <div className={styles.progressBar}>
              <div className={styles.progressBarFill} style={{ width: percent + '%' }} />
            </div>
            {statusMsg && <div className={styles.progressStatus}>{statusMsg}</div>}
          </div>
        )}

        {error && <div className={styles.errorBox}>! {error}</div>}
      </div>
    </div>
  );
}
