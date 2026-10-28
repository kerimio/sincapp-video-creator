import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageReader } from '../extract/claude';
import { PageResult } from '../extract/schema';
import type { ProductMatcher } from '../images/match';
import { ROOT } from '../paths';
import { logUsage } from './usage';

/**
 * Merkt sich KI-Antworten pro Bildinhalt. Wird derselbe Prospekt noch einmal
 * verarbeitet (neues Video, anderes Thema, anderes Format), kostet das Lesen nichts.
 */
export function aiCacheDir() {
  return process.env.SINCAPP_AI_CACHE || join(ROOT, '.cache', 'ki');
}

async function hashFiles(files: string[], salt: string) {
  const h = createHash('sha256').update(salt);
  for (const f of files) h.update(await readFile(f));
  return h.digest('hex').slice(0, 32);
}

export class CachingReader implements PageReader {
  name: string;
  /** Anzahl Antworten aus dem Speicher (für Bericht und Tests) */
  hits = 0;
  constructor(private inner: PageReader, private dir = aiCacheDir()) {
    this.name = inner.name;
  }

  private async cached<T>(key: string, make: () => Promise<T>, parse: (x: unknown) => T): Promise<T> {
    const f = join(this.dir, `${key}.json`);
    if (existsSync(f)) {
      try {
        const v = parse(JSON.parse(await readFile(f, 'utf8')));
        this.hits++;
        await logUsage({ model: this.name, task: 'speicher', input: 0, output: 0, cached: true });
        return v;
      } catch {
        /* kaputt → neu holen */
      }
    }
    const v = await make();
    await mkdir(this.dir, { recursive: true });
    await writeFile(f, JSON.stringify(v));
    return v;
  }

  async readPage(file: string, size: { width: number; height: number }) {
    // ohne Modellnamen: eine einmal gelesene Seite wird nie wieder bezahlt, auch nach einem Modellwechsel
    const key = await hashFiles([file], `page|${size.width}x${size.height}`);
    return this.cached(key, () => this.inner.readPage(file, size), (x) => PageResult.parse(x));
  }

  async readPrices(crops: string[], pageFile: string) {
    if (!crops.length) return [];
    const key = await hashFiles(crops, `prices|${crops.length}`);
    return this.cached(key, () => this.inner.readPrices(crops, pageFile), (x) => {
      if (!Array.isArray(x) || x.length !== crops.length) throw new Error('falsche Länge');
      return x as (string | null)[];
    });
  }
}

/** Dasselbe für den Bildvergleich (Prospekt ↔ Internet-Fotos). */
export class CachingMatcher implements ProductMatcher {
  constructor(private inner: ProductMatcher, private dir = aiCacheDir()) {}

  async compare(prospektCrop: string, candidates: string[], product: string) {
    if (!candidates.length) return [];
    const key = await hashFiles([prospektCrop, ...candidates], `match|${product}|${candidates.length}`);
    const f = join(this.dir, `${key}.json`);
    if (existsSync(f)) {
      try {
        const v = JSON.parse(await readFile(f, 'utf8'));
        if (Array.isArray(v) && v.length === candidates.length) {
          await logUsage({ model: 'speicher', task: 'bilder', input: 0, output: 0, cached: true });
          return v;
        }
      } catch {
        /* neu holen */
      }
    }
    const v = await this.inner.compare(prospektCrop, candidates, product);
    await mkdir(this.dir, { recursive: true });
    await writeFile(f, JSON.stringify(v));
    return v;
  }
}
