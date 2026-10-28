import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { copyFile, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CATEGORIES, type Category, type Extraction } from '../extract/schema';
import { jobsDir, validJobId } from '../app/jobs';
import { runPython } from '../python';
import { readBody, sendJson } from '../review/server';
import { Library, type EntryPatch, type LibraryEntry } from './library';
import { cutoutWeb, findWebImage, singleCopies } from '../images/resolve';
import { providersFromEnv } from '../images/search';
import { makeMatcher } from '../ai/provider';

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

export type Improved = 'internet' | 'bereinigt' | 'unverändert';

/**
 * Zuerst ein Internet-Foto für einen Prospekt-Ausschnitt suchen (Suche + eine kurze KI-Prüfung).
 * Ohne force wird ein erfolgloser Versuch nicht wiederholt. Eigene Bilder und Internet-Fotos bleiben.
 */
async function tryWeb(lib: Library, e: LibraryEntry, opts: { force?: boolean; matcher: ReturnType<typeof makeMatcher> }): Promise<{ found: boolean; note?: string }> {
  const providers = providersFromEnv();
  if (!providers.length || (!opts.force && e.webTried)) return { found: false };
  if (!opts.matcher) return { found: false, note: 'Ohne KI-Schlüssel kann kein Internet-Foto sicher geprüft werden' };
  const work = await mkdtemp(join(tmpdir(), 'sincapp-katalog-'));
  try {
    const r = await findWebImage({ id: 'p', brand: e.brand, name: e.name, unit: e.unit }, { image: lib.path(e), box: null }, work, { providers, matcher: opts.matcher });
    if (r.best) {
      const out = join(work, 'web.png');
      const c = (await cutoutWeb([{ image: r.best.file, out }])).get(out);
      if (c?.ok && !c.warnings.length) {
        await lib.put({ brand: e.brand, name: e.name, unit: e.unit }, out, { type: r.best.provider === 'openfoodfacts' ? 'openfoodfacts' : 'web', url: r.best.url }, true);
        return { found: true };
      }
    }
    e.webTried = new Date().toISOString().slice(0, 10);
    return { found: false, note: r.files.length ? 'Im Internet nichts sicher Passendes gefunden' : 'Im Internet nichts gefunden' };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Prospekt-Ausschnitte lokal auf eine Packung zuschneiden (ein Python-Lauf für alle). */
async function cleanUp(lib: Library, list: LibraryEntry[]) {
  const todo = list.filter((e) => e.source.type === 'prospekt' && !e.single);
  if (!todo.length) return 0;
  const work = await mkdtemp(join(tmpdir(), 'sincapp-katalog-'));
  try {
    const items = todo.map((e, i) => ({ e, image: lib.path(e), out: join(work, `${i}.png`) }));
    const res = await singleCopies(items.map(({ image, out }) => ({ image, out })));
    let n = 0;
    for (const it of items) {
      if (!res.get(it.out)?.ok) continue;
      await copyFile(it.out, it.image);
      it.e.single = true;
      n++;
    }
    return n;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Ein Produkt verbessern: Internet zuerst, sonst zuschneiden. */
export async function improveEntry(lib: Library, e: LibraryEntry, opts: { force?: boolean } = {}): Promise<{ result: Improved; note?: string }> {
  if (e.source.type !== 'prospekt') return { result: 'unverändert', note: 'Bild ist schon ein eigenes oder ein Internet-Foto' };
  const web = await tryWeb(lib, e, { force: opts.force, matcher: makeMatcher() });
  if (web.found) return { result: 'internet' };
  if (await cleanUp(lib, [e])) return { result: 'bereinigt', note: web.note };
  return { result: 'unverändert', note: web.note };
}

/** Alle Prospekt-Bilder im Hintergrund verbessern; Stand für die Katalog-Seite. */
const run = { running: false, done: 0, total: 0, internet: 0, bereinigt: 0, current: '' };

async function improveAll() {
  const lib = await Library.open();
  const matcher = makeMatcher();
  const todo = lib.entries.filter((e) => e.source.type === 'prospekt' && (!e.single || (matcher && !e.webTried)));
  Object.assign(run, { running: true, done: 0, total: todo.length, internet: 0, bereinigt: 0, current: '' });
  try {
    for (const e of todo) {
      run.current = [e.brand, e.name.de].filter(Boolean).join(' ');
      try {
        if ((await tryWeb(lib, e, { matcher })).found) {
          run.internet++;
          run.done++;
          await lib.save();
        }
      } catch {
        /* ein Produkt hält die anderen nicht auf */
      }
    }
    run.current = 'Prospekt-Ausschnitte zuschneiden';
    run.bereinigt = await cleanUp(lib, todo).catch(() => 0);
    run.done = run.total;
    await lib.save();
  } finally {
    run.running = false;
    run.current = '';
  }
}

/** /api/library…: Katalog lesen, bearbeiten, Bild ersetzen, verbessern, entfernen. */
export async function catalogApi(method: string, p: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (p === '/api/library/verbessern') {
    if (method === 'POST' && !run.running) void improveAll();
    return sendJson(res, run);
  }
  if (p === '/api/library' && method === 'GET') {
    const lib = await Library.open();
    await enrichFromJobs(lib);
    return sendJson(res, await Promise.all(lib.entries.map((e) => withUrl(lib, e))));
  }
  const m = p.match(/^\/api\/library\/([^/]+)(\/bild|\/internet)?$/);
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
  if (m[2] === '/internet' && method === 'POST') {
    const r = await improveEntry(lib, e, { force: true });
    await lib.save();
    return sendJson(res, { ...r, entry: await withUrl(lib, e) });
  }
  if (m[2] === '/bild' && method === 'POST') {
    // neues Produktbild: PNG direkt (Transparenz bleibt), JPG/WEBP werden umgewandelt
    const buf = await readBody(req);
    if (buf.length > 15_000_000) return sendJson(res, { error: 'Bild zu groß (max. 15 MB)' }, 400);
    const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpg = buf[0] === 0xff && buf[1] === 0xd8;
    const webp = buf.subarray(8, 12).toString('latin1') === 'WEBP';
    if (!png && !jpg && !webp) return sendJson(res, { error: 'Bitte ein PNG, JPG oder WEBP' }, 400);
    // eigenes Foto freistellen (vorhandene Transparenz bleibt); klappt das nicht, das Bild wie es ist
    const tmp = `${lib.path(e)}.upload${png ? '.png' : jpg ? '.jpg' : '.webp'}`;
    await writeFile(tmp, buf);
    try {
      const cut = await cutoutWeb([{ image: tmp, out: lib.path(e) }]).catch(() => null);
      if (!cut?.get(lib.path(e))?.ok) {
        const [line] = await runPython('crops.py', [], [{ image: tmp, box: null, out: lib.path(e), pad: 0, maxSide: 1600 }]);
        if (!JSON.parse(line).ok) return sendJson(res, { error: 'Bild ließ sich nicht lesen' }, 400);
      }
    } finally {
      await rm(tmp, { force: true });
    }
    e.source = { type: 'manual' };
    e.verified = true;
    delete e.webTried;
    delete e.single;
    await lib.save();
    return sendJson(res, await withUrl(lib, e));
  }
  return false;
}
