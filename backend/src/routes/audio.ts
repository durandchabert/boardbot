import { Router } from 'express';
import multer from 'multer';
import { tmpdir } from 'os';
import { extname } from 'path';
import { getSession } from '../db/sessionRepo.js';
import { getDeepgramService } from '../services/deepgramService.js';
import {
  preprocessAudio,
  cleanupFile,
} from '../services/audioProcessor.js';
import { transcribeFileIntoSession } from '../services/prerecordedProcessor.js';
import { getSocketService } from '../services/socketService.js';

const liveUpload = multer({ storage: multer.memoryStorage() });

const fileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpdir()),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname || '') || '.bin';
      cb(null, `boardbot-upload-${Date.now()}${ext}`);
    },
  }),
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
});

const router = Router();

router.post('/:id/audio', liveUpload.single('audio'), (req, res) => {
  const sessionId = req.params.id as string;
  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.status === 'ended') {
    res.status(400).json({ error: 'Session has ended' });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No audio file provided' });
    return;
  }

  const deepgramService = getDeepgramService();
  if (deepgramService) {
    deepgramService.sendAudio(sessionId, file.buffer, session.language ?? 'fr');
  }

  res.json({ ok: true, bytes: file.buffer.length });
});

router.post('/:id/audio/upload', fileUpload.single('audio'), async (req, res) => {
  const sessionId = req.params.id as string;
  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.status === 'ended') {
    res.status(400).json({ error: 'Session has ended' });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No audio file provided' });
    return;
  }

  const denoise = req.body?.denoise !== 'false';
  const socket = getSocketService();
  const log = (msg: string) => {
    console.log(`[Upload] ${msg}`);
    socket?.emitBotLog(sessionId, msg);
  };

  const phaseBounds: Record<'denoise' | 'transcribe' | 'pipeline', [number, number]> = {
    denoise: [15, 45],
    transcribe: [45, 80],
    pipeline: [80, 100],
  };
  const mapPercent = (phase: 'denoise' | 'transcribe' | 'pipeline', p: number): number => {
    const [lo, hi] = phaseBounds[phase];
    return Math.round(lo + (hi - lo) * (Math.max(0, Math.min(100, p)) / 100));
  };

  let cleanPath: string | null = null;
  try {
    log(`Fichier reçu : ${file.originalname} (${(file.size / 1024 / 1024).toFixed(1)} Mo)`);

    const denoiseMsg = denoise ? 'Nettoyage du bruit...' : 'Conversion du fichier...';
    socket?.emitUploadProgress(sessionId, { phase: 'denoise', percent: 15, message: denoiseMsg });

    const processed = await preprocessAudio(file.path, {
      denoise,
      onProgress: (p) => {
        socket?.emitUploadProgress(sessionId, {
          phase: 'denoise', percent: mapPercent('denoise', p), message: denoiseMsg,
        });
      },
    });
    cleanPath = processed.outputPath;

    socket?.emitUploadProgress(sessionId, {
      phase: 'transcribe', percent: 45,
      message: 'Transcription Deepgram (diarisation)...',
    });

    const result = await transcribeFileIntoSession(
      cleanPath,
      sessionId,
      session.language ?? 'fr',
      (phase, p) => {
        socket?.emitUploadProgress(sessionId, {
          phase,
          percent: mapPercent(phase, p),
          message: phase === 'transcribe'
            ? 'Transcription Deepgram (diarisation)...'
            : 'Génération des post-it...',
        });
      }
    );

    log(
      `Terminé : ${result.utteranceCount} interventions, ` +
      `${result.speakerCount} voix, ${result.notesCreated} post-it`
    );
    socket?.emitUploadProgress(sessionId, {
      phase: 'done', percent: 100,
      message: `Terminé — ${result.notesCreated} post-it créés`,
    });

    res.json({
      ok: true,
      ...result,
      originalBytes: file.size,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Upload] Error:', msg);
    log(`Erreur : ${msg}`);
    socket?.emitUploadProgress(sessionId, { phase: 'error', percent: 0, message: msg });
    res.status(500).json({ error: msg });
  } finally {
    cleanupFile(file.path);
    if (cleanPath) cleanupFile(cleanPath);
  }
});

export default router;
