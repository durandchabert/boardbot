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
        system: `Tu analyses des phrases prononcées en réunion. Tu décides si la phrase contient une idée, un problème, une action ou une question qui mérite d'être capturée sur un post-it.

Réponds UNIQUEMENT avec un JSON valide, sans markdown, sans backticks, sans explication.

Si la phrase est du bavardage, une transition, ou n'a pas de contenu actionnable, retourne : {"text": null, "confidence": 0}

Sinon retourne :
{"text": "résumé en 5-10 mots, style nominal", "category": "idea|problem|action|question", "confidence": 0.0-1.0}`,
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
        system: `Tu analyses si une phrase prononcée en réunion est une INSTRUCTION destinée au bot concernant les post-it récents.

Types d'instructions possibles :
- CORRECTION du texte : "en fait non c'est pas 5 mais 25", "je rectifie...", "pardon je voulais dire..."
- RECATÉGORISATION : "non mets-le dans idée", "c'est plutôt un problème", "ça c'est une action pas une idée"
- SUPPRESSION : "enlève le dernier", "supprime ça", "non oublie ce post-it"
- PAS UNE INSTRUCTION : la phrase est du contenu normal de réunion

Post-it récents :
${notesContext}

Réponds UNIQUEMENT avec un JSON valide, sans markdown, sans backticks.

Si c'est une correction de texte :
{"type": "correction", "note_id": "...", "corrected_text": "nouveau texte 5-10 mots", "log": "explication courte"}

Si c'est un changement de catégorie :
{"type": "recategorize", "note_id": "...", "new_category": "idea|problem|action|question", "log": "explication courte"}

Si c'est une suppression :
{"type": "delete", "note_id": "...", "log": "explication courte"}

Si ce n'est PAS une instruction :
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
        system: `Tu fais une revue des post-it d'une réunion en cours. Avec le contexte du transcript récent, tu vérifies si les post-it sont bien catégorisés et bien formulés.

Réponds UNIQUEMENT avec un JSON valide, sans markdown, sans backticks.

Retourne un tableau de modifications à appliquer. Ne modifie QUE les notes qui ont vraiment besoin d'être corrigées. Si tout est bon, retourne un tableau vide [].

Format : [{"note_id": "...", "text": "nouveau texte si changé", "category": "nouvelle catégorie si changée", "action": "update"}]

Règles :
- Ne change une catégorie QUE si elle est clairement incorrecte
- Améliore le texte seulement s'il est imprécis ou incomplet
- Ne touche PAS aux notes validées (status: validated)
- Maximum 3 modifications par revue`,
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
