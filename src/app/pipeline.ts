import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RecordedReader, type PageReader } from '../extract/claude';
import { makeMatcher, makeReader } from '../ai/provider';
import { extractJob } from '../extract/extract';
import type { Extraction } from '../extract/schema';
import { resolveImages } from '../images/resolve';
import { providersFromEnv } from '../images/search';
import { Library } from '../library/library';
import { ROOT } from '../paths';
import { extractionReport } from '../report';
import { buildStory, findTopic, selectOffers } from '../select/select';

export interface JobSettings {
  market: string;
  topic?: string | null;
  count?: number;
  /** Ordner mit aufgezeichneten Antworten statt Claude (Demo, Tests) */
  recorded?: string;
}

export type Step = 'extract' | 'images' | 'story' | 'render' | 'done';
export interface Progress {
  step: Step;
  message: string;
  /** 0–1 */
  fraction: number;
}

/**
 * Prospekt → story.json: Seiten lesen, Angebote auswählen, Bilder holen, Story bauen.
 * Fehler einzelner Seiten/Bilder landen in report.md; nur ohne verwertbare Angebote wird abgebrochen.
 */
export async function prepareStory(jobDir: string, s: JobSettings, onProgress: (p: Progress) => void = () => {}) {
  const marketFile = join(ROOT, 'markets', `${s.market}.json`);
  if (!existsSync(marketFile)) throw new Error(`Markt "${s.market}" nicht gefunden (markets/${s.market}.json)`);
  const topic = findTopic(s.topic ?? undefined);

  const reader: PageReader = s.recorded ? new RecordedReader(s.recorded) : makeReader();
  onProgress({ step: 'extract', message: 'Prospektseiten werden vorbereitet …', fraction: 0.02 });
  let pagesTotal = 1;
  const ex = await extractJob({
    jobDir,
    reader,
    log: (m) => {
      const n = m.match(/^(\d+) Seite\(n\) vorbereitet/);
      if (n) pagesTotal = Number(n[1]);
      const page = m.match(/^Seite (\d+): (.*)$/);
      if (page) onProgress({ step: 'extract', message: `Seite ${page[1]} von ${pagesTotal}: ${page[2].replace(/ …$/, '')}`, fraction: 0.05 + 0.45 * ((Number(page[1]) - (page[2].includes('Angebot') ? 0 : 0.5)) / pagesTotal) });
    },
  });
  await writeFile(join(jobDir, 'extraction.json'), JSON.stringify(ex, null, 2) + '\n');
  if (!ex.offers.length) {
    await writeFile(join(jobDir, 'report.md'), extractionReport(ex));
    throw new Error(`Keine Angebote erkannt. ${ex.warnings.join(' ')}`.trim());
  }

  onProgress({ step: 'images', message: `${ex.offers.length} Angebote erkannt – Auswahl und Produktbilder …`, fraction: 0.5 });
  const sel = selectOffers(ex.offers, { topic, count: s.count });
  let done = 0;
  const { notes } = await resolveImages(sel.offers, {
    jobDir,
    library: await Library.open(),
    providers: providersFromEnv(),
    matcher: s.recorded ? null : makeMatcher(),
    log: (m) => {
      const cut = m.match(/^Freisteller (\d+)\/(\d+)/);
      if (cut) done = Number(cut[1]);
      const msg = cut ? `Produktbilder freistellen: ${cut[1]} von ${cut[2]}` : m;
      onProgress({ step: 'images', message: msg, fraction: 0.5 + 0.45 * (cut ? done / Number(cut[2]) : 0.1) });
    },
  });
  const missing = sel.offers.filter((o) => !o.img);
  const usable = sel.offers.filter((o) => o.img);
  if (usable.length < 2) throw new Error(`Für zu wenige Angebote gab es ein Bild (${usable.length}).`);
  if (missing.length) notes.push(`Ohne Bild weggelassen: ${missing.map((o) => `${o.id} ${o.name.de}`).join(', ')}`);

  onProgress({ step: 'story', message: 'Story wird zusammengestellt …', fraction: 0.97 });
  const { story, warnings } = buildStory(ex, JSON.parse(await readFile(marketFile, 'utf8')), usable, topic);
  await writeFile(join(jobDir, 'story.json'), JSON.stringify(story, null, 2) + '\n');
  await writeFile(join(jobDir, 'extraction.json'), JSON.stringify(ex, null, 2) + '\n');
  await writeFile(join(jobDir, 'report.md'), extractionReport(ex, { notes: [...sel.warnings, ...warnings, ...notes] }));
  onProgress({ step: 'story', message: 'Fertig zum Prüfen', fraction: 1 });
  return { story, extraction: ex as Extraction, notes: [...sel.warnings, ...warnings, ...notes] };
}
