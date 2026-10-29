// Glossar: feste Produktnamen auf Deutsch und Türkisch, egal wie der Prospekt sie schreibt.
// "Rinderhackfleisch-Mischung (Gemischtes Hackfleisch)" → "Gemischtes Hack" / "Karışık Kıyma".
import type { Category } from '../extract/schema';

export interface GlossaryEntry {
  de: string;
  tr: string;
  /**
   * weitere Schreibweisen aus Prospekten (DE oder TR); der feste Name selbst zählt immer mit.
   * "tee+cay" = beide Wörter irgendwo im Namen ("Goran Tee Mevlana Çay").
   */
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
  // Grundbedarf: die Marke bleibt davor stehen ("Mevlana" + "Schwarztee"). Nur eindeutige Namen –
  // ein einzelnes "Butter" träfe auch "Butter Kekse".
  { de: 'Schwarztee', tr: 'Siyah Çay', category: 'getraenke', match: ['schwarzer tee', 'siyah cay', 'turkischer tee', 'turk cayi', 'rize cayi', 'tee+cay', 'cay+tee'] },
  { de: 'Grüner Tee', tr: 'Yeşil Çay', category: 'getraenke', match: ['gruntee', 'yesil cay'] },
  { de: 'Tomatenmark', tr: 'Domates Salçası', category: 'konserven', match: ['tomatenpaste', 'tomaten paste', 'domates salcasi', 'tomatenmark+salca'] },
  { de: 'Paprikamark', tr: 'Biber Salçası', category: 'konserven', match: ['paprikapaste', 'paprika paste', 'biber salcasi', 'paprikamark+salca'] },
  { de: 'Sonnenblumenöl', tr: 'Ayçiçek Yağı', category: 'grundnahrung', match: ['sonnenblumen ol', 'aycicek yagi'] },
  { de: 'Olivenöl', tr: 'Zeytinyağı', category: 'grundnahrung', match: ['oliven ol', 'zeytinyagi', 'zeytin yagi', 'natives olivenol extra', 'olivenol extra nativ'] },
  { de: 'Kichererbsen', tr: 'Nohut', match: ['nohut'] },
  { de: 'Rote Linsen', tr: 'Kırmızı Mercimek', category: 'grundnahrung', match: ['linsen rot', 'kirmizi mercimek'] },
  { de: 'Weizenmehl', tr: 'Buğday Unu', category: 'grundnahrung', match: ['bugday unu'] },
  { de: 'Ayran', tr: 'Ayran', category: 'getraenke', match: [] },
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
    for (const raw of [e.de, e.tr, ...e.match]) {
      const parts = raw.split('+').map(glossaryKey).filter(Boolean);
      if (!parts.length) continue;
      const len = parts.join(' ').length;
      // alle Teile im selben Namen (DE oder TR), jeweils als ganze Wörter
      if (hay.some((h) => parts.every((m) => h.includes(` ${m} `))) && (!best || len > best.len)) best = { e, len };
    }
  }
  return best?.e ?? null;
}

/** Eigene Einträge zuerst; ein eigener Eintrag mit demselben deutschen Namen ersetzt den aus dem Grundbestand. */
export function mergeGlossary(own: GlossaryEntry[], base: GlossaryEntry[] = DEFAULT_GLOSSARY): GlossaryEntry[] {
  const mine = new Set(own.map((e) => glossaryKey(e.de)));
  return [...own, ...base.filter((e) => !mine.has(glossaryKey(e.de)))];
}
