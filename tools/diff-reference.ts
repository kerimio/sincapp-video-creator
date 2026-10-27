// Pixelvergleich: unser Template vs. Original-Referenz bei identischen Daten.
// Aufruf: pnpm diff:reference [--lang de] [--step 0.25]
import { mkdir, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { startStaticServer } from '../src/server/static';
import { launchBrowser, openStoryPage, templateMounts } from '../src/render/render';
import { buildScenes, deriveTimeline } from '../src/core/timeline';
import { ROOT } from '../src/paths';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const langs = opt('lang', 'de,tr').split(',') as ('de' | 'tr')[];
const step = Number(opt('step', '0.25'));
const THRESH = 24; // Kanal-Abweichung, ab der ein Pixel als verschieden zählt
const job = join(ROOT, 'test/fixtures/reference-job');
const out = join(ROOT, 'tmp/diff');

function diffPct(a: Buffer, b: Buffer, mark?: PNG) {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
    if (d > THRESH) {
      n++;
      if (mark) { mark.data[i] = 255; mark.data[i + 1] = 0; mark.data[i + 2] = 0; mark.data[i + 3] = 255; }
    } else if (mark) {
      const g = (A.data[i] + A.data[i + 1] + A.data[i + 2]) / 3;
      mark.data[i] = mark.data[i + 1] = mark.data[i + 2] = 128 + g / 2; mark.data[i + 3] = 255;
    }
  }
  return (100 * n) / (A.width * A.height);
}

const wochen = await mkdtemp(join(tmpdir(), 'sincapp-ref-'));
await cp(join(job, 'images'), wochen, { recursive: true });
await cp(join(ROOT, 'markets/saray/logo.jpg'), join(wochen, 'saray-logo.jpg'));
const refServer = await startStaticServer({
  '/': join(ROOT, 'tools/reference'),
  '/tpl/': join(ROOT, 'src/template'),
  '/vendor/': join(ROOT, 'reference/vendor'),
  '/ref/': join(ROOT, 'reference'),
  '/assets/wochenangebote/': wochen,
  '/assets/': join(ROOT, 'assets'),
});
const ourServer = await startStaticServer(templateMounts(job));
const browser = await launchBrowser();
await mkdir(out, { recursive: true });
const tl = deriveTimeline(buildScenes(2, { intro: 3.6, page: 4.5, cta: 6 }));
const report: string[] = ['| Sprache | Szene | max. Abweichung | Mittel | bei t |', '|---|---|---|---|---|'];
let worstOverall = 0;
try {
  for (const lang of langs) {
    const ref = await browser.newPage({ viewport: { width: 1080, height: 2100 }, deviceScaleFactor: 1 });
    await ref.goto(`${refServer.url}/?lang=${lang}`);
    await ref.waitForFunction(() => (window as any).refReady === true, null, { timeout: 30000 });
    const rect = await ref.evaluate(() => (window as any).refRect());
    const ours = await openStoryPage(browser, ourServer.url, lang);
    for (const s of tl.sections) {
      let max = 0; let sum = 0; let cnt = 0; let at = s.playStart;
      for (let t = s.playStart; t < s.playStart + s.dur - 1e-6; t += step) {
        await ref.evaluate((tt) => (window as any).refSeek(tt), t);
        const a = await ref.screenshot({ clip: rect });
        await ours.page.evaluate((tt) => window.sincapp.seek(tt), t);
        const b = await ours.page.screenshot();
        const pct = diffPct(a, b);
        sum += pct; cnt++;
        if (pct >= max) { max = pct; at = t; }
      }
      // Vergleichsbilder für den schlechtesten Frame der Szene
      await ref.evaluate((tt) => (window as any).refSeek(tt), at);
      const a = await ref.screenshot({ clip: rect });
      await ours.page.evaluate((tt) => window.sincapp.seek(tt), at);
      const b = await ours.page.screenshot();
      const mark = new PNG({ width: 1080, height: 1920 });
      diffPct(a, b, mark);
      await writeFile(join(out, `${lang}-${s.name}-ref.png`), a);
      await writeFile(join(out, `${lang}-${s.name}-ours.png`), b);
      await writeFile(join(out, `${lang}-${s.name}-diff.png`), PNG.sync.write(mark));
      worstOverall = Math.max(worstOverall, max);
      report.push(`| ${lang} | ${s.name} | ${max.toFixed(2)} % | ${(sum / cnt).toFixed(2)} % | ${at.toFixed(2)} s |`);
      console.log(`${lang} ${s.name}: max ${max.toFixed(2)} %, Mittel ${(sum / cnt).toFixed(2)} % (${cnt} Frames)`);
    }
    await ref.close();
    await ours.page.close();
  }
} finally {
  await browser.close();
  await refServer.close();
  await ourServer.close();
}
const md = `# Pixelvergleich gegen die Referenz\n\nSchwelle: Pixel zählt als verschieden ab ${THRESH}/255 Abweichung in einem Kanal. Abgetastet alle ${step} s.\n\n${report.join('\n')}\n\nZiel: < 2 % je Szene. Ergebnis: ${worstOverall < 2 ? 'erfüllt' : 'NICHT erfüllt'} (schlechtester Frame ${worstOverall.toFixed(2)} %).\n`;
await writeFile(join(out, 'report.md'), md);
console.log(md);
process.exit(worstOverall < 2 ? 0 : 1);
