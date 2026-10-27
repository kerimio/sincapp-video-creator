import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../paths';

/**
 * Produkt-Bibliothek: freigestellte Produktbilder, die über Wochen und Märkte
 * hinweg wiederverwendet werden. Ein Ordner mit index.json und PNGs.
 * Ort: library/ im Projekt oder SINCAPP_LIBRARY.
 */

export type LibrarySource = 'web' | 'openfoodfacts' | 'prospekt' | 'manual';

export interface LibraryEntry {
  key: string;
  brand: string | null;
  name: { de: string; tr: string };
  unit: string | null;
  /** weitere Schreibweisen, unter denen das Produkt gefunden wird */
  aliases: string[];
  /** Dateiname im Bibliotheksordner */
  img: string;
  source: { type: LibrarySource; url?: string };
  /** true = von Claude oder im Review bestätigt, dass es das Produkt aus dem Prospekt ist */
  verified: boolean;
  addedAt: string;
  usedAt: string;
  uses: number;
}

export interface LibraryQuery {
  brand: string | null;
  name: { de: string; tr?: string };
  unit?: string | null;
}

export function libraryDir() {
  return resolve(process.env.SINCAPP_LIBRARY || join(ROOT, 'library'));
}

const fold = (s: string | null | undefined) =>
  (s ?? '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/ß/g, 'ss');

const tokens = (s: string | null | undefined) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/** Schlüssel: Marke + Name, ohne Akzente, Satzzeichen und Groß/klein. */
export function productKey(brand: string | null, name: string) {
  return `${tokens(brand).join('-')}|${tokens(name).join('-')}`;
}

/** Ähnlichkeit 0–1 zweier Namen (Anteil gemeinsamer Wörter am kürzeren Namen). */
function overlap(a: string, b: string) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

const unitKey = (u: string | null | undefined) => fold(u).replace(/\s+/g, '');

export class Library {
  entries: LibraryEntry[] = [];
  constructor(public dir = libraryDir()) {}

  static async open(dir?: string) {
    const lib = new Library(dir);
    const f = join(lib.dir, 'index.json');
    if (existsSync(f)) lib.entries = JSON.parse(await readFile(f, 'utf8'));
    return lib;
  }

  async save() {
    await mkdir(this.dir, { recursive: true });
    const f = join(this.dir, 'index.json');
    await writeFile(`${f}.tmp`, JSON.stringify(this.entries, null, 2) + '\n');
    await rename(`${f}.tmp`, f);
  }

  /**
   * Sucht ein Produkt: erst exakter Schlüssel (auch Aliase), dann gleiche Marke
   * mit sehr ähnlichem Namen. Unterschiedliche Mengen (1 kg vs. 500 g) zählen nicht als Treffer.
   */
  find(q: LibraryQuery): LibraryEntry | null {
    const keys = [productKey(q.brand, q.name.de), ...(q.name.tr ? [productKey(q.brand, q.name.tr)] : [])];
    const sameUnit = (e: LibraryEntry) => !q.unit || !e.unit || unitKey(q.unit) === unitKey(e.unit);
    const exact = this.entries.find((e) => sameUnit(e) && (keys.includes(e.key) || e.aliases.some((a) => keys.includes(a))));
    if (exact) return exact;
    const brand = tokens(q.brand).join('-');
    let best: { e: LibraryEntry; s: number } | null = null;
    for (const e of this.entries) {
      if (!sameUnit(e) || tokens(e.brand).join('-') !== brand) continue;
      const s = Math.max(overlap(q.name.de, e.name.de), q.name.tr ? overlap(q.name.tr, e.name.tr) : 0);
      if (s >= 0.8 && (!best || s > best.s)) best = { e, s };
    }
    return best?.e ?? null;
  }

  path(e: LibraryEntry) {
    return join(this.dir, e.img);
  }

  /** Bild aus der Bibliothek in den Job kopieren und Nutzung vermerken. */
  async use(e: LibraryEntry, dest: string) {
    await copyFile(this.path(e), dest);
    e.usedAt = new Date().toISOString();
    e.uses++;
  }

  /** Produkt aufnehmen oder ersetzen (gleicher Schlüssel und gleiche Menge). */
  async put(q: LibraryQuery, png: string, source: LibraryEntry['source'], verified: boolean) {
    await mkdir(this.dir, { recursive: true });
    const key = productKey(q.brand, q.name.de);
    const now = new Date().toISOString();
    let e = this.entries.find((x) => x.key === key && unitKey(x.unit) === unitKey(q.unit ?? null));
    const file = `${key.replace(/\|/g, '__').slice(0, 80) || 'produkt'}${q.unit ? `__${unitKey(q.unit)}` : ''}.png`;
    await copyFile(png, join(this.dir, file));
    if (e) {
      Object.assign(e, { img: file, source, verified, usedAt: now });
    } else {
      e = { key, brand: q.brand, name: { de: q.name.de, tr: q.name.tr ?? q.name.de }, unit: q.unit ?? null, aliases: [], img: file, source, verified, addedAt: now, usedAt: now, uses: 0 };
      this.entries.push(e);
    }
    const trKey = q.name.tr ? productKey(q.brand, q.name.tr) : null;
    if (trKey && trKey !== key && !e.aliases.includes(trKey)) e.aliases.push(trKey);
    return e;
  }
}
