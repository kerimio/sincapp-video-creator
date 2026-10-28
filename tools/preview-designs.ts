// Vorschaubilder aller Designs × Formate für einen Job (Standard: Referenz-Job).
// Aufruf: pnpm tsx tools/preview-designs.ts [--job <ordner>] [--out <ordner>] [--presets a,b] [--formats story,feed]
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStaticServer } from '../src/server/static';
import { launchBrowser, openStoryPage, templateMounts } from '../src/render/render';
import { buildScenes, deriveTimeline, storyDurations } from '../src/core/timeline';
import { PRESETS, resolveDesign, SPEED_FACTOR } from '../src/core/design';
import { pagesFor } from '../src/core/pages';
import { parseStory } from '../src/core/schema';
import type { Format } from '../src/core/layout';
import { ROOT } from '../src/paths';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const src = opt('job', join(ROOT, 'test/fixtures/reference-job'));
const out = opt('out', join(ROOT, 'tmp/designs'));
const presets = opt('presets', PRESETS.join(',')).split(',');
const formats = opt('formats', 'story,feed,quadrat').split(',') as Format[];
const lang = opt('lang', 'de') as 'de' | 'tr';

const job = await mkdtemp(join(tmpdir(), 'sincapp-designs-'));
await cp(src, job, { recursive: true });
const base = JSON.parse(await readFile(join(src, 'story.json'), 'utf8'));
await mkdir(out, { recursive: true });
const server = await startStaticServer(templateMounts(job));
const browser = await launchBrowser();
try {
  for (const preset of presets) {
    const data = { ...base, design: { ...(base.design ?? {}), preset } };
    await writeFile(join(job, 'story.json'), JSON.stringify(data));
    const story = parseStory(data);
    for (const format of formats) {
      const k = SPEED_FACTOR[resolveDesign(story.design).speed];
      const tl = deriveTimeline(buildScenes(pagesFor(story, format).length, storyDurations(story.scenes, k)));
      const { page } = await openStoryPage(browser, server.url, lang, format);
      const shots = tl.sections.map((s) => ({ name: s.name, t: s.playStart + s.dur * (s.name === 'Intro' ? 0.85 : 0.7) }));
      for (const s of shots) {
        await page.evaluate((tt) => window.sincapp.seek(tt), s.t);
        await page.screenshot({ path: join(out, `${preset}-${format}-${s.name}.png`) });
      }
      await page.close();
      console.log(`${preset} ${format}: ${shots.length} Bilder`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
