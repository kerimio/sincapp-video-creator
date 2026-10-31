// Story mit Playwright Bild für Bild rendern und mit ffmpeg zu MP4/PNG zusammensetzen.
import { marketDirs } from '../firestore/firestore';
import { chromium, type Browser } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startStaticServer } from '../server/static';
import { parseStory, type Lang } from '../core/schema';
import { ROOT } from '../paths';
import { LAYOUTS, type Format } from '../core/layout';
import { resolveDesign, SPEED_FACTOR } from '../core/design';

export interface RenderOptions {
  /** Job-Ordner mit story.json und den Bildern. */
  jobDir: string;
  outDir: string;
  langs: Lang[];
  fps?: number;
  workers?: number;
  /** Nur Einzelbilder bei diesen Zeiten (Sekunden), kein Video. */
  stills?: number[];
  /** Format (Standard: Story 9:16) */
  format?: Format;
  /** Zusätzliche URL-Parameter fürs Template, z. B. "&view=reel&offer=0" */
  extra?: string;
  /** Dateiname ohne Sprache, Standard: das Format ("story" → story-de.mp4) */
  name?: string;
  log?: (msg: string) => void;
}

export interface RenderResult {
  videos: Record<string, string>;
  poster?: string;
  stills: Record<string, string[]>;
  duration: number;
  frames: number;
  seconds: number;
}

export function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

export function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} beendet mit Code ${code}\n${err}`))));
  });
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'],
  });
}

/** `scale` < 1 liefert kleinere Screenshots (z. B. 512 px breit für die KI) bei gleichem Layout. */
export async function openStoryPage(browser: Browser, baseUrl: string, lang: Lang, format: Format = 'story', extra = '', scale = 1) {
  const { W, H } = LAYOUTS[format];
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseUrl}/?lang=${lang}${format === 'story' ? '' : `&format=${format}`}${extra}`);
  try {
    const info = await page.evaluate(() => window.sincapp.ready);
    return { page, duration: info.duration };
  } catch (e) {
    const msg = await page.evaluate(() => window.sincapp?.error).catch(() => undefined);
    throw new Error(`Story konnte nicht geladen werden: ${msg ?? (e as Error).message}${errors.length ? `\n${errors.join('\n')}` : ''}`);
  }
}

export function templateMounts(jobDir: string) {
  return {
    '/': join(ROOT, 'dist/template'),
    '/assets/': join(ROOT, 'assets'),
    '/markets/': marketDirs(),
    '/job/': resolve(jobDir),
  };
}

export async function renderStory(opts: RenderOptions): Promise<RenderResult> {
  const started = Date.now();
  const fps = opts.fps ?? 30;
  const workers = Math.max(1, opts.workers ?? Math.min(4, availableParallelism()));
  const log = opts.log ?? (() => {});
  const format = opts.format ?? 'story';
  await mkdir(opts.outDir, { recursive: true });
  const story = parseStory(JSON.parse(await readFile(join(opts.jobDir, 'story.json'), 'utf8')));
  const server = await startStaticServer(templateMounts(opts.jobDir));
  const browser = await launchBrowser();
  const result: RenderResult = { videos: {}, stills: {}, duration: 0, frames: 0, seconds: 0 };
  try {
    for (const lang of opts.langs) {
      const pages = await Promise.all(Array.from({ length: workers }, () => openStoryPage(browser, server.url, lang, format, opts.extra ?? '')));
      const duration = pages[0].duration;
      result.duration = duration;

      if (opts.stills) {
        const files: string[] = [];
        for (const [i, t] of opts.stills.entries()) {
          const file = join(opts.outDir, `still-${format === 'story' ? '' : `${format}-`}${lang}-${String(i).padStart(2, '0')}.png`);
          await pages[0].page.evaluate((tt) => window.sincapp.seek(tt), t);
          await pages[0].page.screenshot({ path: file, type: 'png' });
          files.push(file);
        }
        result.stills[lang] = files;
        await Promise.all(pages.map((p) => p.page.close()));
        continue;
      }

      const total = Math.round(duration * fps);
      result.frames = total;
      const tmp = await mkdtemp(join(tmpdir(), `sincapp-${lang}-`));
      log(`${lang}: ${total} Frames (${duration.toFixed(2)} s) mit ${workers} Tabs`);
      const chunk = Math.ceil(total / workers);
      let done = 0;
      await Promise.all(
        pages.map(async ({ page }, w) => {
          for (let i = w * chunk; i < Math.min(total, (w + 1) * chunk); i++) {
            await page.evaluate((tt) => window.sincapp.seek(tt), i / fps);
            const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
            await writeFile(join(tmp, `${String(i).padStart(5, '0')}.jpg`), buf);
            done++;
            if (done % 150 === 0) log(`${lang}: ${done}/${total}`);
          }
        }),
      );
      await Promise.all(pages.map((p) => p.page.close()));

      const out = join(opts.outDir, `${opts.name ?? format}-${lang}.mp4`);
      await run(ffmpegBin(), [
        '-y', '-loglevel', 'error',
        '-framerate', String(fps), '-i', join(tmp, '%05d.jpg'),
        '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
        '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.2', '-preset', 'slow', '-crf', '18',
        '-maxrate', '4.5M', '-bufsize', '9M', '-g', String(fps * 2),
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
        '-r', String(fps), '-movflags', '+faststart', '-an', out,
      ]);
      result.videos[lang] = out;
      log(`${lang}: ${out}`);
      if (!result.poster && !opts.extra) {
        // Poster: erste Angebotsseite, wenn alle Karten stehen.
        const k = SPEED_FACTOR[resolveDesign(story.design).speed];
        const posterFrame = Math.min(total - 1, Math.round(fps * k * (story.scenes.intro + 2.6)));
        result.poster = join(opts.outDir, format === 'story' ? 'preview.png' : `preview-${format}.png`);
        await copyFrameAsPng(join(tmp, `${String(posterFrame).padStart(5, '0')}.jpg`), result.poster);
      }
      await rm(tmp, { recursive: true, force: true });
    }
  } finally {
    await browser.close();
    await server.close();
  }
  result.seconds = (Date.now() - started) / 1000;
  return result;
}

async function copyFrameAsPng(jpg: string, png: string) {
  if (png.endsWith('.jpg')) return copyFile(jpg, png);
  await run(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', jpg, '-frames:v', '1', png]);
}
