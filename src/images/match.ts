import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod/v4';
import { MODEL } from '../extract/claude';

export const MatchResult = z.object({
  candidates: z.array(
    z.object({
      id: z.number().describe('Nummer des Fundstücks'),
      same_product: z.boolean().describe('gleiche Marke und gleiches Produkt wie im Prospekt'),
      same_variant: z.boolean().describe('gleiche Sorte/Geschmack/Packungsart (Größe darf leicht abweichen)'),
      clean_shot: z.boolean().describe('sauberes Produktfoto: Vorderseite, ganzes Produkt, einfarbiger oder transparenter Hintergrund, keine Collage, kein Wasserzeichen, kein Schachbrettmuster'),
      note: z.string().describe('kurze Begründung auf Deutsch'),
    }),
  ),
});
export type MatchResult = z.infer<typeof MatchResult>;

export interface ProductMatcher {
  /** Gibt pro Kandidat (Reihenfolge wie `candidates`) die Bewertung zurück. */
  compare(prospektCrop: string, candidates: string[], product: string): Promise<MatchResult['candidates']>;
}

export const MATCH_PROMPT = (product: string, n: number) => `Bild 0 ist ein Ausschnitt aus einem Supermarkt-Prospekt und zeigt: ${product}.
Die Bilder 1 bis ${n} wurden im Internet gefunden.

Prüfe für jedes Fundstück, ob es genau dieses Produkt zeigt (gleiche Marke, gleiches Produkt, gleiche Sorte und Verpackung – die Packungsgröße darf leicht abweichen, im Prospekt können mehrere Packungen nebeneinander stehen) und ob es sich als freigestelltes Produktfoto für eine Werbe-Story eignet.`;

async function image(file: string) {
  const ext = extname(file).toLowerCase();
  const media = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/png';
  return { type: 'image' as const, source: { type: 'base64' as const, media_type: media as 'image/png', data: (await readFile(file)).toString('base64') } };
}

export class ClaudeMatcher implements ProductMatcher {
  private client: Anthropic;
  constructor(apiKey = process.env.ANTHROPIC_API_KEY, baseURL?: string) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY fehlt');
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 4 });
  }

  async compare(prospektCrop: string, candidates: string[], product: string) {
    if (!candidates.length) return [];
    const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: 'Bild 0 (Prospekt):' }, await image(prospektCrop)];
    for (const [i, c] of candidates.entries()) content.push({ type: 'text', text: `Bild ${i + 1}:` }, await image(c));
    content.push({ type: 'text', text: MATCH_PROMPT(product, candidates.length) });
    const res = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: betaZodOutputFormat(MatchResult) },
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') throw new Error('Abgleich abgelehnt (refusal)');
    if (!res.parsed_output) throw new Error('Abgleich: Antwort nicht lesbar');
    const byId = new Map(res.parsed_output.candidates.map((c) => [c.id, c]));
    return candidates.map((_, i) => byId.get(i + 1) ?? { id: i + 1, same_product: false, same_variant: false, clean_shot: false, note: 'keine Bewertung' });
  }
}

/** Bester Kandidat: gleiches Produkt + gleiche Sorte + sauberes Foto; sonst keiner. */
export function pickBest(rated: MatchResult['candidates']): number | null {
  const i = rated.findIndex((r) => r.same_product && r.same_variant && r.clean_shot);
  return i >= 0 ? i : null;
}
