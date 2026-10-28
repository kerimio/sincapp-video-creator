import { z } from 'zod/v4';

/** Warengruppen für die gemischte Auswahl (Meilenstein 3) und den Themenfilter. */
export const CATEGORIES = [
  'fleisch',
  'wurst',
  'kaese_milch',
  'obst_gemuese',
  'grundnahrung',
  'konserven',
  'backwaren',
  'suesses',
  'snacks',
  'getraenke',
  'tiefkuehl',
  'haushalt',
  'drogerie',
  'sonstiges',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Pixel-Rechteck im gesendeten Seitenbild: [x0, y0, x1, y1]. */
const Box = z.array(z.number()).describe('[x0, y0, x1, y1] in Pixeln des Bildes, Ursprung oben links');

/** Was Claude pro Prospektseite zurückgibt (Structured Output). */
export const PageOffer = z.object({
  brand: z.string().nullable().describe('Marke wie gedruckt, z. B. "Egetürk"; null wenn keine'),
  name_de: z.string().describe('Produktname auf Deutsch, ohne Marke, ohne Menge'),
  name_tr: z.string().describe('Produktname auf Türkisch, natürlich formuliert, ohne Marke, ohne Menge'),
  unit: z.string().nullable().describe('Menge/Einheit wie gedruckt, z. B. "1 kg", "5×140 g", "950 ml"; null wenn keine'),
  price: z.string().describe('Angebotspreis genau wie auf dem Preisschild, z. B. "13.99"'),
  note_de: z.string().nullable().describe('kurzer Zusatz wie "diverse Sorten" oder "scharf oder mild"; sonst null'),
  note_tr: z.string().nullable().describe('derselbe Zusatz auf Türkisch; sonst null'),
  category: z.enum(CATEGORIES),
  bbox: Box.describe('Nur das Produktfoto (alle Packungen des Angebots), ohne Preisschild, Text und Podest/Brett'),
  price_tag_bbox: Box.nullable().describe('Das Preisschild dieses Angebots; null wenn keins zu sehen ist'),
  confidence: z.number().describe('0–1: wie sicher die Angaben zu diesem Angebot stimmen'),
});
export type PageOffer = z.infer<typeof PageOffer>;

export const PageResult = z.object({
  market: z.string().nullable().describe('Name des Marktes laut Prospekt'),
  validFrom: z.string().nullable().describe('Beginn der Gültigkeit als YYYY-MM-DD'),
  validTo: z.string().nullable().describe('Ende der Gültigkeit als YYYY-MM-DD'),
  addresses: z.array(z.string()).describe('Filialadressen wie gedruckt, z. B. "Lange Laube 3, 30159 Hannover"'),
  phone: z.string().nullable(),
  offers: z.array(PageOffer),
});
export type PageResult = z.infer<typeof PageResult>;

/** Zweiter Durchgang: Preise einzeln von den Schild-Ausschnitten lesen. */
export const PriceCheck = z.object({
  prices: z.array(
    z.object({
      id: z.number().describe('Nummer des Ausschnitts'),
      price: z.string().nullable().describe('Preis wie gedruckt, z. B. "13.99"; null wenn nicht lesbar'),
    }),
  ),
});
export type PriceCheck = z.infer<typeof PriceCheck>;

/** Ein Angebot nach Normalisierung, so wie es in extraction.json steht. */
export interface ExtractedOffer {
  id: string;
  page: number;
  pageFile: string;
  brand: string | null;
  name: { de: string; tr: string };
  /** Zeilen für das Template; TR max. 2 × 14 Zeichen. */
  lines: { de: string[]; tr: string[] };
  unit: string | null;
  /** Immer im Format "13,99" oder null, wenn unlesbar. */
  price: string | null;
  note: { de: string; tr: string } | null;
  category: Category;
  bbox: [number, number, number, number];
  priceTagBbox: [number, number, number, number] | null;
  confidence: number;
  /** < 0.9 heißt: Preis von Hand prüfen. */
  priceConfidence: number;
  /** Freigestelltes Bild relativ zum Job-Ordner. */
  img?: string;
  imgSource?: 'library' | 'web' | 'prospekt' | 'removebg' | 'manual';
  /** Fundstücke aus dem Internet; `file` relativ zum Job-Ordner, `verdict` vom Abgleich mit dem Prospekt */
  imgAlternatives?: { source: string; url: string; title: string; file?: string; match?: boolean; verdict?: string }[];
  /** Markt, aus dessen Prospekt das Angebot stammt – nur bei Videos aus mehreren Märkten */
  market?: string;
  warnings: string[];
}

export interface Extraction {
  version: 1;
  createdAt: string;
  model: string;
  market: string | null;
  validFrom: string | null;
  validTo: string | null;
  addresses: string[];
  phone: string | null;
  pages: { file: string; source: string; width: number; height: number; offers: number }[];
  offers: ExtractedOffer[];
  warnings: string[];
}
