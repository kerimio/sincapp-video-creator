import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Design } from '../core/design';
import { DE_SOFT_CHARS, normalizePrice, TR_MAX_CHARS, nameLines } from '../extract/normalize';
import type { ExtractedOffer, Extraction } from '../extract/schema';
import { readMarket, readMarketDesign } from '../firestore/firestore';
import { markBestPrices } from '../library/bestprice';
import { Library } from '../library/library';
import { extractionReport } from '../report';
import { buildStory } from '../select/select';
import type { Progress } from './pipeline';

/** Kampagne direkt aus dem Produkt-Katalog: ohne Prospekt, ohne KI. */
export interface CatalogCampaign {
  /** Produkte (Dateiname im Katalog) mit Aktionspreis */
  items: { img: string; price: string }[];
  from: string;
  to: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Eingetippter Preis: "2,5" und "2.5" heißen 2,50 €. */
const priceOf = (raw: string) => normalizePrice(raw.trim().replace(/^(\d+)[.,](\d)$/, '$1,$20'));

/** Prüft die Eingaben; wirft mit einer verständlichen Meldung. */
export function checkCampaign(c: CatalogCampaign) {
  if (!Array.isArray(c.items) || c.items.length < 2) throw new Error('Bitte mindestens 2 Produkte wählen');
  if (c.items.length > 15) throw new Error('Höchstens 15 Produkte pro Kampagne');
  if (!ISO.test(c.from) || !ISO.test(c.to) || c.from > c.to) throw new Error('Bitte einen gültigen Zeitraum angeben');
  for (const it of c.items) if (!priceOf(it.price)) throw new Error(`Preis "${it.price}" nicht lesbar`);
}

/** Katalog-Produkte + Preise → story.json (gleiches Format wie aus dem Prospekt). */
export async function prepareCampaign(jobDir: string, market: string, c: CatalogCampaign, onProgress: (p: Progress) => void = () => {}) {
  checkCampaign(c);
  onProgress({ step: 'images', message: 'Produkte aus dem Katalog …', fraction: 0.2 });
  const lib = await Library.open();
  await mkdir(join(jobDir, 'images'), { recursive: true });
  const offers: ExtractedOffer[] = [];
  for (const [i, it] of c.items.entries()) {
    const e = lib.byImg(it.img);
    if (!e) throw new Error(`Produkt ${it.img} ist nicht mehr im Katalog`);
    const id = `k${i + 1}`;
    await lib.use(e, join(jobDir, 'images', `${id}.png`));
    offers.push({
      id,
      page: 0,
      pageFile: '',
      brand: e.brand,
      name: e.name,
      lines: { de: nameLines(e.brand, e.name.de, DE_SOFT_CHARS, false).lines, tr: nameLines(e.brand, e.name.tr, TR_MAX_CHARS).lines },
      unit: e.unit,
      price: priceOf(it.price),
      note: e.variant && e.variant.de && e.variant.tr ? e.variant : null,
      category: e.category ?? 'sonstiges',
      bbox: [0, 0, 0, 0],
      priceTagBbox: null,
      confidence: 1,
      priceConfidence: 1,
      img: `images/${id}.png`,
      imgSource: 'library',
      warnings: [],
    });
  }
  await lib.save();
  const marketRaw = (await readMarket(market)) as { name?: string; addresses?: string[] };
  const ex: Extraction = {
    version: 1,
    createdAt: new Date().toISOString(),
    model: 'katalog',
    market: marketRaw.name ?? null,
    validFrom: c.from,
    validTo: c.to,
    addresses: marketRaw.addresses ?? [],
    phone: null,
    pages: [],
    offers,
    warnings: [],
  };
  onProgress({ step: 'story', message: 'Story wird zusammengestellt …', fraction: 0.8 });
  const { story, warnings } = buildStory(ex, marketRaw, offers, null);
  const design = await readMarketDesign(story.market.slug).catch(() => null);
  story.design = Design.parse(design ?? { preset: 'marke' });
  const notes = [...warnings, ...(await markBestPrices(story, offers, jobDir, lib))];
  await writeFile(join(jobDir, 'story.json'), JSON.stringify(story, null, 2) + '\n');
  await writeFile(join(jobDir, 'extraction.json'), JSON.stringify(ex, null, 2) + '\n');
  await writeFile(join(jobDir, 'report.md'), extractionReport(ex, { notes: [`Kampagne aus dem Katalog (${basename(jobDir)})`, ...notes] }));
  onProgress({ step: 'story', message: 'Fertig zum Prüfen', fraction: 1 });
  return { story, extraction: ex, notes };
}
