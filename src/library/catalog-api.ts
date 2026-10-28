import { existsSync } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CATEGORIES, type Category, type Extraction } from '../extract/schema';
import { jobsDir, validJobId } from '../app/jobs';
import { runPython } from '../python';
import { readBody, sendJson } from '../review/server';
import { Library, type EntryPatch, type LibraryEntry } from './library';

/**
 * Katalog aus allen bisherigen Jobs ergänzen: Warengruppe, Sorte und in welchen
 * Prospekten (Markt, Zeitraum, Preis) das Produkt vorkam. Läuft lokal, kostet nichts.
 */
export async function enrichFromJobs(lib: Library, dir = jobsDir()): Promise<boolean> {
  if (!existsSync(dir)) return false;
  let changed = false;
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || !validJobId(d.name)) continue;
    const exFile = join(dir, d.name, 'extraction.json');
    if (!existsSync(exFile)) continue;
    let ex: Extraction;
    let story: { market?: { name?: string }; dates?: { from?: string; to?: string } } = {};
    try {
      ex = JSON.parse(await readFile(exFile, 'utf8'));
      const sf = join(dir, d.name, 'story.json');
      if (existsSync(sf)) story = JSON.parse(await readFile(sf, 'utf8'));
    } catch {
      continue;
    }
    const market = story.market?.name ?? ex.market ?? '';
    for (const o of ex.offers ?? []) {
      const e = lib.find({ brand: o.brand, name: o.name, unit: o.unit });
      if (!e) continue;
      const before = JSON.stringify([e.category, e.variant, e.seen]);
      if (o.category && (!e.category || e.category === 'sonstiges')) e.category = o.category;
      if (o.note && e.variant === undefined) e.variant = o.note;
      lib.sighted(e, { market, price: o.price, from: story.dates?.from ?? ex.validFrom, to: story.dates?.to ?? ex.validTo, job: d.name });
      if (JSON.stringify([e.category, e.variant, e.seen]) !== before) changed = true;
    }
  }
  if (changed) await lib.save();
  return changed;
}

async function withUrl(lib: Library, e: LibraryEntry) {
  const f = lib.path(e);
  const v = existsSync(f) ? Math.round((await stat(f)).mtimeMs) : 0;
  return { ...e, url: `/library/${encodeURIComponent(e.img)}?v=${v}` };
}

/** /api/library…: Katalog lesen, bearbeiten, Bild ersetzen, entfernen. */
export async function catalogApi(method: string, p: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (p === '/api/library' && method === 'GET') {
    const lib = await Library.open();
    await enrichFromJobs(lib);
    return sendJson(res, await Promise.all(lib.entries.map((e) => withUrl(lib, e))));
  }
  const m = p.match(/^\/api\/library\/([^/]+)(\/bild)?$/);
  if (!m) return false;
  const lib = await Library.open();
  const img = decodeURIComponent(m[1]);
  const e = lib.byImg(img);
  if (!e) return sendJson(res, { error: 'Produkt nicht im Katalog' }, 404);

  if (!m[2] && method === 'DELETE') {
    lib.entries = lib.entries.filter((x) => x !== e);
    await lib.save();
    await rm(lib.path(e), { force: true });
    return sendJson(res, { ok: true });
  }
  if (!m[2] && method === 'PATCH') {
    const b = JSON.parse((await readBody(req)).toString('utf8')) as EntryPatch;
    if (b.category && !CATEGORIES.includes(b.category as Category)) return sendJson(res, { error: 'Unbekannte Warengruppe' }, 400);
    if (b.name && (typeof b.name.de !== 'string' || typeof b.name.tr !== 'string')) return sendJson(res, { error: 'Name DE und TR angeben' }, 400);
    lib.update(e, b);
    await lib.save();
    return sendJson(res, await withUrl(lib, e));
  }
  if (m[2] && method === 'POST') {
    // neues Produktbild: PNG direkt (Transparenz bleibt), JPG/WEBP werden umgewandelt
    const buf = await readBody(req);
    if (buf.length > 15_000_000) return sendJson(res, { error: 'Bild zu groß (max. 15 MB)' }, 400);
    const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpg = buf[0] === 0xff && buf[1] === 0xd8;
    const webp = buf.subarray(8, 12).toString('latin1') === 'WEBP';
    if (!png && !jpg && !webp) return sendJson(res, { error: 'Bitte ein PNG, JPG oder WEBP' }, 400);
    if (png) await writeFile(lib.path(e), buf);
    else {
      const tmp = `${lib.path(e)}.upload`;
      await writeFile(tmp, buf);
      const [line] = await runPython('crops.py', [], [{ image: tmp, box: null, out: lib.path(e), pad: 0, maxSide: 1600 }]);
      await rm(tmp, { force: true });
      if (!JSON.parse(line).ok) return sendJson(res, { error: 'Bild ließ sich nicht lesen' }, 400);
    }
    e.source = { type: 'manual' };
    e.verified = true;
    await lib.save();
    return sendJson(res, await withUrl(lib, e));
  }
  return false;
}
