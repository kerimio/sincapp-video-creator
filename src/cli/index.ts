import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseStory } from '../core/schema';
import { renderStory } from '../render/render';
import { verifyVideo } from '../render/verify';
import { ROOT } from '../paths';
import { ClaudeReader, RecordedReader } from '../extract/claude';
import { extractJob } from '../extract/extract';
import { evaluate, type GroundTruth } from '../extract/evaluate';
import { resolveImages, type ResolveOptions } from '../images/resolve';
import { providersFromEnv } from '../images/search';
import { ClaudeMatcher } from '../images/match';
import { Library } from '../library/library';
import { buildStory, findTopic, selectOffers } from '../select/select';
import type { Extraction } from '../extract/schema';
import { extractionReport } from '../report';
import { writeFile } from 'node:fs/promises';

// .env laden (Node ≥ 20.12)
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile?.(join(ROOT, '.env'));

const program = new Command();
program.name('sincapp-story').description('Prospekt rein, Instagram-Story (MP4) raus');

/** Job-Name oder Pfad → Job-Ordner. */
function jobDir(job: string) {
  const direct = resolve(job);
  if (existsSync(join(direct, 'story.json')) || existsSync(join(direct, 'input'))) return direct;
  const inJobs = join(ROOT, 'jobs', job);
  if (existsSync(inJobs)) return inJobs;
  throw new Error(`Job nicht gefunden: ${job}`);
}

function ensureTemplateBuilt() {
  if (existsSync(join(ROOT, 'dist/template/index.html'))) return;
  const r = spawnSync('pnpm', ['build:template'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Template-Build fehlgeschlagen');
}

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
    matcher: process.env.ANTHROPIC_API_KEY ? new ClaudeMatcher() : null,
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
    const reader = o.recorded ? new RecordedReader(resolve(o.recorded)) : new ClaudeReader();
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
