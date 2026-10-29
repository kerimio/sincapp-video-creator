// Glossar: feste Produktnamen auf Deutsch und Türkisch, egal wie der Prospekt sie schreibt.
// "Rinderhackfleisch-Mischung (Gemischtes Hackfleisch)" → "Gemischtes Hack" / "Karışık Kıyma".
import type { Category } from '../extract/schema';

export interface GlossaryEntry {
  de: string;
  tr: string;
  /** weitere Schreibweisen aus Prospekten (DE oder TR); der feste Name selbst zählt immer mit */
  match: string[];
  /** Warengruppe erzwingen, z. B. "fleisch" für Hack */
  category?: Category;
}

/** Grundbestand – frisches Fleisch, wie es in türkischen Märkten heißt. Eigene Einträge in der App ergänzen oder überschreiben ihn. */
export const DEFAULT_GLOSSARY: GlossaryEntry[] = [
  { de: 'Gemischtes Hack', tr: 'Karışık Kıyma', category: 'fleisch', match: ['gemischtes hackfleisch', 'hackfleisch gemischt', 'hack gemischt', 'rinderhackfleisch mischung', 'rinderhack mischung', 'rind und lammhack', 'rinder und lammhackfleisch', 'karisik kiyma'] },
  { de: 'Rinderhack', tr: 'Dana Kıyma', category: 'fleisch', match: ['rinderhackfleisch', 'hackfleisch vom rind', 'rinderhack', 'dana kiyma', 'dana kiymasi'] },
  { de: 'Lammhack', tr: 'Kuzu Kıyma', category: 'fleisch', match: ['lammhackfleisch', 'hackfleisch vom lamm', 'kuzu kiyma', 'kuzu kiymasi'] },
  { de: 'Hähnchenschenkel', tr: 'Tavuk But', category: 'fleisch', match: ['hahnchenschenkel', 'hahnchenkeule', 'hahnchenkeulen', 'hahnchen schenkel', 'tavuk but', 'tavuk baget'] },
  { de: 'Hähnchenbrustfilet', tr: 'Tavuk Göğüs', category: 'fleisch', match: ['hahnchenbrust', 'hahnchenbrustfilet', 'hahnchenbrustfilets', 'tavuk gogus', 'tavuk gogsu', 'tavuk gogus fileto'] },
  { de: 'Hähnchenflügel', tr: 'Tavuk Kanat', category: 'fleisch', match: ['hahnchenflugel', 'chicken wings', 'tavuk kanat', 'tavuk kanadi'] },
  { de: 'Ganzes Hähnchen', tr: 'Bütün Tavuk', category: 'fleisch', match: ['ganzes hahnchen', 'hahnchen ganz', 'brathahnchen', 'butun tavuk'] },
  { de: 'Rindergulasch', tr: 'Dana Kuşbaşı', category: 'fleisch', match: ['rindergulasch', 'gulasch vom rind', 'rindfleisch gewurfelt', 'dana kusbasi'] },
  { de: 'Lammgulasch', tr: 'Kuzu Kuşbaşı', category: 'fleisch', match: ['lammgulasch', 'gulasch vom lamm', 'kuzu kusbasi'] },
  { de: 'Lammkoteletts', tr: 'Kuzu Pirzola', category: 'fleisch', match: ['lammkotelett', 'lammkoteletts', 'lammkoteletten', 'kuzu pirzola'] },
  { de: 'Lammkeule', tr: 'Kuzu But', category: 'fleisch', match: ['lammkeule', 'kuzu but'] },
];

/** Klein, ohne Akzente und Satzzeichen: "Rinderhackfleisch-Mischung" → "rinderhackfleisch mischung" */
export function glossaryKey(s: string) {
  return s
    .toLocaleLowerCase('de')
    .replace(/ı/g, 'i')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Passenden Eintrag finden: Eine Schreibweise muss als ganze Wörter im deutschen oder türkischen Namen stehen.
 * Die längste Treffer-Schreibweise gewinnt ("rinderhackfleisch mischung" vor "rinderhackfleisch").
 * Eigene Einträge (`own`) stehen vor dem Grundbestand und ersetzen gleichnamige.
 */
export function findGlossary(name: { de: string; tr: string }, entries: GlossaryEntry[]): GlossaryEntry | null {
  const hay = [glossaryKey(name.de), glossaryKey(name.tr)].map((s) => ` ${s} `);
  let best: { e: GlossaryEntry; len: number } | null = null;
  for (const e of entries) {
    for (const m of [e.de, e.tr, ...e.match].map(glossaryKey).filter(Boolean)) {
      if (hay.some((h) => h.includes(` ${m} `)) && (!best || m.length > best.len)) best = { e, len: m.length };
    }
  }
  return best?.e ?? null;
}

/** Eigene Einträge zuerst; ein eigener Eintrag mit demselben deutschen Namen ersetzt den aus dem Grundbestand. */
export function mergeGlossary(own: GlossaryEntry[], base: GlossaryEntry[] = DEFAULT_GLOSSARY): GlossaryEntry[] {
  const mine = new Set(own.map((e) => glossaryKey(e.de)));
  return [...own, ...base.filter((e) => !mine.has(glossaryKey(e.de)))];
}
