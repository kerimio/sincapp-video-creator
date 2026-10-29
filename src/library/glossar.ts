// Eigenes Glossar (library/glossar.json) laden, speichern und auf gelesene Angebote anwenden.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findGlossary, mergeGlossary, type GlossaryEntry } from '../core/glossary';
import { CATEGORIES, type ExtractedOffer } from '../extract/schema';
import { DE_SOFT_CHARS, TR_MAX_CHARS, nameLines } from '../extract/normalize';
import { libraryDir } from './library';

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
    if (!e || (o.name.de === e.de && o.name.tr === e.tr)) continue;
    notes.push(`Glossar: „${o.name.de}“ → „${e.de}“ / „${e.tr}“`);
    o.name = { de: e.de, tr: e.tr };
    o.lines = { de: nameLines(o.brand, e.de, DE_SOFT_CHARS, false).lines, tr: nameLines(o.brand, e.tr, TR_MAX_CHARS).lines };
    o.warnings = o.warnings.filter((w) => !w.startsWith('Türkischer Name'));
    if (e.category) o.category = e.category;
  }
  return notes;
}
