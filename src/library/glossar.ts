// Eigenes Glossar (library/glossar.json) laden, speichern und auf gelesene Angebote anwenden.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findGlossary, glossaryKey, mergeGlossary, type GlossaryEntry } from '../core/glossary';
import { CATEGORIES, type ExtractedOffer } from '../extract/schema';
import { DE_SOFT_CHARS, TR_MAX_CHARS, nameLines } from '../extract/normalize';
import { Library, libraryDir } from './library';

const file = () => join(libraryDir(), 'glossar.json');

/** Eigene Einträge (ohne Grundbestand). */
export async function readOwnGlossary(): Promise<GlossaryEntry[]> {
  if (!existsSync(file())) return [];
  return checkGlossary(JSON.parse(await readFile(file(), 'utf8')));
}

/** Prüft und bereinigt Einträge aus der App; wirft eine verständliche Meldung. */
export function checkGlossary(raw: unknown): GlossaryEntry[] {
  if (!Array.isArray(raw)) throw new Error('Glossar muss eine Liste sein');
  return raw.map((e, i) => {
    const de = String(e?.de ?? '').trim();
    const tr = String(e?.tr ?? '').trim();
    if (!de || !tr) throw new Error(`Glossar Zeile ${i + 1}: deutscher und türkischer Name nötig`);
    if (tr.length > TR_MAX_CHARS * 2 + 1) throw new Error(`Glossar Zeile ${i + 1}: „${tr}“ ist zu lang (höchstens 2 × ${TR_MAX_CHARS} Zeichen)`);
    const match = (Array.isArray(e?.match) ? e.match : String(e?.match ?? '').split(','))
      .map((m: unknown) => String(m).trim())
      .filter(Boolean);
    const category = CATEGORIES.includes(e?.category) ? e.category : undefined;
    return { de, tr, match, ...(category ? { category } : {}) };
  });
}

export async function saveOwnGlossary(entries: unknown) {
  const clean = checkGlossary(entries);
  await mkdir(libraryDir(), { recursive: true });
  await writeFile(`${file()}.tmp`, JSON.stringify(clean, null, 2) + '\n');
  await rename(`${file()}.tmp`, file());
  return clean;
}

/** Eigene Einträge plus Grundbestand. */
export async function glossary() {
  return mergeGlossary(await readOwnGlossary());
}

/**
 * Feste Namen einsetzen: Steht ein Angebot im Glossar, heißt es überall gleich – egal wie der Prospekt es schreibt.
 * Ändert die Angebote direkt; liefert Hinweise für den Bericht.
 */
export function applyGlossary(offers: ExtractedOffer[], entries: GlossaryEntry[]): string[] {
  const notes: string[] = [];
  for (const o of offers) {
    const e = findGlossary(o.name, entries);
    if (!e || (o.name.de === e.de && o.name.tr === e.tr && !(e.category === 'fleisch' && o.brand))) continue;
    notes.push(`Glossar: „${o.name.de}“ → „${e.de}“ / „${e.tr}“`);
    o.name = { de: e.de, tr: e.tr };
    // frisches Fleisch hat keine Marke: "Gemischtes Hack" heißt in jedem Markt gleich und bekommt dasselbe Katalogbild
    if (e.category === 'fleisch') o.brand = null;
    o.lines = { de: nameLines(o.brand, e.de, DE_SOFT_CHARS, false).lines, tr: nameLines(o.brand, e.tr, TR_MAX_CHARS).lines };
    o.warnings = o.warnings.filter((w) => !w.startsWith('Türkischer Name'));
    if (e.category) o.category = e.category;
  }
  return notes;
}

const words = (s: string | null | undefined) => glossaryKey(s ?? '').split(' ').filter(Boolean);

/** Wörter, die zur Ware gehören, nicht zur Marke: "Mevlâna Çay" und "Goran-Tee" sind die Marken "Mevlâna" und "Goran". */
const GENERIC = new Set(['cay', 'tee', 'gida', 'food', 'foods', 'gmbh', 'ltd', 'sti', 'sut', 'et', 'urunleri', 'market', 'markt']);

/** Markenschlüssel ohne Akzente und Warenwörter: "Mevlâna Çay" → "mevlana" */
export const brandKey = (b: string | null | undefined) => words(b).filter((w) => !GENERIC.has(w)).join(' ');

/** Anzeigeform einer Marke ohne Warenwörter: "Mevlâna Çay" → "Mevlâna", "Goran-Tee" → "Goran" */
const brandShown = (b: string) => b.split(/[\s-]+/).filter((w) => w && !GENERIC.has(glossaryKey(w))).join(' ') || b;

/**
 * Namen vereinheitlichen, bevor ausgewählt wird (läuft vor dem Glossar – feste Glossar-Namen gewinnen):
 * 1. Eine Marke, eine Schreibweise: "Mevlâna Çay", "Mevlana", "MEVLANA" → die häufigste Form ohne Warenwort,
 *    bei Gleichstand die ohne Sonderzeichen; steht die Marke im Katalog, dessen Form.
 * 2. Steht eine bekannte Marke (Katalog oder ein anderes Angebot) im Namen, aber eine unbekannte als Marke
 *    ("Goran-Tee" + "Mevlana Çay"), wird die bekannte zur Marke und verschwindet aus dem Namen.
 * 3. Steht das Produkt im Katalog, heißt es wie dort (auch nach eigener Korrektur) – jede Woche gleich.
 */
export function applyCatalogNames(offers: ExtractedOffer[], lib: Library): string[] {
  const notes: string[] = [];
  const fromLib = new Map<string, string>();
  for (const e of lib.entries) if (e.brand && brandKey(e.brand).length >= 3 && !fromLib.has(brandKey(e.brand))) fromLib.set(brandKey(e.brand), brandShown(e.brand));
  const seen = new Map<string, Map<string, number>>();
  for (const o of offers) {
    const k = brandKey(o.brand);
    if (k.length < 3) continue;
    const forms = seen.get(k) ?? new Map<string, number>();
    forms.set(brandShown(o.brand!), (forms.get(brandShown(o.brand!)) ?? 0) + 1);
    seen.set(k, forms);
  }
  const ascii = (s: string) => [...s].filter((c) => c.charCodeAt(0) > 127).length;
  const canonical = new Map(fromLib);
  for (const [k, forms] of seen) if (!canonical.has(k)) canonical.set(k, [...forms].sort((a, b) => b[1] - a[1] || ascii(a[0]) - ascii(b[0]) || a[0].length - b[0].length)[0][0]);
  const count = (k: string) => [...(seen.get(k)?.values() ?? [])].reduce((a, b) => a + b, 0);

  const set = (o: ExtractedOffer, brand: string | null, name: { de: string; tr: string }, why: string) => {
    if (brand === o.brand && name.de === o.name.de && name.tr === o.name.tr) return;
    notes.push(`${why}: „${[o.brand, o.name.de].filter(Boolean).join(' ')}“ → „${[brand, name.de].filter(Boolean).join(' ')}“`);
    o.brand = brand;
    o.name = name;
    o.lines = { de: nameLines(brand, name.de, DE_SOFT_CHARS, false).lines, tr: nameLines(brand, name.tr, TR_MAX_CHARS).lines };
  };
  // Marken-Wörter aus dem Namen nehmen ("Mevlana Çay" → "Çay"); bliebe nichts übrig, den Namen lassen
  const strip = (n: string, key: string) => n.split(/\s+/).filter((w) => !key.split(' ').includes(glossaryKey(w))).join(' ') || n;
  for (const o of offers) {
    const own = brandKey(o.brand);
    // bekannte Marke im Namen schlägt eine unbekannte (nur in diesem Angebot gesehene) Marke
    const trusted = fromLib.has(own) || count(own) > 1;
    if (!trusted) {
      const hay = ` ${words(o.name.de).join(' ')} ${words(o.name.tr).join(' ')} `;
      const hit = [...canonical.keys()].filter((k) => k !== own && (fromLib.has(k) || count(k) > 0) && hay.includes(` ${k} `)).sort((a, b) => b.length - a.length)[0];
      if (hit) {
        set(o, canonical.get(hit)!, { de: strip(o.name.de, hit), tr: strip(o.name.tr, hit) }, 'Marke');
        continue;
      }
    }
    if (own.length >= 3 && canonical.get(own) !== o.brand) set(o, canonical.get(own)!, o.name, 'Marke');
  }
  for (const o of offers) {
    const e = lib.find({ brand: o.brand, name: o.name, unit: o.category === 'fleisch' ? null : o.unit });
    if (e) set(o, e.brand ? (canonical.get(brandKey(e.brand)) ?? e.brand) : null, e.name, 'Katalog');
  }
  return notes;
}
