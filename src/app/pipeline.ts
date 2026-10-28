// Ablauf Prospekt → Story: lesen, Angebote wählen, Bilder holen, Bestpreis markieren, Bericht schreiben.
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { RecordedReader, type PageReader } from '../extract/claude';
import { makeMatcher, makeReader } from '../ai/provider';
import { extractJob } from '../extract/extract';
import type { Extraction } from '../extract/schema';
import { resolveImages } from '../images/resolve';
import { providersFromEnv } from '../images/search';
import { Library } from '../library/library';
import { markBestPrices } from '../library/bestprice';
import { readMarket, readMarketDesign } from '../firestore/firestore';
import { Design } from '../core/design';
import { extractionReport } from '../report';
import { buildStory, findTopic, offerBoosts, selectOffers } from '../select/select';

export interface JobSettings {
  market: string;
  topic?: string | null;
  count?: number;
  /** Ordner mit aufgezeichneten Antworten statt Claude (Demo, Tests) */
  recorded?: string;
  /** Kampagne aus dem Katalog statt Prospekt */
  catalog?: import('./campaign').CatalogCampaign;
}

export type Step = 'extract' | 'images' | 'story' | 'render' | 'done';
export interface Progress {
  step: Step;
  message: string;
  /** 0–1 */
  fraction: number;
}

/**
 * Kommt der Prospekt aus Firestore, steht der Gültigkeitszeitraum dort verlässlich drin
 * (vom Admin eingetragen) – er hat Vorrang vor dem, was die KI auf den Seiten gelesen hat.
 * Bei mehreren Prospekten: vom frühesten Start bis zum spätesten Ende.
 */
export function applyFirestoreDates(ex: { validFrom: string | null; validTo: string | null; warnings: string[] }, jobDir: string) {
  const f = join(jobDir, 'firestore-prospekt.json');
  if (!existsSync(f)) return;
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  const prs = (Array.isArray(raw) ? raw : [raw]) as { validFrom?: string; validUntil?: string }[];
  const iso = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const from = prs.map((p) => iso(p.validFrom)).filter((x): x is string => !!x).sort()[0];
  const to = prs.map((p) => iso(p.validUntil)).filter((x): x is string => !!x).sort().at(-1);
  if (!from || !to || from > to) return;
  ex.validFrom = from;
  ex.validTo = to;
  ex.warnings = ex.warnings.filter((w) => !/Gültigkeitszeitraum/.test(w));
}

/**
 * Video aus Prospekten mehrerer Märkte: jedes Angebot bekommt den Markt seines Prospekts.
 * Die Seiten heißen "p<k>-seite-NN" (k = Nummer des Prospekts in firestore-prospekt.json).
 */
export function applyFirestoreMarkets(ex: { offers: { pageFile: string; market?: string }[] }, jobDir: string) {
  const f = join(jobDir, 'firestore-prospekt.json');
  if (!existsSync(f)) return;
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  const prs = (Array.isArray(raw) ? raw : [raw]) as { marketName?: string }[];
  if (new Set(prs.map((p) => p.marketName).filter(Boolean)).size < 2) return;
  for (const o of ex.offers) {
    const k = Number(basename(o.pageFile).match(/^p(\d+)-/)?.[1]);
    const name = prs[k - 1]?.marketName;
    if (name) o.market = name;
  }
}

/** Produktnamen, die in Firestore zum Prospekt gepflegt sind (DE, TR und Fundstellen-Beschriftungen). */
export function firestoreProductNames(jobDir: string): string[] {
  const f = join(jobDir, 'firestore-prospekt.json');
  if (!existsSync(f)) return [];
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  const prs = (Array.isArray(raw) ? raw : [raw]) as { products?: { name_de?: string; name_tr?: string; locations?: { label?: { de?: string; tr?: string } }[] }[] }[];
  return prs.flatMap((p) => (p.products ?? []).flatMap((x) => [x.name_de, x.name_tr, ...(x.locations ?? []).flatMap((l) => [l.label?.de, l.label?.tr])])).filter((x): x is string => !!x);
}

/**
 * Prospekt → story.json: Seiten lesen, Angebote auswählen, Bilder holen, Story bauen.
 * Fehler einzelner Seiten/Bilder landen in report.md; nur ohne verwertbare Angebote wird abgebrochen.
 */
export async function prepareStory(jobDir: string, s: JobSettings, onProgress: (p: Progress) => void = () => {}) {
  const marketRaw = await readMarket(s.market);
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
  applyFirestoreDates(ex, jobDir);
  applyFirestoreMarkets(ex, jobDir);
  await writeFile(join(jobDir, 'extraction.json'), JSON.stringify(ex, null, 2) + '\n');
  if (!ex.offers.length) {
    await writeFile(join(jobDir, 'report.md'), extractionReport(ex));
    throw new Error(`Keine Angebote erkannt. ${ex.warnings.join(' ')}`.trim());
  }

  onProgress({ step: 'images', message: `${ex.offers.length} Angebote erkannt – Auswahl und Produktbilder …`, fraction: 0.5 });
  const sel = selectOffers(ex.offers, { topic, count: s.count, boost: offerBoosts(ex, firestoreProductNames(jobDir)) });
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
  const { story, warnings } = buildStory(ex, marketRaw, usable, topic);
  // Gespeichertes Design des Markts übernehmen
  const design = await readMarketDesign(story.market.slug).catch(() => null);
  // ohne gespeichertes Design: die Vorlage nach dem sincapp Design System
  story.design = Design.parse(design ?? { preset: 'marke' });
  notes.push(...(await markBestPrices(story, usable, jobDir)));
  await writeFile(join(jobDir, 'story.json'), JSON.stringify(story, null, 2) + '\n');
  await writeFile(join(jobDir, 'extraction.json'), JSON.stringify(ex, null, 2) + '\n');
  await writeFile(join(jobDir, 'report.md'), extractionReport(ex, { notes: [...sel.warnings, ...warnings, ...notes] }));
  onProgress({ step: 'story', message: 'Fertig zum Prüfen', fraction: 1 });
  return { story, extraction: ex as Extraction, notes: [...sel.warnings, ...warnings, ...notes] };
}
