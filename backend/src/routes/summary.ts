import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '../db/sessionRepo.js';
import { getNotesBySession } from '../db/noteRepo.js';

const router = Router();

router.post('/:id/summary', async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const notes = getNotesBySession(req.params.id).filter((n) => n.status === 'validated');

  if (notes.length === 0) {
    res.json({ summary: 'Aucune note validée pour cette session.' });
    return;
  }

  const notesText = notes
    .map((n) => `- [${n.category}] ${n.text}`)
    .join('\n');

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: 'Tu es un assistant de réunion. Génère un résumé concis en français des notes de réunion fournies. Structure par thèmes, sois factuel.',
      messages: [
        {
          role: 'user',
          content: `Réunion : "${session.title}"\n\nNotes validées :\n${notesText}\n\nGénère un résumé en 3-5 phrases.`,
        },
      ],
    });

    const content = response.content[0];
    const summary = content.type === 'text' ? content.text : 'Erreur de génération';
    res.json({ summary });
  } catch (err) {
    console.error('[Summary] Error:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

export default router;
