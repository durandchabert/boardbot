import { Router } from 'express';
import { createSession, getSession, addParticipant, endSession, updateProjectContext, updateAdvisorKeyword } from '../db/sessionRepo.js';

const router = Router();

// POST /api/sessions — créer une session
router.post('/', (req, res) => {
  const { title, language, project_context, advisor_keyword } = req.body;
  if (!title || typeof title !== 'string') {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  const allowedLanguages = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl'];
  const lang = typeof language === 'string' && allowedLanguages.includes(language) ? language : 'fr';
  const ctx = typeof project_context === 'string' ? project_context.slice(0, 50000) : '';
  const keyword = typeof advisor_keyword === 'string' && advisor_keyword.trim() ? advisor_keyword.trim() : 'Hey BoardBot';
  const session = createSession(
    title.trim(),
    lang as 'fr' | 'en' | 'es' | 'de' | 'it' | 'pt' | 'nl',
    ctx,
    keyword,
  );
  res.status(201).json(session);
});

// PATCH /api/sessions/:id/context — édition contexte projet + mot-code advisor
router.patch('/:id/context', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const { project_context, advisor_keyword } = req.body;
  if (typeof project_context === 'string') {
    updateProjectContext(req.params.id, project_context.slice(0, 50000));
  }
  if (typeof advisor_keyword === 'string' && advisor_keyword.trim()) {
    updateAdvisorKeyword(req.params.id, advisor_keyword.trim());
  }
  res.json({ ok: true });
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

// POST /api/sessions/:id/advisor — invocation manuelle de l'advisor
router.post('/:id/advisor', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const { manualAdvisor } = await import('../services/advisorService.js');
  const result = await manualAdvisor(req.params.id);
  res.json(result);
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
