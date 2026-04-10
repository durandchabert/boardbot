import { Router } from 'express';
import { getDb } from '../db/schema.js';

const router = Router();

// GET /api/admin/stats — statistiques générales
router.get('/stats', (_req, res) => {
  const db = getDb();

  // Get today's date at 00:00 UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const totalSessions = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
  const activeSessions = (db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get() as { count: number }).count;
  const totalNotes = (db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number }).count;
  const notesToday = (db.prepare('SELECT COUNT(*) as count FROM notes WHERE created_at >= ?').get(todayIso) as { count: number }).count;
  const sessionsToday = (db.prepare('SELECT COUNT(*) as count FROM sessions WHERE created_at >= ?').get(todayIso) as { count: number }).count;

  res.json({
    total_sessions: totalSessions,
    active_sessions: activeSessions,
    total_notes: totalNotes,
    sessions_today: sessionsToday,
    notes_today: notesToday,
    server_time: new Date().toISOString(),
  });
});

// GET /api/admin/notes/today — liste des post-it du jour
router.get('/notes/today', (_req, res) => {
  const db = getDb();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const notes = db
    .prepare(
      `SELECT n.note_id, n.text, n.category, n.status, n.created_at,
              s.title as session_title, s.session_id
       FROM notes n
       JOIN sessions s ON n.session_id = s.session_id
       WHERE n.created_at >= ?
       ORDER BY n.created_at DESC`
    )
    .all(todayIso);

  res.json({ count: notes.length, notes });
});

// GET /api/admin/sessions/recent — sessions récentes avec leurs notes
router.get('/sessions/recent', (_req, res) => {
  const db = getDb();

  const sessions = db
    .prepare(
      `SELECT s.session_id, s.title, s.created_at, s.status,
              (SELECT COUNT(*) FROM notes WHERE session_id = s.session_id) as note_count,
              (SELECT COUNT(*) FROM participants WHERE session_id = s.session_id) as participant_count
       FROM sessions s
       ORDER BY s.created_at DESC
       LIMIT 20`
    )
    .all();

  res.json({ sessions });
});

// GET /api/admin/view — page HTML simple pour tout voir
router.get('/view', (_req, res) => {
  const db = getDb();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const totalSessions = (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
  const totalNotes = (db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number }).count;
  const notesToday = (db.prepare('SELECT COUNT(*) as count FROM notes WHERE created_at >= ?').get(todayIso) as { count: number }).count;
  const sessionsToday = (db.prepare('SELECT COUNT(*) as count FROM sessions WHERE created_at >= ?').get(todayIso) as { count: number }).count;

  const notes = db
    .prepare(
      `SELECT n.text, n.category, n.status, n.created_at, s.title as session_title, s.session_id
       FROM notes n
       JOIN sessions s ON n.session_id = s.session_id
       WHERE n.created_at >= ?
       ORDER BY n.created_at DESC
       LIMIT 100`
    )
    .all(todayIso) as Array<{
      text: string;
      category: string;
      status: string;
      created_at: string;
      session_title: string;
      session_id: string;
    }>;

  const sessions = db
    .prepare(
      `SELECT s.session_id, s.title, s.created_at, s.status,
              (SELECT COUNT(*) FROM notes WHERE session_id = s.session_id) as note_count
       FROM sessions s
       ORDER BY s.created_at DESC
       LIMIT 20`
    )
    .all() as Array<{ session_id: string; title: string; created_at: string; status: string; note_count: number }>;

  const categoryColors: Record<string, string> = {
    idea: '#4ecdc4',
    problem: '#ff6b6b',
    action: '#ffeaa7',
    question: '#dda0dd',
  };

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>BoardBot Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0f0f0f; color: #e8e8e8; padding: 30px; }
    h1 { margin-bottom: 20px; color: #4ecdc4; }
    h2 { margin: 30px 0 15px; color: #4ecdc4; font-size: 1.2rem; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .stat { background: #16213e; border: 1px solid #2a2a4a; border-radius: 8px; padding: 16px; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #4ecdc4; }
    .stat-label { color: #a0a0b0; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; }
    .note { background: #16213e; border-left: 4px solid; border-radius: 6px; padding: 12px 16px; margin-bottom: 8px; }
    .note-text { font-size: 0.95rem; margin-bottom: 4px; }
    .note-meta { font-size: 0.75rem; color: #6c6c7c; }
    .note-category { text-transform: uppercase; font-weight: 600; font-size: 0.7rem; margin-right: 8px; }
    .session { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 6px; padding: 12px 16px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; }
    .session-title { font-weight: 600; }
    .session-meta { font-size: 0.8rem; color: #a0a0b0; }
    .badge { background: #4ecdc4; color: #0f0f0f; padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 700; }
    .empty { color: #6c6c7c; font-style: italic; padding: 12px 0; }
    a { color: #4ecdc4; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .refresh { position: fixed; top: 20px; right: 20px; background: #4ecdc4; color: #0f0f0f; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <button class="refresh" onclick="location.reload()">Refresh</button>
  <h1>BoardBot Admin</h1>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${sessionsToday}</div>
      <div class="stat-label">Sessions aujourd'hui</div>
    </div>
    <div class="stat">
      <div class="stat-value">${notesToday}</div>
      <div class="stat-label">Notes aujourd'hui</div>
    </div>
    <div class="stat">
      <div class="stat-value">${totalSessions}</div>
      <div class="stat-label">Total sessions</div>
    </div>
    <div class="stat">
      <div class="stat-value">${totalNotes}</div>
      <div class="stat-label">Total notes</div>
    </div>
  </div>

  <h2>Post-it du jour (${notes.length})</h2>
  ${notes.length === 0 ? '<div class="empty">Aucune note aujourd\'hui</div>' :
    notes.map(n => `
      <div class="note" style="border-left-color: ${categoryColors[n.category] || '#666'}">
        <div class="note-text">${escapeHtml(n.text)}</div>
        <div class="note-meta">
          <span class="note-category" style="color: ${categoryColors[n.category] || '#666'}">${n.category}</span>
          · ${n.status}
          · <a href="/session/${n.session_id}/board">${escapeHtml(n.session_title)}</a>
          · ${new Date(n.created_at).toLocaleTimeString('fr-FR')}
        </div>
      </div>
    `).join('')}

  <h2>Sessions récentes (${sessions.length})</h2>
  ${sessions.length === 0 ? '<div class="empty">Aucune session</div>' :
    sessions.map(s => `
      <div class="session">
        <div>
          <div class="session-title"><a href="/session/${s.session_id}/board">${escapeHtml(s.title)}</a></div>
          <div class="session-meta">${new Date(s.created_at).toLocaleString('fr-FR')} · ${s.status}</div>
        </div>
        <span class="badge">${s.note_count} notes</span>
      </div>
    `).join('')}
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default router;
