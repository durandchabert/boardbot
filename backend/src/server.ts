import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Charger le .env — en prod il est dans le même dossier, en dev un niveau au-dessus
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { SocketService } from './services/socketService.js';
import { DeepgramService } from './services/deepgramService.js';
import sessionRoutes from './routes/sessions.js';
import noteRoutes from './routes/notes.js';
import audioRoutes from './routes/audio.js';
import summaryRoutes from './routes/summary.js';
import botRoutes from './routes/bot.js';
import webhookRoutes from './routes/webhook.js';
import { getDb } from './db/schema.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Init DB
getDb();
console.log('[DB] SQLite initialized');

// Init services
new SocketService(httpServer, FRONTEND_URL);
console.log('[Socket.IO] Initialized');

new DeepgramService();
console.log('[Deepgram] Service initialized');

// Routes
app.use('/api/sessions', sessionRoutes);
app.use('/api', noteRoutes);
app.use('/api/sessions', audioRoutes);
app.use('/api/sessions', summaryRoutes);
app.use('/api/sessions', botRoutes);
app.use('/api/recall/webhook', webhookRoutes);

// Serve frontend static files in production
const frontendDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback — serve index.html for all non-API routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] BoardBot backend running on http://0.0.0.0:${PORT}`);
});
