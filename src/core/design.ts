import { z } from 'zod';

/**
 * Gestaltung einer Story: Vorlage (Preset) plus einzelne Änderungen.
 * Alles ist optional; ohne Angabe gilt "klassik" – exakt der Referenz-Look.
 */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #RRGGBB');

export const PRESETS = ['marke', 'klassik', 'frisch', 'premium', 'knallig', 'minimal', 'blackweek', 'bayram', 'sommer'] as const;
export const BACKGROUNDS = ['logo', 'punkte', 'verlauf', 'sterne', 'streifen', 'ohne'] as const;
export const PRICE_STYLES = ['etikett', 'kreis', 'flach'] as const;
export const ENTERS = ['wischen', 'hoch', 'blende', 'pop'] as const;
export const SPEEDS = ['ruhig', 'normal', 'schnell'] as const;
export const TRANSITIONS = ['kreis', 'schieben', 'blende'] as const;
/** Ziel des QR-Codes am Schluss */
export const QR_TARGETS = ['aus', 'route', 'instagram', 'link'] as const;

export const Palette = z.object({
  /** Hintergrund von Intro und Schluss */
  paper: Hex,
  /** Haupttext */
  ink: Hex,
  /** Nebentext */
  ink2: Hex,
  /** Akzent: Headline-Zeile, Button, @-Handle */
  accent: Hex,
  /** Zweiter Akzent: Preisschild auf dunklen Seiten */
  accent2: Hex,
  /** Hintergründe der Angebotsseiten, werden zyklisch wiederholt */
  pages: z.array(Hex).min(1).max(4),
});
export type Palette = z.infer<typeof Palette>;

export const Design = z.object({
  preset: z.enum(PRESETS).default('klassik'),
  /** einzelne Farben, überschreiben das Preset */
  colors: Palette.partial().optional(),
  background: z.enum(BACKGROUNDS).optional(),
  price: z.enum(PRICE_STYLES).optional(),
  enter: z.enum(ENTERS).optional(),
  speed: z.enum(SPEEDS).optional(),
  wobble: z.boolean().optional(),
  transition: z.enum(TRANSITIONS).optional(),
  qr: z.enum(QR_TARGETS).optional(),
  /** eigener Link für qr = "link" */
  qrLink: z.string().url().max(500).optional(),
});
export type Design = z.infer<typeof Design>;
export type DesignInput = z.input<typeof Design>;

export interface ResolvedDesign {
  preset: (typeof PRESETS)[number];
  colors: Palette;
  background: (typeof BACKGROUNDS)[number];
  price: (typeof PRICE_STYLES)[number];
  enter: (typeof ENTERS)[number];
  speed: (typeof SPEEDS)[number];
  wobble: boolean;
  transition: (typeof TRANSITIONS)[number];
  qr: (typeof QR_TARGETS)[number];
  qrLink?: string;
}

type PresetDef = Omit<ResolvedDesign, 'preset' | 'qr' | 'qrLink'> & { label: string; hint: string };

export const PRESET_DEFS: Record<(typeof PRESETS)[number], PresetDef> = {
  marke: {
    label: 'sincapp Marke',
    hint: 'Genau nach dem Design System: Papier und Nuss, Rot und Amber nur als Akzent, eine Sprache pro Bild',
    colors: { paper: '#FAF6F1', ink: '#292019', ink2: '#6E6259', accent: '#C24A18', accent2: '#E9A02A', pages: ['#FAF6F1', '#292019'] },
    background: 'logo', price: 'etikett', enter: 'wischen', speed: 'normal', wobble: true, transition: 'kreis',
  },
  klassik: {
    label: 'Klassik',
    hint: 'sincapp-Rot und Nussbraun, Karten wischen herein',
    colors: { paper: '#FAF6F1', ink: '#292019', ink2: '#5C4E42', accent: '#C24A18', accent2: '#E9A02A', pages: ['#C24A18', '#292019'] },
    background: 'logo', price: 'etikett', enter: 'wischen', speed: 'normal', wobble: true, transition: 'kreis',
  },
  frisch: {
    label: 'Frisch',
    hint: 'Grün für Obst, Gemüse und Wochenmarkt-Gefühl',
    colors: { paper: '#F4F8EE', ink: '#1F2A1B', ink2: '#4D5B45', accent: '#2E8B3A', accent2: '#F2C230', pages: ['#2E8B3A', '#1F3A24'] },
    background: 'punkte', price: 'kreis', enter: 'hoch', speed: 'normal', wobble: true, transition: 'schieben',
  },
  premium: {
    label: 'Premium',
    hint: 'Schwarz und Gold, ruhig und edel – für Fleisch und Feinkost',
    colors: { paper: '#F3EFE7', ink: '#141414', ink2: '#5A544A', accent: '#B08D3C', accent2: '#D9B65E', pages: ['#141414', '#2A2622'] },
    background: 'ohne', price: 'flach', enter: 'blende', speed: 'ruhig', wobble: false, transition: 'blende',
  },
  knallig: {
    label: 'Knallig',
    hint: 'Gelb und Rot wie ein Angebotsplakat, schnell und laut',
    colors: { paper: '#FFF6D6', ink: '#1E1A16', ink2: '#5B4A2E', accent: '#E3261B', accent2: '#FFD31A', pages: ['#E3261B', '#FFD31A'] },
    background: 'punkte', price: 'kreis', enter: 'pop', speed: 'schnell', wobble: true, transition: 'kreis',
  },
  minimal: {
    label: 'Minimal',
    hint: 'Hell und aufgeräumt, die Produkte stehen im Mittelpunkt',
    colors: { paper: '#FFFFFF', ink: '#1C1C1C', ink2: '#666666', accent: '#C24A18', accent2: '#1C1C1C', pages: ['#F1ECE4', '#E4ECEE'] },
    background: 'ohne', price: 'flach', enter: 'hoch', speed: 'normal', wobble: false, transition: 'blende',
  },
  blackweek: {
    label: 'Black Week',
    hint: 'Schwarz mit Neon-Gelb – für Rabattwochen und Sonderaktionen',
    colors: { paper: '#0B0B0B', ink: '#111111', ink2: '#555555', accent: '#FFE500', accent2: '#FFE500', pages: ['#111111', '#262626'] },
    background: 'streifen', price: 'kreis', enter: 'pop', speed: 'schnell', wobble: true, transition: 'kreis',
  },
  bayram: {
    label: 'Bayram',
    hint: 'Smaragdgrün, Weinrot und Gold – festlich für Ramazan und Bayram',
    colors: { paper: '#F7F1E3', ink: '#1F1A14', ink2: '#5E5240', accent: '#0F6B52', accent2: '#D4A537', pages: ['#0F5C47', '#6E1C2A'] },
    background: 'sterne', price: 'etikett', enter: 'blende', speed: 'ruhig', wobble: false, transition: 'blende',
  },
  sommer: {
    label: 'Sommer',
    hint: 'Türkis und Orange – Grillsaison, Getränke, Eis',
    colors: { paper: '#FFF8EC', ink: '#1D2A33', ink2: '#4E5C66', accent: '#F2602B', accent2: '#FFD23F', pages: ['#0098B8', '#F2602B'] },
    background: 'punkte', price: 'kreis', enter: 'pop', speed: 'normal', wobble: true, transition: 'schieben',
  },
};

export const SPEED_FACTOR: Record<(typeof SPEEDS)[number], number> = { ruhig: 1.25, normal: 1, schnell: 0.8 };

export function resolveDesign(d?: DesignInput | null): ResolvedDesign {
  const parsed = Design.parse(d ?? {});
  const p = PRESET_DEFS[parsed.preset];
  const pick = <K extends keyof ResolvedDesign>(k: K): ResolvedDesign[K] => ((parsed as Record<string, unknown>)[k] ?? p[k as keyof PresetDef]) as ResolvedDesign[K];
  return {
    preset: parsed.preset,
    colors: { ...p.colors, ...(parsed.colors ?? {}) },
    background: pick('background'),
    price: pick('price'),
    enter: pick('enter'),
    speed: pick('speed'),
    wobble: pick('wobble'),
    transition: pick('transition'),
    qr: parsed.qr ?? 'aus',
    qrLink: parsed.qrLink,
  };
}

// ---- Farblehre: Textfarbe und Seitentyp aus dem Hintergrund ableiten ----

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** Gut lesbare Schrift auf `bg`: Weiß oder die Textfarbe. */
export function textOn(bg: string, ink: string): string {
  return contrast(bg, '#ffffff') >= contrast(bg, ink) ? '#ffffff' : ink;
}

/**
 * Art einer Angebotsseite:
 *  - "white": farbiger Hintergrund, alles in Weiß (Klassik: Rot)
 *  - "dark": sehr dunkler Hintergrund, Marke in Farbe (Klassik: Nussbraun)
 *  - "light": heller Hintergrund, dunkle Schrift
 */
export type PageMode = 'white' | 'dark' | 'light';
export function pageMode(bg: string, ink: string): PageMode {
  if (textOn(bg, ink) !== '#ffffff') return 'light';
  return lum(bg) < 0.04 ? 'dark' : 'white';
}

/** "#C24A18" → "rgba(194,74,24,.32)" */
export function rgba(hex: string, a: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}
