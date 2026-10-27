import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseStory } from '../core/schema';
import type { ExtractedOffer, Extraction } from '../extract/schema';
import { adoptImage, resolveImages } from '../images/resolve';
import { downloadImage, providersFromEnv, searchAll, searchQuery } from '../images/search';
import { ClaudeMatcher } from '../images/match';
import { Library } from '../library/library';
import { ROOT } from '../paths';
import { runPython } from '../python';
import { renderStory } from '../render/render';
import { verifyVideo } from '../render/verify';
import { startStaticServer } from '../server/static';
import { offerToStory } from '../select/select';

/**
 * Review-Server: liefert die Oberfläche (dist/review), die Vorschau (dist/template)
 * und eine kleine JSON-API für Speichern, Bilder und Rendern.
 */
export async function startReviewServer(jobDir: string, port = 4321, log: (m: string) => void = console.log) {
  const exFile = join(jobDir, 'extraction.json');
  const storyFile = join(jobDir, 'story.json');
  const library = await Library.open();
  let rendering = false;

  const readEx = async (): Promise<Extraction | null> => (existsSync(exFile) ? JSON.parse(await readFile(exFile, 'utf8')) : null);
  const saveEx = (ex: Extraction) => writeFile(exFile, JSON.stringify(ex, null, 2) + '\n');
  const offerOf = (ex: Extraction | null, id: string) => {
    const o = ex?.offers.find((x) => x.id === id);
    if (!o) throw new Error(`Angebot ${id} nicht gefunden`);
    return o;
  };

  async function body(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 20 * 1024 * 1024) throw new Error('Anfrage zu groß');
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }
  const json = (res: ServerResponse, data: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(data));
    return true;
  };

  /** Freistellen einer Datei (ganzes Bild) oder eines Prospekt-Ausschnitts nach images/<id>.png */
  async function cutout(o: ExtractedOffer, image: string, bbox: number[] | null, erase: number[][] = []) {
    const out = join(jobDir, 'images', `${o.id}.png`);
    const [line] = await runPython('cutout.py', [], [{ image, out, bbox, erase }]);
    const r = JSON.parse(line) as { ok: boolean; width?: number; warnings: string[] };
    if (!r.width) throw new Error(`Freistellen fehlgeschlagen: ${r.warnings.join('; ')}`);
    return { out, warnings: r.warnings };
  }

  const api = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith('/api/')) {
      if (url.pathname === '/') {
        res.writeHead(302, { location: '/review/' }).end();
        return true;
      }
      return false;
    }
    const m = url.pathname.match(/^\/api\/offer\/([\w-]+)\/(\w+)$/);

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, {
        story: existsSync(storyFile) ? JSON.parse(await readFile(storyFile, 'utf8')) : null,
        extraction: await readEx(),
        search: { brave: !!process.env.BRAVE_API_KEY, matcher: !!process.env.ANTHROPIC_API_KEY },
      });
    }

    if (req.method === 'PUT' && url.pathname === '/api/story') {
      const data = JSON.parse((await body(req)).toString('utf8'));
      // Cache-Buster aus den Bildpfaden entfernen
      for (const o of data.offers ?? []) if (typeof o.img === 'string') o.img = o.img.replace(/\?.*$/, '');
      const story = parseStory(data);
      await writeFile(storyFile, JSON.stringify(story, null, 2) + '\n');
      return json(res, { ok: true, story });
    }

    if (req.method === 'POST' && m) {
      const [, id, action] = m;
      const ex = await readEx();
      const o = offerOf(ex, id);
      await mkdir(join(jobDir, 'images'), { recursive: true });

      if (action === 'auto') {
        // Angebot neu in die Story: Bild wie bei `select` suchen
        const { notes } = await resolveImages([o], {
          jobDir,
          library,
          providers: providersFromEnv(),
          matcher: process.env.ANTHROPIC_API_KEY ? new ClaudeMatcher() : null,
          log,
        });
        await saveEx(ex!);
        return json(res, { offer: o, story: offerToStory(o), notes });
      }

      if (action === 'crop') {
        const { bbox } = JSON.parse((await body(req)).toString('utf8')) as { bbox: number[] };
        const erase = o.priceTagBbox ? [o.priceTagBbox] : [];
        const r = await cutout(o, join(jobDir, o.pageFile), bbox, erase);
        o.bbox = bbox.map(Math.round) as ExtractedOffer['bbox'];
        await adoptImage(o, jobDir, r.out, library, { type: 'prospekt' });
        o.warnings = o.warnings.filter((w) => !w.startsWith('Bild:')).concat(r.warnings.map((w) => `Bild: ${w}`));
        await saveEx(ex!);
        return json(res, { offer: o, warnings: r.warnings });
      }

      if (action === 'alternative') {
        const { index } = JSON.parse((await body(req)).toString('utf8')) as { index: number };
        const alt = o.imgAlternatives?.[index];
        if (!alt?.file) throw new Error('Diese Alternative ist nicht heruntergeladen');
        const r = await cutout(o, join(jobDir, alt.file), null);
        await adoptImage(o, jobDir, r.out, library, { type: alt.source === 'openfoodfacts' ? 'openfoodfacts' : 'web', url: alt.url });
        o.warnings = o.warnings.filter((w) => !w.startsWith('Bild:')).concat(r.warnings.map((w) => `Bild: ${w}`));
        await saveEx(ex!);
        return json(res, { offer: o, warnings: r.warnings });
      }

      if (action === 'search') {
        const { query } = JSON.parse((await body(req)).toString('utf8') || '{}') as { query?: string };
        const q = query?.trim() || searchQuery(o);
        const { images, errors } = await searchAll(providersFromEnv(), q, 10);
        const alts: NonNullable<ExtractedOffer['imgAlternatives']> = [];
        for (const [n, img] of images.entries()) {
          if (alts.length >= 8) break;
          try {
            const file = await downloadImage(img.url, join(jobDir, 'work/candidates', o.id, `s${Date.now()}-${n}`));
            alts.push({ source: img.provider, url: img.url, title: img.title, file: relative(jobDir, file) });
          } catch {
            /* überspringen */
          }
        }
        o.imgAlternatives = alts;
        await saveEx(ex!);
        return json(res, { offer: o, query: q, errors });
      }

      if (action === 'upload') {
        const buf = await body(req);
        const ext = (req.headers['content-type'] ?? '').includes('png') ? '.png' : (req.headers['content-type'] ?? '').includes('webp') ? '.webp' : '.jpg';
        const file = join(jobDir, 'work/uploads', `${o.id}-${Date.now()}${ext}`);
        await mkdir(join(jobDir, 'work/uploads'), { recursive: true });
        await writeFile(file, buf);
        const r = await cutout(o, file, null);
        await adoptImage(o, jobDir, r.out, library, { type: 'manual' });
        o.warnings = o.warnings.filter((w) => !w.startsWith('Bild:')).concat(r.warnings.map((w) => `Bild: ${w}`));
        await saveEx(ex!);
        return json(res, { offer: o, warnings: r.warnings });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/render') {
      if (rendering) return json(res, { error: 'Es läuft schon ein Render-Vorgang' }, 409);
      rendering = true;
      try {
        const story = parseStory(JSON.parse(await readFile(storyFile, 'utf8')));
        const outDir = join(jobDir, 'output');
        const r = await renderStory({ jobDir, outDir, langs: story.lang, log });
        const checks = await Promise.all(Object.values(r.videos).map((f) => verifyVideo(f, r.duration)));
        return json(res, {
          seconds: r.seconds,
          videos: Object.fromEntries(Object.entries(r.videos).map(([k, v]) => [k, `/job/${relative(jobDir, v)}`])),
          poster: r.poster ? `/job/${relative(jobDir, r.poster)}` : null,
          checks: checks.map((c) => ({ file: relative(jobDir, c.file), ok: c.ok, problems: c.problems, sizeMB: c.info.sizeMB, duration: c.info.duration })),
        });
      } finally {
        rendering = false;
      }
    }

    return json(res, { error: 'Unbekannte Anfrage' }, 404);
  };

  const mounts = {
    '/': join(ROOT, 'dist/template'),
    '/review/': join(ROOT, 'dist/review'),
    '/assets/': join(ROOT, 'assets'),
    '/markets/': join(ROOT, 'markets'),
    '/job/': jobDir,
  };
  return startStaticServer(mounts, port, api);
}
