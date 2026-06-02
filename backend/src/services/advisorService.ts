import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '../db/sessionRepo.js';
import { getSocketService } from './socketService.js';
import type { AdvisorSuggestion } from '../../../shared/types.ts';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const ADVISOR_MODEL = process.env.ADVISOR_MODEL ?? 'claude-opus-4-5';
const ADVISOR_TRIGGER_EVERY_N = parseInt(process.env.ADVISOR_TRIGGER_EVERY_N ?? '5', 10);
const ADVISOR_BUFFER_MAX = parseInt(process.env.ADVISOR_BUFFER_MAX ?? '30', 10);
const ADVISOR_COOLDOWN_MS = parseInt(process.env.ADVISOR_COOLDOWN_MS ?? '15000', 10);

interface AdvisorBuffer {
  sessionId: string;
  utterances: Array<{ speaker: string; text: string; ts: string }>;
  utteranceCountSinceLastTrigger: number;
  lastTriggerAt: number;
  inFlight: boolean;
}

const buffers = new Map<string, AdvisorBuffer>();

function getBuffer(sessionId: string): AdvisorBuffer {
  let b = buffers.get(sessionId);
  if (!b) {
    b = {
      sessionId,
      utterances: [],
      utteranceCountSinceLastTrigger: 0,
      lastTriggerAt: 0,
      inFlight: false,
    };
    buffers.set(sessionId, b);
  }
  return b;
}

export function resetAdvisor(sessionId: string): void {
  buffers.delete(sessionId);
}

/**
 * Add an utterance to advisor buffer. Triggers advisor if:
 *  - Keyword detected in utterance text
 *  - Every Nth utterance (configurable via ADVISOR_TRIGGER_EVERY_N)
 */
export async function pushUtterance(
  sessionId: string,
  speakerName: string,
  text: string,
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;

  const buf = getBuffer(sessionId);
  buf.utterances.push({ speaker: speakerName || 'unknown', text, ts: new Date().toISOString() });
  if (buf.utterances.length > ADVISOR_BUFFER_MAX) {
    buf.utterances.splice(0, buf.utterances.length - ADVISOR_BUFFER_MAX);
  }
  buf.utteranceCountSinceLastTrigger += 1;

  const keyword = (session.advisor_keyword || 'Hey BoardBot').toLowerCase();
  const keywordHit = text.toLowerCase().includes(keyword);
  const countHit = buf.utteranceCountSinceLastTrigger >= ADVISOR_TRIGGER_EVERY_N;

  if (!keywordHit && !countHit) return;

  // Cooldown to avoid back-to-back triggers
  const now = Date.now();
  if (now - buf.lastTriggerAt < ADVISOR_COOLDOWN_MS) return;
  if (buf.inFlight) return;

  buf.inFlight = true;
  buf.lastTriggerAt = now;
  buf.utteranceCountSinceLastTrigger = 0;

  try {
    await triggerAdvisor(sessionId, keywordHit);
  } catch (err) {
    console.error('[Advisor] Trigger error:', err);
  } finally {
    buf.inFlight = false;
  }
}

/**
 * Manually invoke advisor (button-triggered).
 */
export async function manualAdvisor(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const buf = getBuffer(sessionId);
  if (buf.inFlight) return { ok: false, error: 'Advisor déjà en cours' };
  buf.inFlight = true;
  buf.lastTriggerAt = Date.now();
  buf.utteranceCountSinceLastTrigger = 0;
  try {
    await triggerAdvisor(sessionId, true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown' };
  } finally {
    buf.inFlight = false;
  }
}

async function triggerAdvisor(sessionId: string, explicit: boolean): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;

  const buf = getBuffer(sessionId);
  const socketService = getSocketService();
  const projectContext = (session.project_context ?? '').trim();
  const conversation = buf.utterances
    .map((u) => `[${u.speaker}] ${u.text}`)
    .join('\n');

  if (!conversation.trim()) {
    socketService?.emitBotLog(sessionId, `🧠 Advisor: pas encore assez de contenu.`);
    return;
  }

  const systemPrompt = `Tu es un Advisor IA expert qui aide le facilitateur d'un atelier collaboratif en temps réel.

ROLE:
- Tu écoutes la conversation et tu connais le contexte du projet.
- Tu suggères au facilitateur (pas aux participants) des actions concrètes pour faire avancer l'atelier.
- Tu fais des recoupements entre ce qui est dit et ce que tu sais du projet.

CONTEXTE PROJET:
${projectContext || '(aucun contexte fourni — base-toi uniquement sur la conversation)'}

INSTRUCTIONS:
- Sois bref et actionnable. UNE suggestion à la fois.
- Choisis le kind:
  * "question" → suggérer une question précise à poser au groupe
  * "insight" → faire un recoupement avec le contexte projet
  * "warning" → signaler un risque, contradiction, angle mort
  * "connection" → lier deux choses dites dans la conversation
- Le facilitateur lit ça en parallèle de la conversation, donc concis (< 200 caractères pour text).
- Le champ "reasoning" est court (< 150 caractères) et explique POURQUOI tu suggères ça.
- Si rien d'utile à dire maintenant, renvoie {"text": null}.

Réponds en JSON strict, format:
{"kind": "question|insight|warning|connection", "text": "...", "reasoning": "..."}`;

  const userPrompt = `CONVERSATION (récente):
${conversation}

${explicit ? "Le facilitateur t'invoque explicitement — donne ta meilleure suggestion maintenant." : "Suggère une intervention si pertinent."}`;

  const anthropic = getClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await anthropic.messages.create(
      {
        model: ADVISOR_MODEL,
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const content = response.content[0];
    if (content.type !== 'text') return;

    const cleanJson = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed: { kind?: string; text?: string | null; reasoning?: string };
    try {
      parsed = JSON.parse(cleanJson);
    } catch {
      console.warn('[Advisor] Invalid JSON:', cleanJson.slice(0, 200));
      return;
    }

    if (!parsed.text || !parsed.kind) return;

    const allowedKinds = ['question', 'insight', 'warning', 'connection'];
    const kind = allowedKinds.includes(parsed.kind) ? (parsed.kind as AdvisorSuggestion['kind']) : 'insight';

    const suggestion: AdvisorSuggestion = {
      kind,
      text: parsed.text,
      reasoning: parsed.reasoning,
      timestamp: new Date().toISOString(),
    };

    socketService?.emitAdvisorSuggestion(sessionId, suggestion);
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === 'AbortError') {
      console.warn('[Advisor] Timeout');
    } else {
      console.error('[Advisor] API error:', err);
    }
  }
}
