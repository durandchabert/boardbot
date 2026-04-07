import { Router } from 'express';

const router = Router();

// POST /api/recall/webhook/:sessionId — webhook Recall.ai real-time transcription
router.post('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const { handleWebhook } = await import('../services/recallService.js');
    await handleWebhook(sessionId, req.body);
  } catch (err) {
    console.error('[Webhook] Error:', err);
  }

  res.json({ ok: true });
});

export default router;
