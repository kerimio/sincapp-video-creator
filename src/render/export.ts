import { copyFile, mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseStory, type Lang, type Story } from '../core/schema';
import { LAYOUTS, type Format } from '../core/layout';
import { buildScenes, deriveTimeline, storyDurations } from '../core/timeline';
import { pagesFor } from '../core/pages';
import { resolveDesign, SPEED_FACTOR } from '../core/design';
import { caption } from '../core/captions';
import { countdownDays, countdownName, offerCaption, planDir, planOverview, shortDate, weekday, weekPlan } from '../core/magic';
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
  /** Kurz-Reels (9:16, 7 s) für die ersten N Angebote */
  reels?: number;
  /** Instagram-Texte mitliefern */
  captions?: boolean;
  /** "Letzte Chance"-Videos (noch 2 Tage / heute) */
  countdown?: boolean;
  /** 7-Tage-Plan: pro Tag ein Angebot als Reel, Bild und Text, nach Tagen sortiert */
  plan?: boolean;
}

export interface ExportFile {
  /** Pfad relativ zum Job-Ordner */
  path: string;
  kind: 'video' | 'image' | 'text' | 'zip';
  label: string;
  format?: Format;
  lang?: Lang;
  /** Tag im 7-Tage-Plan, z. B. "Mittwoch, 29.10." */
  day?: string;
}

export interface ExportResult {
  seconds: number;
  files: ExportFile[];
  checks: (VideoCheck & { rel: string })[];
  zip: string | null;
  poster: string | null;
  /** Prüfung des fertigen Videos (Regeln + KI), siehe render/inspect.ts */
  inspection?: import('./inspect').Inspection;
}

const FORMAT_LABEL: Record<Format, string> = { story: 'Story 9:16', feed: 'Feed 4:5', quadrat: 'Quadrat 1:1' };

/** Zeitpunkte, an denen Intro, Seiten und Schluss fertig aufgebaut sind. */
export function stillTimes(story: Story, format: Format) {
  const k = SPEED_FACTOR[resolveDesign(story.design).speed];
  const tl = deriveTimeline(buildScenes(pagesFor(story, format).length, storyDurations(story.scenes, k)));
  return tl.sections.map((s) => ({ name: s.name, t: s.playStart + s.dur * (s.name === 'Intro' ? 0.85 : s.name === 'CTA' ? 0.6 : 0.72) }));
}

const dayLabel = (iso: string) => `${weekday(iso, 'de')}, ${shortDate(iso)}`;

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
  const plan = opts.plan ? weekPlan(story, !!opts.countdown) : [];
  // Der Plan braucht ein Reel für jedes Angebot, das darin vorkommt.
  const reels = Math.max(0, Math.min(Math.max(opts.reels ?? 0, ...plan.map((d) => d.offer + 1)), story.offers.length));
  const cds = opts.countdown ? countdownDays(story) : [];
  const steps = (opts.videos.length * 10 + reels * 3 + cds.length * 3 + opts.pageImages.length + opts.offerImages.length + (plan.length ? 1 : 0)) * langs.length + 1;
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

  for (let i = 0; i < reels; i++) {
    const base = done;
    const name = `reel-${String(i + 1).padStart(2, '0')}`;
    const r = await renderStory({
      jobDir,
      outDir: out,
      langs,
      extra: `&view=reel&offer=${i}`,
      name,
      log: (m) => {
        const prog = m.match(/^(\w+): (\d+)\/(\d+)/);
        if (prog) {
          done = base + (langs.indexOf(prog[1] as Lang) + Number(prog[2]) / Number(prog[3])) * 3;
          onProgress(Math.min(0.99, done / steps), `Reel ${i + 1} von ${reels} (${prog[1].toUpperCase()})`);
        }
      },
    });
    done = base + langs.length * 3;
    for (const [lang, file] of Object.entries(r.videos)) {
      const c = await verifyVideo(file, r.duration);
      checks.push({ ...c, rel: `output/${basename(file)}` });
      const o = story.offers[i];
      files.push({ path: `output/${basename(file)}`, kind: 'video', label: `Reel ${i + 1}: ${o.name.de.join(' ').replace(/- /g, '')} ${lang.toUpperCase()}`, format: 'story', lang: lang as Lang });
    }
  }

  const countdownFiles: Record<string, string> = {};
  for (const n of cds) {
    const base = done;
    const name = countdownName(n);
    const r = await renderStory({
      jobDir,
      outDir: out,
      langs,
      extra: `&view=countdown&days=${n}`,
      name,
      log: (m) => {
        const prog = m.match(/^(\w+): (\d+)\/(\d+)/);
        if (prog) {
          done = base + (langs.indexOf(prog[1] as Lang) + Number(prog[2]) / Number(prog[3])) * 3;
          onProgress(Math.min(0.99, done / steps), `Letzte-Chance-Video (${prog[1].toUpperCase()})`);
        }
      },
    });
    done = base + langs.length * 3;
    for (const [lang, file] of Object.entries(r.videos)) {
      const c = await verifyVideo(file, r.duration);
      checks.push({ ...c, rel: `output/${basename(file)}` });
      countdownFiles[`${n}-${lang}`] = file;
      files.push({ path: `output/${basename(file)}`, kind: 'video', label: `Letzte Chance: ${n === 0 ? 'heute' : `noch ${n} Tage`} ${lang.toUpperCase()}`, format: 'story', lang: lang as Lang });
    }
  }

  const needBrowser = opts.pageImages.length + opts.offerImages.length + plan.length > 0;
  if (needBrowser) {
    const imgDir = join(out, 'bilder');
    await rm(imgDir, { recursive: true, force: true });
    await mkdir(imgDir, { recursive: true });
    await rm(join(out, 'plan'), { recursive: true, force: true });
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
        for (const d of plan) {
          const dir = `output/plan/${planDir(d)}`;
          await mkdir(join(jobDir, dir), { recursive: true });
          const { page } = await openStoryPage(browser, server.url, lang, 'feed', `&view=offer&offer=${d.offer}`);
          await page.screenshot({ path: join(jobDir, dir, `bild-${lang}.png`) });
          await page.close();
          files.push({ path: `${dir}/bild-${lang}.png`, kind: 'image', label: `Bild ${lang.toUpperCase()}`, format: 'feed', lang, day: dayLabel(d.date) });
        }
        if (plan.length) tick(1, `7-Tage-Plan ${lang.toUpperCase()}`);
      }
    } finally {
      await browser.close();
      await server.close();
    }
  }

  const planOnly = new Set<string>();
  if (plan.length) {
    for (const d of plan) {
      const dir = `output/plan/${planDir(d)}`;
      await mkdir(join(jobDir, dir), { recursive: true });
      for (const lang of langs) {
        const reel = join(out, `reel-${String(d.offer + 1).padStart(2, '0')}-${lang}.mp4`);
        await copyFile(reel, join(jobDir, dir, `reel-${lang}.mp4`));
        files.push({ path: `${dir}/reel-${lang}.mp4`, kind: 'video', label: `Reel ${lang.toUpperCase()}`, format: 'story', lang, day: dayLabel(d.date) });
        if (d.countdown != null && countdownFiles[`${d.countdown}-${lang}`]) {
          await copyFile(countdownFiles[`${d.countdown}-${lang}`], join(jobDir, dir, `letzte-chance-${lang}.mp4`));
          files.push({ path: `${dir}/letzte-chance-${lang}.mp4`, kind: 'video', label: `Letzte Chance ${lang.toUpperCase()}`, format: 'story', lang, day: dayLabel(d.date) });
        }
        await writeFile(join(jobDir, dir, `text-${lang}.txt`), offerCaption(story, d.offer, lang, { countdown: d.countdown }) + '\n');
        files.push({ path: `${dir}/text-${lang}.txt`, kind: 'text', label: `Text ${lang.toUpperCase()}`, lang, day: dayLabel(d.date) });
      }
    }
    await writeFile(join(out, 'plan', 'wochenplan.txt'), planOverview(story, plan) + '\n');
    files.push({ path: 'output/plan/wochenplan.txt', kind: 'text', label: 'Wochenplan (Übersicht)' });
    // Reels, die nur für den Plan entstanden sind, liegen im ZIP nur im Plan-Ordner
    for (const f of files) if (/^output\/reel-(\d+)-/.test(f.path) && Number(f.path.match(/reel-(\d+)/)![1]) > (opts.reels ?? 0)) planOnly.add(f.path);
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
  await writeZip(tmpZip, files.filter((f) => !planOnly.has(f.path)).map((f) => ({ name: f.path.replace(/^output\//, ''), file: join(jobDir, f.path) })));
  await rename(tmpZip, join(out, zipName));
  files.push({ path: `output/${zipName}`, kind: 'zip', label: 'Alles als ZIP' });

  return { seconds: (Date.now() - started) / 1000, files, checks, zip: `output/${zipName}`, poster };
}
