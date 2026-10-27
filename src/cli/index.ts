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
import { cutoutOffers } from '../cutout/cutout';
import { findProductImages } from '../images/openfoodfacts';
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

program
  .command('extract')
  .argument('<job>', 'Job-Name (unter jobs/) oder Pfad; Prospektseiten liegen in <job>/input')
  .option('--recorded <dir>', 'gespeicherte Antworten statt Claude verwenden (Tests, Demo ohne API-Key)')
  .option('--no-price-check', 'Preis-Gegencheck auslassen')
  .option('--no-cutout', 'keine Freisteller erzeugen')
  .option('--no-internet', 'keine Internet-Bilder als Alternative suchen')
  .option('--eval <groundTruth>', 'Ergebnis gegen eine ground-truth.json prüfen (Abnahme)')
  .action(async (job: string, o: { recorded?: string; priceCheck: boolean; cutout: boolean; internet: boolean; eval?: string }) => {
    const started = Date.now();
    const dir = jobDir(job);
    const reader = o.recorded ? new RecordedReader(resolve(o.recorded)) : new ClaudeReader();
    const ex = await extractJob({ jobDir: dir, reader, priceCheck: o.priceCheck, log: (m) => console.log(m) });
    if (o.cutout && ex.offers.length) {
      await cutoutOffers(dir, ex.offers, (m) => process.stdout.write(`\r${m}`));
      process.stdout.write('\n');
    }
    const notes: string[] = [];
    if (o.internet) {
      let failed = 0;
      for (const off of ex.offers) {
        try {
          off.imgAlternatives = await findProductImages({ brand: off.brand, names: [off.name.de, off.name.tr] });
        } catch {
          failed++;
        }
      }
      if (failed) notes.push(`Internet-Bilder: Suche bei Open Food Facts für ${failed} von ${ex.offers.length} Angeboten nicht möglich (Netzwerk?) – Prospekt-Bilder werden verwendet`);
    }
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
