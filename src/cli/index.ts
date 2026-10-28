import { Command } from 'commander';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseStory } from '../core/schema';
import { renderStory } from '../render/render';
import { verifyVideo } from '../render/verify';
import { ROOT } from '../paths';
import { RecordedReader } from '../extract/claude';
import { makeMatcher, makeReader } from '../ai/provider';
import { extractJob } from '../extract/extract';
import { evaluate, type GroundTruth } from '../extract/evaluate';
import { resolveImages, type ResolveOptions } from '../images/resolve';
import { providersFromEnv } from '../images/search';
import { Library } from '../library/library';
import { buildStory, findTopic, selectOffers } from '../select/select';
import type { Extraction } from '../extract/schema';
import { extractionReport } from '../report';
import { copyFile, writeFile } from 'node:fs/promises';
import { startReviewServer } from '../review/server';
import { startAppServer } from '../app/server';
import { createJob, jobPath, jobsDir, safeName } from '../app/jobs';
import { prepareStory } from '../app/pipeline';

// .env laden (Node ≥ 20.12)
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile?.(join(ROOT, '.env'));

const program = new Command();
program.name('sincapp-story').description('Prospekt rein, Instagram-Story (MP4) raus');

/** Job-Name oder Pfad → Job-Ordner. */
function jobDir(job: string) {
  const direct = resolve(job);
  if (existsSync(join(direct, 'story.json')) || existsSync(join(direct, 'input'))) return direct;
  const inJobs = join(jobsDir(), job);
  if (existsSync(inJobs)) return inJobs;
  throw new Error(`Job nicht gefunden: ${job}`);
}

/** Neueste Änderungszeit der Dateien/Ordner (rekursiv). */
function newest(dirs: string[]): number {
  let t = 0;
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    if (!statSync(d).isDirectory()) {
      t = Math.max(t, statSync(d).mtimeMs);
      continue;
    }
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      t = Math.max(t, e.isDirectory() ? newest([f]) : statSync(f).mtimeMs);
    }
  }
  return t;
}

/** Baut ein Frontend, wenn es fehlt oder älter als seine Quellen ist (z. B. nach einem Update). */
function ensureBuilt(script: string, out: string, sources: string[]) {
  const index = join(ROOT, out, 'index.html');
  if (existsSync(index) && statSync(index).mtimeMs >= newest(sources.map((s) => join(ROOT, s)))) return;
  const r = spawnSync('pnpm', [script], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${script} fehlgeschlagen`);
}
const ensureTemplateBuilt = () => ensureBuilt('build:template', 'dist/template', ['src/template', 'src/core']);
const ensureReviewBuilt = () => ensureBuilt('build:review', 'dist/review', ['src/review/ui', 'src/core', 'src/template/fonts.css']);

function openBrowser(url: string) {
  if (process.platform === 'darwin') spawnSync('open', [url]);
  else if (process.platform === 'win32') spawnSync('cmd', ['/c', 'start', '', url]);
}

program
  .command('app')
  .description('Web-App starten: Prospekte hochladen, prüfen, Video herunterladen')
  .option('-p, --port <n>', 'Port', (v) => parseInt(v, 10), 4321)
  .option('--no-open', 'Browser nicht automatisch öffnen')
  .action(async (o: { port: number; open: boolean }) => {
    ensureTemplateBuilt();
    ensureReviewBuilt();
    let server;
    try {
      server = await startAppServer(o.port);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
      // läuft schon (z. B. zweimal doppelgeklickt) – einfach die vorhandene App öffnen
      const url = `http://127.0.0.1:${o.port}/app/`;
      console.log(`Die App läuft bereits: ${url}`);
      if (o.open) openBrowser(url);
      return;
    }
    const url = `${server.url}/app/`;
    console.log(`\nsincapp Story-Generator läuft: ${url}\nDieses Fenster offen lassen – Beenden mit Strg+C.\n`);
    if (o.open) openBrowser(url);
  });

program
  .command('new')
  .description('Neuen Job aus Prospektdateien anlegen und bis zur story.json verarbeiten')
  .requiredOption('-m, --market <slug>', 'Markt (Datei unter markets/)')
  .requiredOption('-i, --input <pfade...>', 'Prospektseiten (Dateien oder Ordner)')
  .option('-t, --topic <thema>', 'Thema, z. B. fleisch, snacks, getraenke')
  .option('-n, --count <n>', 'Anzahl Angebote', (v) => parseInt(v, 10))
  .option('--recorded <dir>', 'aufgezeichnete Antworten statt Claude (Tests/Demo)')
  .option('--auto', 'ohne Prüfen direkt die Videos rendern')
  .action(async (o: { market: string; input: string[]; topic?: string; count?: number; recorded?: string; auto?: boolean }) => {
    const files = o.input.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).map((f) => join(p, f)) : [p])).filter((f) => /\.(pdf|png|jpe?g|webp)$/i.test(f));
    if (!files.length) throw new Error('Keine Prospektdateien gefunden (PDF, JPG, PNG, WEBP).');
    const settings = { market: o.market, topic: o.topic ?? null, count: o.count, recorded: o.recorded && resolve(o.recorded) };
    const meta = await createJob(settings);
    const dir = jobPath(meta.id);
    for (const f of files) await copyFile(f, join(dir, 'input', safeName(basename(f))));
    console.log(`Job ${meta.id}: ${files.length} Datei(en)`);
    let last = '';
    const r = await prepareStory(dir, settings, (p) => {
      if (p.message !== last) console.log(`[${Math.round(p.fraction * 100)} %] ${(last = p.message)}`);
    });
    for (const n of r.notes) console.log(`Hinweis: ${n}`);
    console.log(`story.json mit ${r.story.offers.length} Angeboten: ${dir}`);
    if (!o.auto) {
      console.log(`Prüfen: pnpm cli app  →  Job „${meta.id}“ öffnen`);
      return;
    }
    ensureTemplateBuilt();
    const res = await renderStory({ jobDir: dir, outDir: join(dir, 'output'), langs: r.story.lang as ('de' | 'tr')[], log: (m) => console.log(m) });
    for (const [lang, file] of Object.entries(res.videos)) {
      const v = await verifyVideo(file, res.duration);
      if (!v.ok) process.exitCode = 1;
      console.log(`${lang}: ${file} ${v.ok ? '✓' : '✗ ' + v.problems.join('; ')}`);
    }
  });

program
  .command('review')
  .argument('<job>', 'Job mit story.json (und extraction.json)')
  .option('-p, --port <n>', 'Port', (v) => parseInt(v, 10), 4321)
  .action(async (job: string, o: { port: number }) => {
    ensureTemplateBuilt();
    ensureReviewBuilt();
    const dir = jobDir(job);
    if (!existsSync(join(dir, 'story.json'))) throw new Error(`Keine story.json in ${dir} – erst \`select\` ausführen.`);
    const server = await startReviewServer(dir, o.port);
    console.log(`Review läuft: ${server.url}/review/#/review  (Beenden mit Strg+C)`);
    openBrowser(`${server.url}/review/#/review`);
  });

program
  .command('render')
  .argument('<job>', 'Job-Name (unter jobs/) oder Pfad zu einem Ordner mit story.json')
  .option('-l, --lang <langs>', 'Sprachen, kommagetrennt (Standard: aus story.json)')
  .option('-o, --out <dir>', 'Ausgabeordner (Standard: <job>/output)')
  .option('-w, --workers <n>', 'parallele Browser-Tabs', (v) => parseInt(v, 10))
  .action(async (job: string, o: { lang?: string; out?: string; workers?: number }) => {
    ensureTemplateBuilt();
    const dir = jobDir(job);
    const story = parseStory(JSON.parse(await readFile(join(dir, 'story.json'), 'utf8')));
    const langs = (o.lang ? o.lang.split(',') : story.lang) as ('de' | 'tr')[];
    const outDir = resolve(o.out ?? join(dir, 'output'));
    const res = await renderStory({ jobDir: dir, outDir, langs, workers: o.workers, log: (m) => console.log(m) });
    let ok = true;
    for (const [lang, file] of Object.entries(res.videos)) {
      const v = await verifyVideo(file, res.duration);
      ok &&= v.ok;
      console.log(`${lang}: ${v.info.width}×${v.info.height}, ${v.info.fps} fps, ${v.info.codec}/${v.info.pixFmt}, ${v.info.duration.toFixed(2)} s, ${v.info.sizeMB.toFixed(1)} MB ${v.ok ? '✓' : '✗ ' + v.problems.join('; ')}`);
    }
    console.log(`Poster: ${res.poster}`);
    console.log(`Fertig in ${res.seconds.toFixed(1)} s`);
    if (!ok) process.exitCode = 1;
  });

async function imageOptions(dir: string): Promise<ResolveOptions> {
  return {
    jobDir: dir,
    library: await Library.open(),
    providers: providersFromEnv(),
    matcher: makeMatcher(),
    log: (m) => console.log(m),
  };
}

program
  .command('select')
  .argument('<job>', 'Job mit extraction.json')
  .requiredOption('-m, --market <slug>', 'Markt aus markets/<slug>.json')
  .option('-t, --topic <thema>', 'nur ein Thema, z. B. fleisch, snacks, vorrat, getraenke, frische, milch, haushalt')
  .option('-n, --count <n>', 'Anzahl Angebote (Standard 8)', (v) => parseInt(v, 10))
  .action(async (job: string, o: { market: string; topic?: string; count?: number }) => {
    const dir = jobDir(job);
    const ex = JSON.parse(await readFile(join(dir, 'extraction.json'), 'utf8')) as Extraction;
    const marketFile = join(ROOT, 'markets', `${o.market}.json`);
    if (!existsSync(marketFile)) throw new Error(`Markt nicht gefunden: ${marketFile}`);
    const topic = findTopic(o.topic);
    const sel = selectOffers(ex.offers, { topic, count: o.count });
    console.log(`Auswahl: ${sel.offers.map((x) => x.id).join(', ')}`);
    const { notes } = await resolveImages(sel.offers, await imageOptions(dir));
    const missing = sel.offers.filter((x) => !x.img);
    if (missing.length) throw new Error(`Kein Bild für ${missing.map((x) => x.id).join(', ')} – siehe report.md`);
    const { story, warnings } = buildStory(ex, JSON.parse(await readFile(marketFile, 'utf8')), sel.offers, topic);
    await writeFile(join(dir, 'story.json'), JSON.stringify(story, null, 2) + '\n');
    await writeFile(join(dir, 'extraction.json'), JSON.stringify(ex, null, 2) + '\n');
    const report = extractionReport(ex, { notes: [...sel.warnings, ...warnings, ...notes] });
    await writeFile(join(dir, 'report.md'), report);
    for (const x of sel.offers) console.log(`  ${x.id}  ${x.price}  ${x.name.de}  ← ${x.imgSource}`);
    console.log(`story.json geschrieben (${story.offers.length} Angebote${topic ? `, Thema ${topic.key}` : ''})`);
  });

program
  .command('extract')
  .argument('<job>', 'Job-Name (unter jobs/) oder Pfad; Prospektseiten liegen in <job>/input')
  .option('--recorded <dir>', 'gespeicherte Antworten statt Claude verwenden (Tests, Demo ohne API-Key)')
  .option('--no-price-check', 'Preis-Gegencheck auslassen')
  .option('--images', 'gleich Bilder für alle Angebote suchen/freistellen (sonst erst bei `select`)')
  .option('--eval <groundTruth>', 'Ergebnis gegen eine ground-truth.json prüfen (Abnahme)')
  .action(async (job: string, o: { recorded?: string; priceCheck: boolean; images?: boolean; eval?: string }) => {
    const started = Date.now();
    const dir = jobDir(job);
    const reader = o.recorded ? new RecordedReader(resolve(o.recorded)) : makeReader();
    const ex = await extractJob({ jobDir: dir, reader, priceCheck: o.priceCheck, log: (m) => console.log(m) });
    const notes: string[] = [];
    if (o.images && ex.offers.length) notes.push(...(await resolveImages(ex.offers, await imageOptions(dir))).notes);
    await writeFile(join(dir, 'extraction.json'), JSON.stringify(ex, null, 2) + '\n');
    const seconds = (Date.now() - started) / 1000;
    let report = extractionReport(ex, { seconds, notes });
    if (o.eval) {
      const gt = JSON.parse(await readFile(resolve(o.eval), 'utf8')) as GroundTruth;
      const ev = evaluate(ex, gt);
      report += [
        '',
        '## Abnahme gegen Referenz',
        '',
        `- Erkannt: ${ev.found}/${ev.expected} (${(ev.recall * 100).toFixed(0)} %, Ziel ≥ 95 %) ${ev.recall >= 0.95 ? '✓' : '✗'}`,
        `- Falsche Preise ohne Markierung: ${ev.wrongUnflagged.length} ${ev.wrongUnflagged.length ? '✗ ' + ev.wrongUnflagged.join('; ') : '✓'}`,
        `- Falsche Preise, aber markiert: ${ev.wrongFlagged.length}${ev.wrongFlagged.length ? ' (' + ev.wrongFlagged.join('; ') + ')' : ''}`,
        `- Gültigkeit: ${ev.validityOk ? '✓' : '✗'} · Adresse: ${ev.addressOk ? '✓' : '✗'}`,
        ...(ev.missing.length ? [`- Nicht gefunden: ${ev.missing.join('; ')}`] : []),
        '',
      ].join('\n');
      console.log(`Abnahme: ${ev.passed ? 'bestanden' : 'NICHT bestanden'} (${ev.found}/${ev.expected} erkannt)`);
      if (!ev.passed) process.exitCode = 1;
    }
    await writeFile(join(dir, 'report.md'), report);
    const flagged = ex.offers.filter((x) => x.priceConfidence < 0.9 || x.warnings.length).length;
    console.log(`${ex.offers.length} Angebote, ${flagged} zu prüfen → ${join(dir, 'extraction.json')}, ${join(dir, 'report.md')} (${seconds.toFixed(0)} s)`);
  });

program.parseAsync().catch((e) => {
  console.error(`Fehler: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
