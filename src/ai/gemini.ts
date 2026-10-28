import { GoogleGenAI, createPartFromBase64, type Part } from '@google/genai';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { z } from 'zod/v4';
import { PAGE_PROMPT, PRICE_PROMPT, type PageReader } from '../extract/claude';
import { PageOffer, PageResult, PriceCheck } from '../extract/schema';
import { MATCH_PROMPT, MatchResult, type ProductMatcher } from '../images/match';

/** Modell fürs Lesen der Seiten; änderbar mit GEMINI_MODEL, z. B. gemini-3.8-flash (schneller, günstiger). */
export const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-4-argon';
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

  async json<S extends z.ZodType>(schema: S, parts: Part[], model = geminiModel()): Promise<z.infer<S>> {
    let last: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: { responseMimeType: 'application/json', responseJsonSchema: z.toJSONSchema(schema, { target: 'draft-2020-12' }), maxOutputTokens: 32000 },
        });
        const reason = res.candidates?.[0]?.finishReason;
        if (reason === 'MAX_TOKENS') throw new Error('Antwort abgeschnitten (MAX_TOKENS).');
        if (reason && reason !== 'STOP') throw new Error(`Gemini hat abgebrochen (${reason}).`);
        const text = res.text;
        if (!text) throw new Error('Gemini hat keine Antwort geliefert.');
        return schema.parse(JSON.parse(text));
      } catch (e) {
        last = e as Error;
        // nur bei Überlast/Netz/kaputtem JSON nochmal versuchen
        if (!/429|500|503|UNAVAILABLE|RESOURCE_EXHAUSTED|fetch failed|JSON|Expected|Invalid/i.test(last.message)) break;
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      }
    }
    throw last!;
  }
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
    const r = await this.client.json(GeminiPage, [await imagePart(file), { text: `${PAGE_PROMPT(size.width, size.height)}\n\n${BOX_NOTE}` }]);
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
    const out = await this.client.json(PriceCheck, parts, geminiCheckModel());
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
    const out = await this.client.json(MatchResult, parts, geminiCheckModel());
    const byId = new Map(out.candidates.map((c) => [c.id, c]));
    return candidates.map((_, i) => byId.get(i + 1) ?? { id: i + 1, same_product: false, same_variant: false, clean_shot: false, note: 'keine Bewertung' });
  }
}
