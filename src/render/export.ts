import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseStory, type Lang, type Story } from '../core/schema';
import { LAYOUTS, type Format } from '../core/layout';
import { buildScenes, deriveTimeline, storyDurations } from '../core/timeline';
import { pagesFor } from '../core/pages';
import { resolveDesign, SPEED_FACTOR } from '../core/design';
import { caption } from '../core/captions';
import { startStaticServer } from '../server/static';
import { launchBrowser, openStoryPage, renderStory, templateMounts } from './render';
import { verifyVideo, type VideoCheck } from './verify';
import { writeZip } from './zip';

/** Was beim Export entstehen soll. */
export interface ExportOptions {
  /** Videos in diesen Formaten */
  videos: Format[];
  /** Jede Seite als Bild, in diesen Formaten */
  pageImages: Format[];
  /** Jedes Angebot einzeln als Bild, in diesen Formaten (feed/quadrat) */
  offerImages: Format[];
  langs?: Lang[];
  /** Instagram-Texte mitliefern */
  captions?: boolean;
}

export interface ExportFile {
  /** Pfad relativ zum Job-Ordner */
  path: string;
  kind: 'video' | 'image' | 'text' | 'zip';
  label: string;
  format?: Format;
  lang?: Lang;
}

export interface ExportResult {
  seconds: number;
  files: ExportFile[];
  checks: (VideoCheck & { rel: string })[];
  zip: string | null;
  poster: string | null;
}

const FORMAT_LABEL: Record<Format, string> = { story: 'Story 9:16', feed: 'Feed 4:5', quadrat: 'Quadrat 1:1' };
export const formatLabel = (f: Format) => FORMAT_LABEL[f];

/** Zeitpunkte, an denen Intro, Seiten und Schluss fertig aufgebaut sind. */
export function stillTimes(story: Story, format: Format) {
  const k = SPEED_FACTOR[resolveDesign(story.design).speed];
  const tl = deriveTimeline(buildScenes(pagesFor(story, format).length, storyDurations(story.scenes, k)));
  return tl.sections.map((s) => ({ name: s.name, t: s.playStart + s.dur * (s.name === 'Intro' ? 0.85 : s.name === 'CTA' ? 0.6 : 0.72) }));
}

const slugify = (s: string) => s.toLowerCase().replace(/ı/g, 'i').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function exportJob(jobDir: string, opts: ExportOptions, onProgress: (fraction: number, message: string) => void = () => {}): Promise<ExportResult> {
  const started = Date.now();
  const story = parseStory(JSON.parse(await readFile(join(jobDir, 'story.json'), 'utf8')));
  const langs = opts.langs ?? story.lang;
  const out = join(jobDir, 'output');
  await mkdir(out, { recursive: true });
  const files: ExportFile[] = [];
  const checks: ExportResult['checks'] = [];
  let poster: string | null = null;

  // Arbeitsschritte gewichtet: ein Video ≈ 10 Bilder
  const steps = opts.videos.length * langs.length * 10 + (opts.pageImages.length + opts.offerImages.length) * langs.length + 1;
  let done = 0;
  const tick = (w: number, msg: string) => {
    done += w;
    onProgress(Math.min(0.99, done / steps), msg);
  };

  for (const format of opts.videos) {
    let langIdx = 0;
    const base = done;
    const r = await renderStory({
      jobDir,
      outDir: out,
      langs,
      format,
      log: (m) => {
        const start = m.match(/^(\w+): (\d+) Frames/);
        if (start) langIdx = langs.indexOf(start[1] as Lang);
        const prog = m.match(/^(\w+): (\d+)\/(\d+)/);
        const per = prog ? Number(prog[2]) / Number(prog[3]) : start ? 0 : 0.97;
        done = base + (langIdx + per) * 10;
        onProgress(Math.min(0.99, done / steps), `Video ${FORMAT_LABEL[format]} ${langs[langIdx]?.toUpperCase()}: ${Math.round(per * 100)} %`);
      },
    });
    done = base + langs.length * 10;
    const { W, H } = LAYOUTS[format];
    for (const [lang, file] of Object.entries(r.videos)) {
      const c = await verifyVideo(file, r.duration, { w: W, h: H });
      checks.push({ ...c, rel: `output/${basename(file)}` });
      files.push({ path: `output/${basename(file)}`, kind: 'video', label: `Video ${FORMAT_LABEL[format]} ${lang.toUpperCase()}`, format, lang: lang as Lang });
    }
    if (r.poster && !poster) poster = `output/${basename(r.poster)}`;
  }

  const needBrowser = opts.pageImages.length + opts.offerImages.length > 0;
  if (needBrowser) {
    const imgDir = join(out, 'bilder');
    await rm(imgDir, { recursive: true, force: true });
    await mkdir(imgDir, { recursive: true });
    const server = await startStaticServer(templateMounts(jobDir));
    const browser = await launchBrowser();
    try {
      for (const lang of langs) {
        for (const format of opts.pageImages) {
          const { page } = await openStoryPage(browser, server.url, lang, format);
          for (const [i, s] of stillTimes(story, format).entries()) {
            await page.evaluate((tt) => window.sincapp.seek(tt), s.t);
            const label = s.name === 'Intro' ? 'titel' : s.name === 'CTA' ? 'schluss' : `seite-${s.name.slice(1)}`;
            const rel = `output/bilder/${format}-${lang}-${String(i + 1).padStart(2, '0')}-${label}.png`;
            await page.screenshot({ path: join(jobDir, rel) });
            files.push({ path: rel, kind: 'image', label: `${FORMAT_LABEL[format]} ${lang.toUpperCase()} · ${label}`, format, lang });
          }
          await page.close();
          tick(1, `Bilder ${FORMAT_LABEL[format]} ${lang.toUpperCase()}`);
        }
        for (const format of opts.offerImages) {
          for (const [i, o] of story.offers.entries()) {
            const { page } = await openStoryPage(browser, server.url, lang, format, `&view=offer&offer=${i}`);
            const name = slugify(o.name.de.join(' ')) || `angebot-${i + 1}`;
            const rel = `output/bilder/angebot-${String(i + 1).padStart(2, '0')}-${name}-${format}-${lang}.png`;
            await page.screenshot({ path: join(jobDir, rel) });
            await page.close();
            files.push({ path: rel, kind: 'image', label: `Angebot ${i + 1} ${FORMAT_LABEL[format]} ${lang.toUpperCase()}`, format, lang });
          }
          tick(1, `Einzelangebote ${FORMAT_LABEL[format]} ${lang.toUpperCase()}`);
        }
      }
    } finally {
      await browser.close();
      await server.close();
    }
  }

  if (opts.captions !== false) {
    for (const lang of langs) {
      const rel = `output/instagram-text-${lang}.txt`;
      await writeFile(join(jobDir, rel), caption(story, lang) + '\n');
      files.push({ path: rel, kind: 'text', label: `Instagram-Text ${lang.toUpperCase()}`, lang });
    }
  }

  onProgress(0.99, 'ZIP wird gepackt …');
  const zipName = `${slugify(story.market.name)}-${story.dates.from}.zip`;
  const tmpZip = join(out, `.${zipName}.tmp`);
  await writeZip(tmpZip, files.map((f) => ({ name: f.path.replace(/^output\//, ''), file: join(jobDir, f.path) })));
  await rename(tmpZip, join(out, zipName));
  files.push({ path: `output/${zipName}`, kind: 'zip', label: 'Alles als ZIP' });

  return { seconds: (Date.now() - started) / 1000, files, checks, zip: `output/${zipName}`, poster };
}
