// KI-Normierung von Produktnamen: jede neue Schreibweise einmal an die KI (nur Text, günstiges Modell), danach gemerkt.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { CHECK_MODEL, fallbackParams } from '../extract/claude';
import { logUsage } from './usage';

export const NameResult = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      brand: z.string().nullable().describe('Produktmarke, einheitliche Schreibweise, ohne Warenwort; null bei loser Ware'),
      de: z.string().describe('deutsche Produktart ohne Marke und Menge'),
      tr: z.string().describe('üblicher türkischer Name, höchstens 28 Zeichen'),
    }),
  ),
});
export type NameResult = z.infer<typeof NameResult>;

export interface NameItem {
  id: string;
  brand: string | null;
  de: string;
  tr: string;
  category: string;
}

/** Vereinheitlicht Produktnamen; `known` sind schon feste Namen ("Mevlana | Schwarztee | Siyah Çay"), die wiederverwendet werden sollen. */
export interface ProductNamer {
  normalize(items: NameItem[], known: string[]): Promise<NameResult['items']>;
}

export const NAME_PROMPT = (items: NameItem[], known: string[]) => `Du vereinheitlichst Produktnamen aus Supermarkt-Prospekten (türkische Supermärkte in Deutschland). Dasselbe Produkt soll in jedem Markt und jeder Woche exakt gleich heißen – nach dem Muster MARKE + PRODUKTART.

Regeln je Angebot:
- brand: die Produktmarke in einheitlicher Schreibweise, ohne Warenwort ("Mevlana", nicht "Mevlâna Çay" oder "Goran-Tee"; Hersteller, Importeur und Markt sind keine Marke). Steht die eigentliche Marke im Namen, ist sie die Marke. null bei loser Ware und Frischfleisch von der Theke.
- de: die übliche deutsche Produktart, kurz, ohne Marke, ohne Menge, ohne türkische Wörter ("Schwarztee", "Tomatenmark", "Sonnenblumenöl", "Gemischtes Hack", "Knoblauchwurst"). Werbe- und Herkunftszusätze weglassen ("Ceylon", "Sade", "Yaprak", "Premium", "Extra", "Original", "nach türkischer Art"). Eine echte Sorte, die eine andere Packung ist, bleibt im Namen ("Haselnusswaffeln", "Pfefferminztee", "Sucuk scharf").
- tr: der übliche türkische Name, wie ihn eine türkische Kundin im Laden sagt, höchstens 28 Zeichen ("Siyah Çay", "Domates Salçası", "Karışık Kıyma").
- Passt ein bekannter Name unten, nimm genau diesen (gleiche Marke, gleiche Schreibweise). Gleiche Produkte in der Liste bekommen identische Namen.
- id unverändert zurückgeben, jedes Angebot genau einmal.

Bekannte Namen (Marke | Deutsch | Türkisch):
${known.length ? known.join('\n') : '(noch keine)'}

Angebote (JSON):
${JSON.stringify(items)}`;

export class ClaudeNamer implements ProductNamer {
  private client: Anthropic;
  constructor(apiKey = process.env.ANTHROPIC_API_KEY, baseURL?: string) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY fehlt');
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 4 });
  }

  async normalize(items: NameItem[], known: string[]) {
    if (!items.length) return [];
    const res = await this.client.beta.messages.parse({
      model: CHECK_MODEL,
      max_tokens: 16000,
      ...fallbackParams(CHECK_MODEL),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: betaZodOutputFormat(NameResult) },
      messages: [{ role: 'user', content: NAME_PROMPT(items, known) }],
    });
    await logUsage({ model: CHECK_MODEL, task: 'namen', input: res.usage.input_tokens, output: res.usage.output_tokens });
    if (res.stop_reason === 'refusal') throw new Error('Namen: abgelehnt (refusal)');
    if (!res.parsed_output) throw new Error('Namen: Antwort nicht lesbar');
    return res.parsed_output.items;
  }
}
