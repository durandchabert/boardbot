import { Router } from 'express';
import { getNotesBySession, getNote, updateNote, deleteNote, createNote } from '../db/noteRepo.js';
import { getSession } from '../db/sessionRepo.js';
import { getSocketService } from '../services/socketService.js';

const router = Router();

// GET /api/sessions/:id/notes — lister les notes d'une session
router.get('/sessions/:id/notes', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const notes = getNotesBySession(req.params.id);
  res.json(notes);
});

// POST /api/sessions/:id/notes — créer une note manuellement
router.post('/sessions/:id/notes', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const { text, category, author_participant_id } = req.body;
  if (!text || !category) {
    res.status(400).json({ error: 'text and category are required' });
    return;
  }

  const note = createNote({
    session_id: req.params.id,
    text,
    author_participant_id: author_participant_id ?? '',
    category,
    position: req.body.position ?? { x: Math.random() * 600 + 50, y: Math.random() * 400 + 50 },
    source_utterance_id: '',
  });

  const socketService = getSocketService();
  if (socketService) {
    socketService.emitNoteCreated(req.params.id, note);
  }

  res.status(201).json(note);
});

// PATCH /api/notes/:id — modifier une note
router.patch('/notes/:id', (req, res) => {
  const note = getNote(req.params.id);
  if (!note) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }
  const updated = updateNote(req.params.id, req.body);
  if (updated) {
    const socketService = getSocketService();
    if (socketService) {
      socketService.emitNoteUpdated(note.session_id, updated);
    }
  }
  res.json(updated);
});

// DELETE /api/notes/:id — supprimer une note
router.delete('/notes/:id', (req, res) => {
  const note = getNote(req.params.id);
  if (!note) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }
  deleteNote(req.params.id);
  const socketService = getSocketService();
  if (socketService) {
    socketService.emitNoteDeleted(note.session_id, req.params.id);
  }
  res.json({ ok: true });
});

export default router;
