import Anthropic from '@anthropic-ai/sdk';
import type { NoteCategory, StickyNote } from '../../../shared/types.ts';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export interface GeneratedNote {
  text: string;
  category: NoteCategory;
  confidence: number;
}

export async function generateNoteText(
  transcript: string
): Promise<GeneratedNote | null> {
  const anthropic = getClient();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await anthropic.messages.create(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system: `You analyze sentences spoken in a meeting. Decide if the sentence contains an idea, a problem, an action, or a question worth capturing on a sticky note.

CRITICAL: The "text" field MUST be written in the SAME LANGUAGE as the input transcript. If the transcript is in French, respond in French. If in English, respond in English. If in Spanish, respond in Spanish. Etc.

Reply ONLY with valid JSON, no markdown, no backticks, no explanation.

If the sentence is small talk, a transition, or has no actionable content, return: {"text": null, "confidence": 0}

Otherwise return:
{"text": "5-10 word summary in the transcript's language, nominal style", "category": "idea|problem|action|question", "confidence": 0.0-1.0}`,
        messages: [
          {
            role: 'user',
            content: `"${transcript}"`,
          },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const content = response.content[0];
    if (content.type !== 'text') return null;

    const cleanJson = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleanJson) as {
      text: string | null;
      category?: NoteCategory;
      confidence: number;
    };

    if (!parsed.text || parsed.confidence < 0.4 || !parsed.category) return null;

    return { text: parsed.text, category: parsed.category, confidence: parsed.confidence };
  } catch (err) {
    clearTimeout(timeout);
    console.error('[NoteGenerator] Error:', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface InstructionResult {
  type: 'correction' | 'recategorize' | 'delete' | 'none';
  noteId: string | null;
  correctedText?: string;
  newCategory?: NoteCategory;
  logMessage: string;
}

/**
 * Détecte si une phrase est une instruction (correction, recatégorisation, suppression)
 * concernant un post-it récent.
 */
export async function detectInstruction(
  transcript: string,
  recentNotes: StickyNote[]
): Promise<InstructionResult> {
  if (recentNotes.length === 0) {
    return { type: 'none', noteId: null, logMessage: '' };
  }

  const anthropic = getClient();

  const notesContext = recentNotes
    .map((n) => `[${n.note_id}] "${n.text}" (${n.category})`)
    .join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await anthropic.messages.create(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: `You analyze whether a sentence spoken in a meeting is an INSTRUCTION to the bot regarding recent sticky notes. The meeting can be in ANY language — detect instructions regardless of the language used.

Possible instruction types:
- TEXT CORRECTION: "actually it's not 5 but 25", "let me correct that", "I meant to say..." (and equivalents in any language)
- RECATEGORIZATION: "no put it under idea", "that's more of a problem", "that's an action not an idea" (and equivalents in any language)
- DELETION: "remove the last one", "delete that", "forget that sticky note" (and equivalents in any language)
- NOT AN INSTRUCTION: the sentence is normal meeting content

Recent sticky notes:
${notesContext}

CRITICAL: The "corrected_text" field MUST be written in the SAME LANGUAGE as the input transcript.

Reply ONLY with valid JSON, no markdown, no backticks.

If it's a text correction:
{"type": "correction", "note_id": "...", "corrected_text": "new 5-10 word text in transcript's language", "log": "short explanation"}

If it's a category change:
{"type": "recategorize", "note_id": "...", "new_category": "idea|problem|action|question", "log": "short explanation"}

If it's a deletion:
{"type": "delete", "note_id": "...", "log": "short explanation"}

If it is NOT an instruction:
{"type": "none"}`,
        messages: [
          {
            role: 'user',
            content: `"${transcript}"`,
          },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const content = response.content[0];
    if (content.type !== 'text') return { type: 'none', noteId: null, logMessage: '' };

    const cleanJson = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleanJson) as {
      type: string;
      note_id?: string;
      corrected_text?: string;
      new_category?: NoteCategory;
      log?: string;
    };

    if (parsed.type === 'none' || !parsed.type) {
      return { type: 'none', noteId: null, logMessage: '' };
    }

    return {
      type: parsed.type as InstructionResult['type'],
      noteId: parsed.note_id ?? null,
      correctedText: parsed.corrected_text,
      newCategory: parsed.new_category,
      logMessage: parsed.log ?? '',
    };
  } catch (err) {
    clearTimeout(timeout);
    console.error('[NoteGenerator] Instruction detection error:', err instanceof Error ? err.message : err);
    return { type: 'none', noteId: null, logMessage: '' };
  }
}

/**
 * Revue périodique : Claude relit les notes récentes avec le transcript complet
 * et peut proposer des corrections/recatégorisations.
 */
export async function reviewNotes(
  notes: StickyNote[],
  recentTranscript: string
): Promise<Array<{ note_id: string; text?: string; category?: NoteCategory; action: 'update' | 'delete' }>> {
  if (notes.length === 0) return [];

  const anthropic = getClient();

  const notesContext = notes
    .map((n) => `[${n.note_id}] "${n.text}" (${n.category}) — status: ${n.status}`)
    .join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await anthropic.messages.create(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: `You review the sticky notes of an ongoing meeting. Using the context of the recent transcript, you verify that the sticky notes are correctly categorized and well worded.

CRITICAL: When rewriting "text", MUST use the SAME LANGUAGE as the input transcript.

Reply ONLY with valid JSON, no markdown, no backticks.

Return an array of modifications to apply. ONLY modify notes that really need correction. If everything is fine, return an empty array [].

Format: [{"note_id": "...", "text": "new text if changed, in transcript's language", "category": "new category if changed", "action": "update"}]

Rules:
- Only change a category if it is clearly incorrect
- Only improve the text if it is imprecise or incomplete
- Do NOT touch validated notes (status: validated)
- Maximum 3 modifications per review`,
        messages: [
          {
            role: 'user',
            content: `Post-it actuels :\n${notesContext}\n\nTranscript récent :\n"${recentTranscript.slice(-2000)}"`,
          },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const content = response.content[0];
    if (content.type !== 'text') return [];

    const cleanJson = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleanJson) as Array<{
      note_id: string;
      text?: string;
      category?: NoteCategory;
      action: 'update' | 'delete';
    }>;

    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch (err) {
    clearTimeout(timeout);
    console.error('[Review] Error:', err instanceof Error ? err.message : err);
    return [];
  }
}
