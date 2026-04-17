import { Router } from 'express';
import { getSession } from '../db/sessionRepo.js';

const router = Router();

// POST /api/sessions/:id/bot/start — lancer le bot Recall.ai
router.post('/:id/bot/start', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { meeting_url, bot_name } = req.body;
  if (!meeting_url) {
    res.status(400).json({ error: 'meeting_url is required' });
    return;
  }

  try {
    const { startRecallBot } = await import('../services/recallService.js');
    const result = await startRecallBot(req.params.id, meeting_url, bot_name ?? 'BoardBot', session.language);
    if (result.ok) {
      res.json({ ok: true, botId: result.botId });
    } else {
      res.status(400).json({ ok: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to start bot' });
  }
});

// POST /api/sessions/:id/bot/stop — arrêter le bot
router.post('/:id/bot/stop', async (req, res) => {
  try {
    const { stopRecallBot } = await import('../services/recallService.js');
    await stopRecallBot(req.params.id);
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

// GET /api/sessions/:id/bot/status — statut du bot
router.get('/:id/bot/status', async (req, res) => {
  try {
    const { getRecallBotStatus } = await import('../services/recallService.js');
    const bot = getRecallBotStatus(req.params.id);
    if (!bot) {
      res.json({ active: false });
    } else {
      res.json({ active: true, status: bot.status, meetingUrl: bot.meetingUrl });
    }
  } catch {
    res.json({ active: false });
  }
});

export default router;
