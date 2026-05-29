import { v4 as uuid } from 'uuid';
import { getDb } from './schema.js';

// Tarifs (USD) — sources: dashboards Recall / Deepgram / Anthropic à date du commit.
// Ajustables via env si tarif change.
const RECALL_USD_PER_HOUR = parseFloat(process.env.RECALL_USD_PER_HOUR ?? '0.85');
const DEEPGRAM_USD_PER_MIN = parseFloat(process.env.DEEPGRAM_USD_PER_MIN ?? '0.0077');
const ANTHROPIC_USD_PER_NOTE = parseFloat(process.env.ANTHROPIC_USD_PER_NOTE ?? '0.003');

export interface BotUsageRow {
  usage_id: string;
  session_id: string;
  bot_id: string;
  start_at: string;
  end_at: string | null;
  duration_seconds: number | null;
  recall_cost_usd: number | null;
  deepgram_cost_usd: number | null;
  anthropic_cost_usd: number | null;
  total_cost_usd: number | null;
  notes_generated: number;
  video_enabled: number;
}

export function startBotUsage(sessionId: string, botId: string, videoEnabled: boolean): string {
  const db = getDb();
  const usageId = uuid();
  db.prepare(`
    INSERT INTO bot_usage (usage_id, session_id, bot_id, video_enabled)
    VALUES (?, ?, ?, ?)
  `).run(usageId, sessionId, botId, videoEnabled ? 1 : 0);
  return usageId;
}

export function endBotUsage(botId: string, notesGenerated: number = 0): BotUsageRow | null {
  const db = getDb();
  const row = db.prepare<[string], BotUsageRow>(`
    SELECT * FROM bot_usage WHERE bot_id = ? AND end_at IS NULL
    ORDER BY start_at DESC LIMIT 1
  `).get(botId);
  if (!row) return null;

  const startMs = Date.parse(row.start_at + 'Z');
  const endMs = Date.now();
  const durationSec = Math.max(1, Math.round((endMs - startMs) / 1000));
  const hours = durationSec / 3600;
  const minutes = durationSec / 60;

  const recallCost = hours * RECALL_USD_PER_HOUR;
  const deepgramCost = minutes * DEEPGRAM_USD_PER_MIN;
  const anthropicCost = notesGenerated * ANTHROPIC_USD_PER_NOTE;
  const total = recallCost + deepgramCost + anthropicCost;

  db.prepare(`
    UPDATE bot_usage SET
      end_at = datetime('now'),
      duration_seconds = ?,
      recall_cost_usd = ?,
      deepgram_cost_usd = ?,
      anthropic_cost_usd = ?,
      total_cost_usd = ?,
      notes_generated = ?
    WHERE usage_id = ?
  `).run(durationSec, recallCost, deepgramCost, anthropicCost, total, notesGenerated, row.usage_id);

  return {
    ...row,
    end_at: new Date().toISOString(),
    duration_seconds: durationSec,
    recall_cost_usd: recallCost,
    deepgram_cost_usd: deepgramCost,
    anthropic_cost_usd: anthropicCost,
    total_cost_usd: total,
    notes_generated: notesGenerated,
  };
}

export interface UsageSummary {
  total_calls: number;
  total_duration_hours: number;
  total_cost_usd: number;
  recall_cost_usd: number;
  deepgram_cost_usd: number;
  anthropic_cost_usd: number;
}

export function getUsageSummary(sinceIso?: string): UsageSummary {
  const db = getDb();
  const where = sinceIso ? `WHERE start_at >= ?` : ``;
  const params = sinceIso ? [sinceIso] : [];
  const row = db.prepare<typeof params, UsageSummary>(`
    SELECT
      COUNT(*) AS total_calls,
      COALESCE(SUM(duration_seconds), 0) / 3600.0 AS total_duration_hours,
      COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(recall_cost_usd), 0) AS recall_cost_usd,
      COALESCE(SUM(deepgram_cost_usd), 0) AS deepgram_cost_usd,
      COALESCE(SUM(anthropic_cost_usd), 0) AS anthropic_cost_usd
    FROM bot_usage
    ${where}
  `).get(...params);
  return row ?? { total_calls: 0, total_duration_hours: 0, total_cost_usd: 0, recall_cost_usd: 0, deepgram_cost_usd: 0, anthropic_cost_usd: 0 };
}

export function getRecentUsage(limit: number = 50): BotUsageRow[] {
  const db = getDb();
  return db.prepare<[number], BotUsageRow>(`
    SELECT * FROM bot_usage
    ORDER BY start_at DESC
    LIMIT ?
  `).all(limit);
}

export function getCurrentRates() {
  return {
    recall_usd_per_hour: RECALL_USD_PER_HOUR,
    deepgram_usd_per_min: DEEPGRAM_USD_PER_MIN,
    anthropic_usd_per_note: ANTHROPIC_USD_PER_NOTE,
  };
}
