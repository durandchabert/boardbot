import { Router } from 'express';
import multer from 'multer';
import { getSession } from '../db/sessionRepo.js';
import { getDeepgramService } from '../services/deepgramService.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

// POST /api/sessions/:id/audio — recevoir un chunk audio
router.post('/:id/audio', upload.single('audio'), (req, res) => {
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

export default router;
