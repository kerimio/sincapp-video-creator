import { marketDirs, readMarketDesign, saveMarketDesign, saveOwnLogo } from '../firestore/firestore';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseStory } from '../core/schema';
import { Design } from '../core/design';
import type { ExtractedOffer, Extraction } from '../extract/schema';
import { adoptImage, resolveImages } from '../images/resolve';
import { downloadImage, providersFromEnv, searchAll, searchQuery } from '../images/search';
import { aiProvider, makeMatcher } from '../ai/provider';
import { Library } from '../library/library';
import { ROOT } from '../paths';
import { runPython } from '../python';
import { exportJob, type ExportOptions, type ExportResult } from '../render/export';
import { LAYOUTS, type Format } from '../core/layout';
import { startStaticServer } from '../server/static';
import { offerToStory } from '../select/select';

export async function readBody(req: IncomingMessage, limit = 60 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('Datei zu groß');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export function sendJson(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(data));
  return true;
}

export interface RenderState {
  running: boolean;
  fraction: number;
  message: string;
  error?: string;
  /** letzter Export, Pfade als URLs */
  result?: ExportResult & { urlBase: string };
}

/**
 * API für einen Job (Prüfen, Bilder, Rendern). `urlBase` ist der Pfad, unter dem
 * der Job-Ordner statisch erreichbar ist (z. B. "/job/" oder "/jobs/<id>/").
 */
export function jobApi(jobDir: string, urlBase: string, log: (m: string) => void = () => {}) {
  const exFile = join(jobDir, 'extraction.json');
  const storyFile = join(jobDir, 'story.json');
  const render: RenderState = { running: false, fraction: 0, message: '' };
  let libraryP: Promise<Library> | null = null;
  const library = () => (libraryP ??= Library.open());

  const readEx = async (): Promise<Extraction | null> => (existsSync(exFile) ? JSON.parse(await readFile(exFile, 'utf8')) : null);
  const saveEx = (ex: Extraction) => writeFile(exFile, JSON.stringify(ex, null, 2) + '\n');
  const offerOf = (ex: Extraction | null, id: string) => {
    const o = ex?.offers.find((x) => x.id === id);
    if (!o) throw new Error(`Angebot ${id} nicht gefunden`);
    return o;
  };
  const clearImgWarnings = (o: ExtractedOffer, w: string[]) => (o.warnings = o.warnings.filter((x) => !x.startsWith('Bild:')).concat(w.map((x) => `Bild: ${x}`)));

  /** Freistellen einer Datei (ganzes Bild) oder eines Prospekt-Ausschnitts nach images/<id>.png */
  async function cutout(o: ExtractedOffer, image: string, bbox: number[] | null, erase: number[][] = [], extra: { keep?: boolean; polygon?: number[][] } = {}) {
    const out = join(jobDir, 'images', `${o.id}.png`);
    const [line] = await runPython('cutout.py', [], [{ image, out, bbox, erase, ...extra }]);
    const r = JSON.parse(line) as { ok: boolean; width?: number; warnings: string[] };
    if (!r.width) throw new Error(`Freistellen fehlgeschlagen: ${r.warnings.join('; ')}`);
    return { out, warnings: r.warnings };
  }

  const exportFile = join(jobDir, 'output', 'export.json');
  const lastExport = async (): Promise<RenderState['result'] | undefined> =>
    existsSync(exportFile) ? { ...(JSON.parse(await readFile(exportFile, 'utf8')) as ExportResult), urlBase } : undefined;

  async function startRender(opts: ExportOptions) {
    Object.assign(render, { running: true, fraction: 0, message: 'Wird vorbereitet …', error: undefined, result: undefined });
    (async () => {
      try {
        const r = await exportJob(jobDir, opts, (fraction, message) => {
          log(message);
          Object.assign(render, { fraction, message });
        });
        await writeFile(exportFile, JSON.stringify(r, null, 2) + '\n');
        render.result = { ...r, urlBase };
        Object.assign(render, { fraction: 1, message: 'Fertig' });
      } catch (e) {
        render.error = (e as Error).message;
      } finally {
        render.running = false;
      }
    })();
  }

  /** Bearbeitet `sub` (Pfad nach dem API-Präfix, z. B. "state", "offer/s1-1/crop"). */
  return async function handle(method: string, sub: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const m = sub.match(/^offer\/([\w-]+)\/(\w+)$/);

    if (method === 'GET' && sub === 'state') {
      return sendJson(res, {
        story: existsSync(storyFile) ? JSON.parse(await readFile(storyFile, 'utf8')) : null,
        extraction: await readEx(),
        search: { brave: !!process.env.BRAVE_API_KEY, matcher: !!aiProvider() },
        urlBase,
        render: { ...render, result: render.result ?? (render.running ? undefined : await lastExport()) },
        videos: existsSync(join(jobDir, 'output/story-de.mp4')) || existsSync(join(jobDir, 'output/story-tr.mp4')),
      });
    }

    if (method === 'PUT' && sub === 'story') {
      const data = JSON.parse((await readBody(req)).toString('utf8'));
      for (const o of data.offers ?? []) if (typeof o.img === 'string') o.img = o.img.replace(/\?.*$/, '');
      const story = parseStory(data);
      await writeFile(storyFile, JSON.stringify(story, null, 2) + '\n');
      return sendJson(res, { ok: true, story });
    }

    if (sub === 'market-design') {
      const story = parseStory(JSON.parse(await readFile(storyFile, 'utf8')));
      if (method === 'GET') return sendJson(res, { design: await readMarketDesign(story.market.slug) });
      if (method === 'PUT') {
        const design = Design.parse(JSON.parse((await readBody(req)).toString('utf8')));
        await saveMarketDesign(story.market.slug, design);
        return sendJson(res, { ok: true, design });
      }
    }

    if (method === 'POST' && sub === 'market-logo') {
      const buf = await readBody(req, 10 * 1024 * 1024);
      if (!(buf[0] === 0x89 || (buf[0] === 0xff && buf[1] === 0xd8))) return sendJson(res, { error: 'Bitte ein PNG- oder JPG-Bild hochladen' }, 400);
      const data = JSON.parse(await readFile(storyFile, 'utf8'));
      data.market.logo = await saveOwnLogo(data.market.slug, buf);
      delete data.market.logoCrop;
      const story = parseStory(data);
      await writeFile(storyFile, JSON.stringify(story, null, 2) + '\n');
      return sendJson(res, { story });
    }

    if (method === 'POST' && m) {
      const [, id, action] = m;
      const ex = await readEx();
      const o = offerOf(ex, id);
      await mkdir(join(jobDir, 'images'), { recursive: true });

      if (action === 'auto') {
        const { notes } = await resolveImages([o], {
          jobDir,
          library: await library(),
          providers: providersFromEnv(),
          matcher: makeMatcher(),
          log,
        });
        await saveEx(ex!);
        if (!o.img) throw new Error('Für dieses Angebot gibt es noch kein Bild');
        return sendJson(res, { offer: o, story: offerToStory(o), notes });
      }

      if (action === 'crop') {
        // Standard: der gewählte Ausschnitt bleibt wie er ist (Rechteck oder Pen-Form);
        // nur auf Wunsch wird zusätzlich der Hintergrund entfernt.
        const body = JSON.parse((await readBody(req)).toString('utf8')) as { bbox: number[]; polygon?: number[][]; removeBackground?: boolean };
        const polygon = body.polygon && body.polygon.length >= 3 ? body.polygon : undefined;
        const bbox = polygon
          ? [Math.min(...polygon.map((p) => p[0])), Math.min(...polygon.map((p) => p[1])), Math.max(...polygon.map((p) => p[0])), Math.max(...polygon.map((p) => p[1]))]
          : body.bbox;
        const r = body.removeBackground
          ? await cutout(o, join(jobDir, o.pageFile), bbox, o.priceTagBbox ? [o.priceTagBbox] : [])
          : await cutout(o, join(jobDir, o.pageFile), bbox, [], { keep: true, polygon });
        o.bbox = bbox.map(Math.round) as ExtractedOffer['bbox'];
        await adoptImage(o, jobDir, r.out, await library(), { type: 'prospekt' });
        clearImgWarnings(o, r.warnings);
        await saveEx(ex!);
        return sendJson(res, { offer: o, warnings: r.warnings });
      }

      if (action === 'alternative') {
        const { index } = JSON.parse((await readBody(req)).toString('utf8')) as { index: number };
        const alt = o.imgAlternatives?.[index];
        if (!alt?.file) throw new Error('Diese Alternative ist nicht heruntergeladen');
        const r = await cutout(o, join(jobDir, alt.file), null);
        await adoptImage(o, jobDir, r.out, await library(), { type: alt.source === 'openfoodfacts' ? 'openfoodfacts' : 'web', url: alt.url });
        clearImgWarnings(o, r.warnings);
        await saveEx(ex!);
        return sendJson(res, { offer: o, warnings: r.warnings });
      }

      if (action === 'search') {
        const { query } = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { query?: string };
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
        return sendJson(res, { offer: o, query: q, errors });
      }

      if (action === 'upload') {
        const buf = await readBody(req, 20 * 1024 * 1024);
        const type = req.headers['content-type'] ?? '';
        const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
        await mkdir(join(jobDir, 'work/uploads'), { recursive: true });
        const file = join(jobDir, 'work/uploads', `${o.id}-${Date.now()}${ext}`);
        await writeFile(file, buf);
        const r = await cutout(o, file, null);
        await adoptImage(o, jobDir, r.out, await library(), { type: 'manual' });
        clearImgWarnings(o, r.warnings);
        await saveEx(ex!);
        return sendJson(res, { offer: o, warnings: r.warnings });
      }
    }

    if (sub === 'render') {
      if (method === 'GET') return sendJson(res, render);
      if (method === 'POST') {
        if (render.running) return sendJson(res, { error: 'Der Export läuft schon' }, 409);
        const body = (await readBody(req)).toString('utf8');
        const o = (body ? JSON.parse(body) : {}) as Partial<ExportOptions>;
        const fmts = (x: unknown) => (Array.isArray(x) ? x.filter((f): f is Format => f in LAYOUTS) : []);
        const opts: ExportOptions = {
          videos: o.videos ? fmts(o.videos) : ['story'],
          pageImages: fmts(o.pageImages),
          offerImages: fmts(o.offerImages),
          langs: Array.isArray(o.langs) && o.langs.length ? o.langs.filter((l) => l === 'de' || l === 'tr') : undefined,
          captions: o.captions !== false,
        };
        if (!opts.videos.length && !opts.pageImages.length && !opts.offerImages.length && !opts.captions) return sendJson(res, { error: 'Bitte mindestens etwas zum Exportieren auswählen' }, 400);
        await startRender(opts);
        return sendJson(res, render, 202);
      }
    }

    return false;
  };
}

/** Review-Server für einen einzelnen Job (`sincapp-story review <job>`). */
export async function startReviewServer(jobDir: string, port = 4321, log: (m: string) => void = console.log) {
  const handle = jobApi(jobDir, '/job/', log);
  const mounts = {
    '/': join(ROOT, 'dist/template'),
    '/review/': join(ROOT, 'dist/review'),
    '/assets/': join(ROOT, 'assets'),
    '/markets/': marketDirs(),
    '/job/': jobDir,
  };
  return startStaticServer(mounts, port, async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/') {
      res.writeHead(302, { location: '/review/#/review' }).end();
      return true;
    }
    if (!url.pathname.startsWith('/api/')) return false;
    if (await handle(req.method ?? 'GET', url.pathname.slice('/api/'.length), req, res)) return true;
    return sendJson(res, { error: 'Unbekannte Anfrage' }, 404);
  });
}
