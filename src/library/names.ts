// Gemerkte Namen (library/namen.json): Schreibweise aus dem Prospekt → fester Name. Jede Schreibweise geht nur einmal an die KI.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { glossaryKey, type GlossaryEntry } from '../core/glossary';
import type { ExtractedOffer } from '../extract/schema';
import { DE_SOFT_CHARS, TR_MAX_CHARS, nameLines } from '../extract/normalize';
import type { NameItem, ProductNamer } from '../ai/namer';
import { brandKey } from './glossar';
import { libraryDir, type Library } from './library';

export interface FixedName {
  brand: string | null;
  de: string;
  tr: string;
}

const file = () => join(libraryDir(), 'namen.json');

/** Schlüssel einer Schreibweise: "Mevlâna Çay" + "Sade Yaprak Çay" → "mevlana|sade yaprak cay|…" */
export const spellingKey = (o: Pick<ExtractedOffer, 'brand' | 'name'>) => `${brandKey(o.brand)}|${glossaryKey(o.name.de)}|${glossaryKey(o.name.tr)}`;

export async function readNames(): Promise<Record<string, FixedName>> {
  if (!existsSync(file())) return {};
  try {
    return JSON.parse(await readFile(file(), 'utf8'));
  } catch {
    return {};
  }
}

async function saveNames(names: Record<string, FixedName>) {
  await mkdir(libraryDir(), { recursive: true });
  await writeFile(`${file()}.tmp`, JSON.stringify(names, null, 2) + '\n');
  await rename(`${file()}.tmp`, file());
}

const BATCH = 60;
const KNOWN_MAX = 400;

/**
 * Alle Namen vereinheitlichen (MARKE + PRODUKTART): Bekannte Schreibweisen aus namen.json, neue einmal per KI –
 * mit den schon festen Namen als Vorlage, damit "Ceylon Tee" und "Sade Yaprak Çay" beide "Schwarztee" werden.
 * Ohne KI-Key bleiben neue Schreibweisen, wie sie sind (Katalog und Glossar greifen trotzdem).
 * Liefert Hinweise für den Bericht; ein Fehler der KI bricht nichts ab.
 */
export async function normalizeNames(offers: ExtractedOffer[], opts: { namer: ProductNamer | null; library?: Library; glossary?: GlossaryEntry[] }): Promise<string[]> {
  const notes: string[] = [];
  const names = await readNames();
  const open = new Map<string, ExtractedOffer>();
  for (const o of offers) if (!names[spellingKey(o)] && !open.has(spellingKey(o))) open.set(spellingKey(o), o);
  if (open.size && opts.namer) {
    const known = new Set<string>();
    const add = (b: string | null, de: string, tr: string) => known.size < KNOWN_MAX && known.add(`${b ?? '–'} | ${de} | ${tr}`);
    for (const n of Object.values(names)) add(n.brand, n.de, n.tr);
    for (const g of opts.glossary ?? []) add(null, g.de, g.tr);
    for (const e of opts.library?.entries ?? []) add(e.brand, e.name.de, e.name.tr);
    const list = [...open.entries()];
    for (let i = 0; i < list.length; i += BATCH) {
      const part = list.slice(i, i + BATCH);
      const items: NameItem[] = part.map(([, o], k) => ({ id: String(k + 1), brand: o.brand, de: o.name.de, tr: o.name.tr, category: o.category }));
      try {
        const out = await opts.namer.normalize(items, [...known]);
        for (const r of out) {
          const hit = part[Number(r.id) - 1];
          const de = r.de.trim();
          const tr = r.tr.trim();
          if (!hit || !de || !tr || tr.length > TR_MAX_CHARS * 2 + 1) continue;
          const brand = r.brand?.trim() || null;
          names[hit[0]] = { brand, de, tr };
          add(brand, de, tr);
        }
      } catch (e) {
        notes.push(`Namen vereinheitlichen: ${(e as Error).message.split('\n')[0]} – Namen wie im Prospekt`);
      }
    }
    await saveNames(names);
  }
  for (const o of offers) {
    const n = names[spellingKey(o)];
    if (!n || (n.brand === o.brand && n.de === o.name.de && n.tr === o.name.tr)) continue;
    notes.push(`Name: „${[o.brand, o.name.de].filter(Boolean).join(' ')}“ → „${[n.brand, n.de].filter(Boolean).join(' ')}“`);
    o.brand = n.brand;
    o.name = { de: n.de, tr: n.tr };
    o.lines = { de: nameLines(n.brand, n.de, DE_SOFT_CHARS, false).lines, tr: nameLines(n.brand, n.tr, TR_MAX_CHARS).lines };
    o.warnings = o.warnings.filter((w) => !w.startsWith('Türkischer Name'));
  }
  return notes;
}
