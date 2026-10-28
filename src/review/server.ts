import { marketDirs } from '../firestore/firestore';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseStory } from '../core/schema';
import type { ExtractedOffer, Extraction } from '../extract/schema';
import { adoptImage, resolveImages } from '../images/resolve';
import { downloadImage, providersFromEnv, searchAll, searchQuery } from '../images/search';
import { aiProvider, makeMatcher } from '../ai/provider';
import { Library } from '../library/library';
import { ROOT } from '../paths';
import { runPython } from '../python';
import { renderStory } from '../render/render';
import { verifyVideo } from '../render/verify';
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
  result?: {
    seconds: number;
    videos: Record<string, string>;
    poster: string | null;
    checks: { file: string; ok: boolean; problems: string[]; sizeMB: number; duration: number }[];
  };
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

  async function startRender() {
    const story = parseStory(JSON.parse(await readFile(storyFile, 'utf8')));
    Object.assign(render, { running: true, fraction: 0, message: 'Video wird vorbereitet …', error: undefined, result: undefined });
    const langs = story.lang;
    let langIdx = 0;
    (async () => {
      try {
        const r = await renderStory({
          jobDir,
          outDir: join(jobDir, 'output'),
          langs,
          log: (m) => {
            log(m);
            const start = m.match(/^(\w+): (\d+) Frames/);
            if (start) langIdx = langs.indexOf(start[1] as never);
            const prog = m.match(/^(\w+): (\d+)\/(\d+)/);
            const per = prog ? Number(prog[2]) / Number(prog[3]) : start ? 0 : 0.97;
            render.fraction = Math.min(0.99, (langIdx + per) / langs.length);
            render.message = `${langs[langIdx]?.toUpperCase()}-Video: ${Math.round(per * 100)} %`;
          },
        });
        const checks = await Promise.all(Object.values(r.videos).map((f) => verifyVideo(f, r.duration)));
        render.result = {
          seconds: r.seconds,
          videos: Object.fromEntries(Object.entries(r.videos).map(([k, v]) => [k, `${urlBase}${relative(jobDir, v)}`])),
          poster: r.poster ? `${urlBase}${relative(jobDir, r.poster)}` : null,
          checks: checks.map((c) => ({ file: relative(jobDir, c.file), ok: c.ok, problems: c.problems, sizeMB: c.info.sizeMB, duration: c.info.duration })),
        };
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
        render: { ...render },
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
        if (render.running) return sendJson(res, { error: 'Das Video wird schon erstellt' }, 409);
        await startRender();
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
