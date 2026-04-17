import { Router } from 'express';
import { createSession, getSession, addParticipant, endSession } from '../db/sessionRepo.js';

const router = Router();

// POST /api/sessions — créer une session
router.post('/', (req, res) => {
  const { title, language } = req.body;
  if (!title || typeof title !== 'string') {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  const allowedLanguages = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl'];
  const lang = typeof language === 'string' && allowedLanguages.includes(language) ? language : 'fr';
  const session = createSession(title.trim(), lang as 'fr' | 'en' | 'es' | 'de' | 'it' | 'pt' | 'nl');
  res.status(201).json(session);
});

// GET /api/sessions/:id — récupérer une session
router.get('/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

// POST /api/sessions/:id/end — terminer une session
router.post('/:id/end', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  endSession(req.params.id);
  res.json({ ok: true });
});

// POST /api/sessions/:id/participants — ajouter un participant
router.post('/:id/participants', (req, res) => {
  const { display_name, speaker_label } = req.body;
  if (!display_name || !speaker_label) {
    res.status(400).json({ error: 'display_name and speaker_label are required' });
    return;
  }
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const participant = addParticipant(req.params.id, display_name, speaker_label);
  res.status(201).json(participant);
});

export default router;
