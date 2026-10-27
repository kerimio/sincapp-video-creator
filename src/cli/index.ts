import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseStory } from '../core/schema';
import { renderStory } from '../render/render';
import { verifyVideo } from '../render/verify';
import { ROOT } from '../paths';

const program = new Command();
program.name('sincapp-story').description('Prospekt rein, Instagram-Story (MP4) raus');

/** Job-Name oder Pfad → Job-Ordner. */
function jobDir(job: string) {
  const direct = resolve(job);
  if (existsSync(join(direct, 'story.json'))) return direct;
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

program.parseAsync().catch((e) => {
  console.error(`Fehler: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
