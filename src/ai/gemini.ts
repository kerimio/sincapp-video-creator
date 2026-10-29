import { GoogleGenAI, ThinkingLevel, createPartFromBase64, type Part } from '@google/genai';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod/v4';
import { PAGE_PROMPT, PRICE_PROMPT, type PageReader } from '../extract/claude';
import { PageOffer, PageResult, PriceCheck } from '../extract/schema';
import { MATCH_PROMPT, MatchResult, type ProductMatcher } from '../images/match';
import { logUsage } from './usage';
import { NAME_PROMPT, NameResult, type NameItem, type ProductNamer } from './namer';

/**
 * Modell fürs Lesen der Seiten. Standard ist das günstige Flash-Modell (der Preis-Gegencheck
 * fängt Lesefehler ab); für schwierige Prospekte GEMINI_MODEL=gemini-4-argon setzen.
 */
export const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const GEMINI_MODEL = geminiModel();
/** Günstigeres Modell für einfache Aufgaben: Preisschilder gegenlesen, Produktfotos vergleichen. */
export const geminiCheckModel = () => process.env.GEMINI_CHECK_MODEL || 'gemini-3.8-flash';

async function imagePart(file: string): Promise<Part> {
  const ext = extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/png';
  return createPartFromBase64((await readFile(file)).toString('base64'), mime);
}

/** Gemini mit JSON-Schema (aus den zod-Schemas) aufrufen und die Antwort gegen dasselbe Schema prüfen. */
export class GeminiClient {
  private ai: GoogleGenAI;
  constructor(apiKey = process.env.GEMINI_API_KEY, baseUrl?: string) {
    if (!apiKey) throw new Error('GEMINI_API_KEY fehlt – bitte unter Einstellungen eintragen.');
    this.ai = new GoogleGenAI({ apiKey, httpOptions: baseUrl ? { baseUrl } : undefined });
  }

  /**
   * Kosten sparen: wenig "Nachdenken" (Denk-Tokens kosten wie Ausgabe), und bei kaputter Antwort
   * nur einmal neu fragen. Überlast (429/503, wird nicht berechnet) darf öfter wiederholt werden –
   * so lange, wie Gemini selbst zu warten bittet (Minutenlimit: "retry in 37s"), sonst fehlen ganze Seiten.
   */
  async json<S extends z.ZodType>(schema: S, parts: Part[], model = geminiModel(), opts: { task?: string; thinking?: ThinkingLevel } = {}): Promise<z.infer<S>> {
    let last: Error | null = null;
    let thinking: ThinkingLevel | undefined = opts.thinking ?? ThinkingLevel.LOW;
    let paidRetries = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await this.ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: {
            responseMimeType: 'application/json',
            responseJsonSchema: z.toJSONSchema(schema, { target: 'draft-2020-12' }),
            maxOutputTokens: 32000,
            ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
          },
        });
        const u = res.usageMetadata;
        await logUsage({ model, task: opts.task ?? 'ki', input: u?.promptTokenCount ?? 0, output: u?.candidatesTokenCount ?? 0, thinking: u?.thoughtsTokenCount ?? 0 });
        const reason = res.candidates?.[0]?.finishReason;
        if (reason === 'MAX_TOKENS') throw new Error('Antwort abgeschnitten (MAX_TOKENS).');
        if (reason && reason !== 'STOP') throw new Error(`Gemini hat abgebrochen (${reason}).`);
        const text = res.text;
        if (!text) throw new Error('Gemini hat keine Antwort geliefert.');
        return schema.parse(JSON.parse(text));
      } catch (e) {
        last = e as Error;
        const msg = last.message;
        // Modell kennt die Denk-Einstellung nicht (400, kostet nichts) → ohne sie noch einmal
        if (thinking && /thinking/i.test(msg) && /400|INVALID_ARGUMENT/i.test(msg)) {
          thinking = undefined;
          continue;
        }
        // Tageskontingent aufgebraucht: Warten hilft heute nicht mehr – verständlich melden statt still Seiten zu verlieren
        if (/429|RESOURCE_EXHAUSTED/.test(msg) && /PerDay/i.test(msg)) throw new Error(QUOTA_DAY);
        const transient = /429|500|503|UNAVAILABLE|RESOURCE_EXHAUSTED|fetch failed/i.test(msg);
        const broken = /JSON|Expected|Invalid|abgeschnitten|keine Antwort/i.test(msg);
        if (!transient && !(broken && paidRetries++ < 1)) break;
        if (attempt === 5) break;
        await new Promise((r) => setTimeout(r, Math.min(65000, Math.max(2000 * 2 ** attempt, (retryAfter(msg) ?? 0) + 500))));
      }
    }
    if (last && /429|RESOURCE_EXHAUSTED/.test(last.message)) throw new Error(QUOTA_MINUTE);
    throw last!;
  }
}

export const QUOTA_DAY = 'Gemini: Das Tageskontingent des API-Keys ist aufgebraucht. Ab morgen geht es weiter – oder in Google AI Studio die Abrechnung aktivieren.';
export const QUOTA_MINUTE = 'Gemini: zu viele Anfragen pro Minute (Kontingent des API-Keys). Bitte in ein paar Minuten noch einmal versuchen.';

/** Wartezeit, die Gemini bei Überlast selbst nennt ("retryDelay":"37s" oder "Please retry in 37.2s"), in ms. */
export function retryAfter(msg: string): number | null {
  const m = msg.match(/retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)s"/) ?? msg.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

/**
 * Gemini ist auf Rechtecke im Format [ymin, xmin, ymax, xmax], normiert auf 0–1000, trainiert.
 * So wird gefragt und danach in Pixel [x0, y0, x1, y1] umgerechnet.
 */
const Box2d = z.array(z.number()).describe('[ymin, xmin, ymax, xmax], normiert auf 0–1000');
const GeminiPage = PageResult.extend({
  offers: z.array(
    PageOffer.extend({
      bbox: Box2d.describe('Nur das Produktfoto (alle Packungen des Angebots), ohne Preisschild, Text und Podest/Brett – [ymin, xmin, ymax, xmax] 0–1000'),
      price_tag_bbox: Box2d.nullable().describe('Das Preisschild dieses Angebots – [ymin, xmin, ymax, xmax] 0–1000; null wenn keins zu sehen ist'),
    }),
  ),
});
const BOX_NOTE = 'Wichtig, abweichend von oben: Gib alle Rechtecke (bbox, price_tag_bbox) als [ymin, xmin, ymax, xmax] an, normiert auf 0–1000.';

export function toPixels(b: number[], size: { width: number; height: number }): number[] {
  const [ymin, xmin, ymax, xmax] = b;
  const sx = size.width / 1000;
  const sy = size.height / 1000;
  return [Math.round(xmin * sx), Math.round(ymin * sy), Math.round(xmax * sx), Math.round(ymax * sy)];
}

export class GeminiReader implements PageReader {
  name = geminiModel();
  private client: GeminiClient;
  constructor(apiKey?: string, baseUrl?: string) {
    this.client = new GeminiClient(apiKey, baseUrl);
  }

  async readPage(file: string, size: { width: number; height: number }) {
    const r = await this.client.json(GeminiPage, [await imagePart(file), { text: `${PAGE_PROMPT(size.width, size.height)}\n\n${BOX_NOTE}` }], geminiModel(), { task: 'seite' });
    return PageResult.parse({
      ...r,
      offers: r.offers.map((o) => ({ ...o, bbox: toPixels(o.bbox, size), price_tag_bbox: o.price_tag_bbox ? toPixels(o.price_tag_bbox, size) : null })),
    });
  }

  async readPrices(crops: string[], _pageFile?: string) {
    if (!crops.length) return [];
    const parts: Part[] = [];
    for (const [i, c] of crops.entries()) parts.push({ text: `Ausschnitt ${i + 1}:` }, await imagePart(c));
    parts.push({ text: `${PRICE_PROMPT} Nummeriere die Ausschnitte mit id 1 bis ${crops.length}.` });
    const out = await this.client.json(PriceCheck, parts, geminiCheckModel(), { task: 'preise', thinking: ThinkingLevel.MINIMAL });
    const byId = new Map(out.prices.map((p) => [p.id, p.price]));
    return crops.map((_, i) => byId.get(i + 1) ?? null);
  }
}

export class GeminiMatcher implements ProductMatcher {
  private client: GeminiClient;
  constructor(apiKey?: string, baseUrl?: string) {
    this.client = new GeminiClient(apiKey, baseUrl);
  }

  async compare(prospektCrop: string, candidates: string[], product: string) {
    if (!candidates.length) return [];
    const parts: Part[] = [{ text: 'Bild 0 (Prospekt):' }, await imagePart(prospektCrop)];
    for (const [i, c] of candidates.entries()) parts.push({ text: `Bild ${i + 1}:` }, await imagePart(c));
    parts.push({ text: MATCH_PROMPT(product, candidates.length) });
    const out = await this.client.json(MatchResult, parts, geminiCheckModel(), { task: 'bilder', thinking: ThinkingLevel.MINIMAL });
    const byId = new Map(out.candidates.map((c) => [c.id, c]));
    return candidates.map((_, i) => byId.get(i + 1) ?? { id: i + 1, same_product: false, same_variant: false, clean_shot: false, note: 'keine Bewertung' });
  }
}

export class GeminiNamer implements ProductNamer {
  private client: GeminiClient;
  constructor(apiKey?: string, baseUrl?: string) {
    this.client = new GeminiClient(apiKey, baseUrl);
  }

  async normalize(items: NameItem[], known: string[]) {
    if (!items.length) return [];
    const out = await this.client.json(NameResult, [{ text: NAME_PROMPT(items, known) }], geminiCheckModel(), { task: 'namen', thinking: ThinkingLevel.MINIMAL });
    return out.items;
  }
}
