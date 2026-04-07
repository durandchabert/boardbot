import type { NoteCategory, Utterance } from '../../../shared/types.ts';

const IGNORE_PATTERNS = /^(vraiment|ok|d'accord|oui|non|ouais|voilà|exactement|c'est ça|merci|super|bien|ah|hmm|euh|hein|bon|bah|mhm|okay)\s*[?!.]*$/i;

// Anti-spam: track last note time per speaker per session
const lastNoteTime = new Map<string, number>();

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

  // Ignorer les utterances trop courtes
  if (wordCount < 5) {
    return { shouldCreate: false, reason: 'too_short' };
  }

  // Ignorer les fillers
  if (IGNORE_PATTERNS.test(text)) {
    return { shouldCreate: false, reason: 'filler' };
  }

  // Ignorer si confidence trop basse
  if (utterance.confidence < 0.7) {
    return { shouldCreate: false, reason: 'low_confidence' };
  }

  // Anti-spam : pas deux notes du même speaker en 3 secondes
  const spamKey = getSpamKey(sessionId, utterance.speaker_label);
  const lastTime = lastNoteTime.get(spamKey);
  const now = Date.now();
  if (lastTime && now - lastTime < 3000) {
    return { shouldCreate: false, reason: 'anti_spam' };
  }

  // Marquer le timestamp
  lastNoteTime.set(spamKey, now);

  return { shouldCreate: true, reason: 'pass' };
}
