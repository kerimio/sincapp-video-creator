// zod-Schemas für story.json und Markt – die eine Datenquelle für Server, Template und UI (pnpm schemas erzeugt daraus schemas/*.json).
import { z } from 'zod';
import { Design } from './design';

export const LANGS = ['de', 'tr'] as const;
export const Lang = z.enum(LANGS);
export type Lang = z.infer<typeof Lang>;

const Localized = z.object({ de: z.string(), tr: z.string() });
const Lines = z.array(z.string().min(1)).min(1).max(2);

/** Preis im deutschen Format, z. B. "13,99". */
export const PriceString = z.string().regex(/^\d{1,4},\d{2}$/, 'Preis muss im Format "13,99" sein');

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum muss im Format JJJJ-MM-TT sein');

export const LogoCrop = z.object({
  w: z.number().positive(),
  h: z.number().positive(),
  offsetX: z.number().min(0),
  offsetY: z.number().min(0),
});

export const Market = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  /** Pfad relativ zu markets/, z. B. "saray/logo.jpg". */
  logo: z.string().min(1),
  /** Ausschnitt des Logos in Bildpixeln; ohne Angabe wird das ganze Bild gezeigt. */
  logoCrop: LogoCrop.optional(),
  /** ohne Handle wird die @-Zeile weggelassen */
  instagram: z.string().regex(/^[A-Za-z0-9._]+$/, 'Instagram-Handle ohne @').optional(),
  addresses: z.array(z.string().min(1)).min(1).max(3),
  theme: z
    .object({
      /** Hintergründe der Angebotsseiten, werden zyklisch wiederholt. */
      pages: z.array(z.enum(['red', 'nut'])).min(1).optional(),
    })
    .optional(),
});
export type Market = z.infer<typeof Market>;

/** Sticker auf einer Angebotskarte (Texte in core/badges.ts). */
export const BADGES = ['knaller', 'woche', 'neu', 'halal', 'bio', 'bestpreis', 'frisch', 'aktion', 'vorrat', 'xxl'] as const;

export const Offer = z.object({
  id: z.string().optional(),
  /** Pfad relativ zum Job-Ordner, z. B. "images/offer-1.png". */
  img: z.string().min(1),
  price: PriceString,
  unit: z.union([z.string(), Localized]).optional(),
  name: z.object({ de: Lines, tr: Lines }),
  note: Localized.optional(),
  imgZoom: z.number().positive().max(3).default(1),
  badge: z.enum(BADGES).optional(),
  /** Günstigster Preis seit so vielen Wochen (aus dem Preisverlauf im Katalog) */
  bestWeeks: z.number().int().positive().max(104).optional(),
  /** Markt des Angebots, wenn ein Video Prospekte mehrerer Märkte zeigt ("Saray Market") */
  market: z.string().min(1).optional(),
});
export type Offer = z.infer<typeof Offer>;

export const SceneDurations = z.object({
  intro: z.number().positive().default(3.6),
  page: z.number().positive().default(4.5),
  cta: z.number().positive().default(6),
});

export const Story = z
  .object({
    version: z.literal(1).default(1),
    market: Market,
    lang: z.array(Lang).min(1).default(['de', 'tr']),
    dates: z.object({ from: IsoDate, to: IsoDate }),
    headline: z.object({ de: Lines, tr: Lines }),
    eyebrow: Localized.optional(),
    /** Mehr als 15 nur bei Videos aus mehreren Märkten (eine Seite je Markt) */
    offers: z.array(Offer).min(2),
    /** Angebote pro Seite; ohne Angabe automatisch (3/2-Regel). */
    pages: z.array(z.union([z.literal(2), z.literal(3)])).optional(),
    /** Pfad relativ zum Job-Ordner. */
    appScreenshot: z.string().optional(),
    scenes: SceneDurations.default({}),
    /** Laufband auf den Angebotsseiten, z. B. "Nur bis Samstag!" */
    banner: Localized.optional(),
    /** Gestaltung (Vorlage, Farben, Effekte); ohne Angabe "klassik". */
    design: Design.optional(),
    /**
     * Video aus Prospekten mehrerer Märkte: Logos fürs Intro und den Kopf jeder Seite.
     * Die Angebote nennen ihren Markt in `market` (= `name` hier); jede Seite zeigt einen Markt.
     */
    markets: z
      .array(
        z.object({
          name: z.string().min(1),
          logo: z.string().min(1).optional(),
          address: z.string().optional(),
          /** Instagram-Name des Markts (ohne @), zum Markieren beim Teilen */
          instagram: z.string().regex(/^[A-Za-z0-9._]+$/).optional(),
          /** Gültigkeit laut Prospekt dieses Markts; ohne Angabe gilt `dates` der Story */
          dates: z.object({ from: IsoDate, to: IsoDate }).optional(),
        }),
      )
      .optional(),
  })
  .superRefine((s, ctx) => {
    if (s.pages) {
      const sum = s.pages.reduce((a, b) => a + b, 0);
      if (sum !== s.offers.length) {
        ctx.addIssue({ code: 'custom', path: ['pages'], message: `Seiten summieren sich auf ${sum}, es gibt aber ${s.offers.length} Angebote` });
      }
    }
    if (s.dates.from > s.dates.to) {
      ctx.addIssue({ code: 'custom', path: ['dates'], message: 'Startdatum liegt nach dem Enddatum' });
    }
  });
export type Story = z.infer<typeof Story>;

export function parseStory(data: unknown): Story {
  return Story.parse(data);
}
