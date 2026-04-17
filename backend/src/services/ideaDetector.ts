import type { Utterance } from '../../../shared/types.ts';

// Fillers in both FR and EN — phrases we never want to process
const IGNORE_PATTERNS = /^(vraiment|ok|okay|d'accord|oui|non|ouais|voilà|exactement|c'est ça|merci|super|bien|ah|hmm|euh|hein|bon|bah|mhm|yeah|yep|nope|right|sure|thanks|uh|um|hmm|well)\s*[?!.]*$/i;

// Anti-spam: track last SUCCESSFUL note time per speaker per session
const lastNoteTime = new Map<string, number>();

// Shortened window: we only want to kill obvious double-triggers,
// not punish the user for talking normally.
const SPAM_WINDOW_MS = 1000;

function getSpamKey(sessionId: string, speakerLabel: string): string {
  return `${sessionId}:${speakerLabel}`;
}

export interface DetectionResult {
  shouldCreate: boolean;
  reason: string;
}

export function detectIdea(
  utterance: Utterance,
  sessionId: string
): DetectionResult {
  const text = utterance.transcript.trim().toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // Ignore utterances too short
  if (wordCount < 3) {
    return { shouldCreate: false, reason: 'too_short' };
  }

  // Ignore fillers
  if (IGNORE_PATTERNS.test(text)) {
    return { shouldCreate: false, reason: 'filler' };
  }

  // Ignore if confidence too low
  if (utterance.confidence < 0.6) {
    return { shouldCreate: false, reason: 'low_confidence' };
  }

  // Anti-spam: don't fire twice within SPAM_WINDOW_MS for same speaker.
  // IMPORTANT: do NOT mark the timestamp here — only after a note is successfully
  // created (via markNoteCreated) so that rejected phrases don't burn the cooldown.
  const spamKey = getSpamKey(sessionId, utterance.speaker_label);
  const lastTime = lastNoteTime.get(spamKey);
  const now = Date.now();
  if (lastTime && now - lastTime < SPAM_WINDOW_MS) {
    return { shouldCreate: false, reason: 'anti_spam' };
  }

  return { shouldCreate: true, reason: 'pass' };
}

// Call this AFTER a note is actually created so the cooldown only penalizes real notes.
export function markNoteCreated(sessionId: string, speakerLabel: string): void {
  lastNoteTime.set(getSpamKey(sessionId, speakerLabel), Date.now());
}
