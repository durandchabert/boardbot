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
        system: `You capture what someone just said on a sticky note in a live meeting. Your job is to PRESERVE what was said — not paraphrase, not abstract, not editorialize.

RULES:
1. The "text" field MUST be in the SAME LANGUAGE as the input transcript (French → French, English → English, etc.).
2. Keep all concrete details: names, numbers, dates, specific objects, specific actions.
3. 4 to 14 words. Use nominal/telegraphic style (no need for a full sentence) but never at the cost of meaning.
4. Do NOT generalize ("writing deadline" instead of "write chapter by Monday" is WRONG).
5. Do NOT add interpretation the speaker didn't make.
6. Classify into exactly one of: idea | problem | action | question.
7. If the sentence is small talk, a transition, filler, or has no real substance → {"text": null, "confidence": 0}.

GOOD examples:
- Heard: "I'll write the first chapter by next Monday." → {"text":"Write first chapter by Monday","category":"action","confidence":0.9}
- Heard: "The main problem is every dragon story has already been told." → {"text":"Every dragon story already told","category":"problem","confidence":0.85}
- Heard: "What if the dragon's best friend is a sentient lantern?" → {"text":"Friend is a sentient lantern","category":"idea","confidence":0.8}
- Heard: "Should the dragon speak or stay silent the whole book?" → {"text":"Should dragon speak or stay silent?","category":"question","confidence":0.85}
- Heard: "I'll ask my daughter what name she'd give the dragon." → {"text":"Ask daughter for dragon name","category":"action","confidence":0.85}

BAD examples (lose the concrete details — DO NOT do this):
- "I'll write the first chapter by next Monday." → "Writing deadline" ❌
- "Every dragon story already told." → "Originality issue" ❌
- "Ask my daughter what name she'd give the dragon." → "Get input" ❌

Reply ONLY with valid JSON, no markdown, no backticks, no explanation.
Format: {"text": "...", "category": "idea|problem|action|question", "confidence": 0.0-1.0}`,
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
