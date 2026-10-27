import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { PageResult, PriceCheck } from './schema';

export const MODEL = process.env.SINCAPP_MODEL || 'claude-opus-5-5';

/** Liest Prospektseiten. Echte Implementierung: Claude; für Tests: aufgezeichnete Antworten. */
export interface PageReader {
  name: string;
  readPage(file: string, size: { width: number; height: number }): Promise<PageResult>;
  /** Preise einzeln von Schild-Ausschnitten lesen (Reihenfolge wie `crops`). */
  readPrices(crops: string[], pageFile: string): Promise<(string | null)[]>;
}

const PAGE_PROMPT = (w: number, h: number) => `Das ist eine Seite aus einem Supermarkt-Prospekt (türkischer bzw. internationaler Supermarkt in Deutschland). Das Bild ist ${w}×${h} Pixel groß.

Erfasse jedes Angebot auf der Seite – auch kleine und solche am Rand. Ein Angebot ist ein Produkt (oder eine Produktgruppe wie "diverse Sorten") mit eigenem Preisschild.

Je Angebot:
- brand: Marke wie gedruckt (z. B. "Egetürk"), sonst null.
- name_de: deutscher Produktname ohne Marke und ohne Menge, so wie im Prospekt (Schreibweise behalten, z. B. "Sırma Knoblauchwurst").
- name_tr: türkischer Name, so wie ihn eine türkische Kundin im Laden sagen würde, kurz (z. B. "Parmak Sucuk"). Nicht wörtlich übersetzen, wenn es einen üblichen Namen gibt.
- unit: Menge genau wie gedruckt ("1 kg", "5×140 g", "950 ml"), sonst null.
- price: Angebotspreis vom Preisschild, Ziffern genau wie gedruckt, Cent mit Punkt ("13.99"). Bei hochgestellten Cent: "1.69". Nie raten – wenn unlesbar, trotzdem die beste Lesung und niedrige confidence.
- note_de / note_tr: kurzer Zusatz wie "diverse Sorten", "scharf oder mild", "Karamell oder Erdbeere", sonst null.
- category: passende Warengruppe.
- bbox: Rechteck nur um das Produktfoto (alle Packungen dieses Angebots), ohne Preisschild, ohne Text, ohne Holzbrett/Podest darunter. Ist dasselbe Angebot in zwei getrennten Gruppen abgebildet, nimm die größere Gruppe.
- price_tag_bbox: Rechteck um das zugehörige Preisschild.
- confidence: 0–1.

Außerdem für die Seite: Marktname, Gültigkeitszeitraum (validFrom/validTo als YYYY-MM-DD; fehlt das Jahr beim Startdatum, nimm das Jahr des Enddatums), alle Filialadressen ("Straße Nr, PLZ Ort") und die Telefonnummer – jeweils null bzw. leer, wenn nicht auf dieser Seite.

Koordinaten in Pixeln dieses Bildes, Ursprung oben links.`;

const PRICE_PROMPT = `Jedes Bild ist ein Ausschnitt mit einem Preisschild aus einem Supermarkt-Prospekt. Lies den Angebotspreis auf jedem Schild, Ziffern genau wie gedruckt, Cent mit Punkt ("13.99"; hochgestellte Cent zählen als Nachkommastellen). Ist auf einem Ausschnitt kein Preis lesbar, gib null zurück.`;

async function imageBlock(file: string) {
  const ext = extname(file).toLowerCase();
  const media = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  return {
    type: 'image' as const,
    source: { type: 'base64' as const, media_type: media as 'image/png', data: (await readFile(file)).toString('base64') },
  };
}

export class ClaudeReader implements PageReader {
  name = MODEL;
  private client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY, baseURL?: string) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY fehlt – bitte in .env eintragen (siehe .env.example).');
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 4 });
  }

  private async parse<T>(content: Anthropic.Beta.BetaContentBlockParam[], format: ReturnType<typeof betaZodOutputFormat<any>>, effort: 'medium' | 'high'): Promise<T> {
    const res = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort, format },
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') throw new Error('Claude hat die Seite abgelehnt (refusal).');
    if (res.stop_reason === 'max_tokens') throw new Error('Antwort abgeschnitten (max_tokens).');
    if (!res.parsed_output) throw new Error('Antwort ließ sich nicht als JSON lesen.');
    return res.parsed_output as T;
  }

  async readPage(file: string, size: { width: number; height: number }) {
    return this.parse<PageResult>([await imageBlock(file), { type: 'text', text: PAGE_PROMPT(size.width, size.height) }], betaZodOutputFormat(PageResult), 'high');
  }

  async readPrices(crops: string[], _pageFile?: string) {
    if (!crops.length) return [];
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const [i, c] of crops.entries()) {
      content.push({ type: 'text', text: `Ausschnitt ${i + 1}:` }, await imageBlock(c));
    }
    content.push({ type: 'text', text: PRICE_PROMPT });
    const out = await this.parse<PriceCheck>(content, betaZodOutputFormat(PriceCheck), 'medium');
    const byId = new Map(out.prices.map((p) => [p.id, p.price]));
    return crops.map((_, i) => byId.get(i + 1) ?? null);
  }
}

/**
 * Liest gespeicherte Antworten aus einem Ordner: <seitenname>.json (PageResult)
 * und optional <seitenname>.prices.json (Array mit Preisen für den Gegencheck).
 * Ohne Preis-Datei bestätigt der Gegencheck die Preise der Seite.
 */
export class RecordedReader implements PageReader {
  name = 'aufgezeichnet';
  constructor(private dir: string) {}

  private stem(file: string) {
    return basename(file, extname(file));
  }

  async readPage(file: string) {
    const f = join(this.dir, `${this.stem(file)}.json`);
    if (!existsSync(f)) throw new Error(`Keine aufgezeichnete Antwort für ${basename(file)} (${f})`);
    return PageResult.parse(JSON.parse(await readFile(f, 'utf8')));
  }

  async readPrices(crops: string[], pageFile: string) {
    const f = join(this.dir, `${this.stem(pageFile)}.prices.json`);
    if (existsSync(f)) return JSON.parse(await readFile(f, 'utf8')) as (string | null)[];
    const page = await this.readPage(pageFile);
    const withTag = page.offers.filter((o) => o.price_tag_bbox);
    return crops.map((_, i) => withTag[i]?.price ?? null);
  }
}
