// Ablauf Prospekt → Story: lesen, Angebote wählen, Bilder holen, Bestpreis markieren, Bericht schreiben.
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { RecordedReader, type PageReader } from '../extract/claude';
import { makeMatcher, makeNamer, makeReader } from '../ai/provider';
import { checkPrices, extractJob } from '../extract/extract';
import type { Extraction } from '../extract/schema';
import { resolveImages } from '../images/resolve';
import { providersFromEnv } from '../images/search';
import { Library } from '../library/library';
import { markBestPrices } from '../library/bestprice';
import { readMarket, readMarketDesign } from '../firestore/firestore';
import { Design } from '../core/design';
import { extractionReport } from '../report';
import { applyCatalogNames, applyGlossary, glossary } from '../library/glossar';
import { normalizeNames } from '../library/names';
import { buildStory, findTopic, offerBoosts, PER_MARKET, selectByMarket, selectOffers } from '../select/select';

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

/** Märkte eines Videos aus mehreren Märkten, in der gewählten Reihenfolge (leer bei einem Markt). */
export function firestoreMarkets(jobDir: string): { name: string; logo?: string; address?: string; instagram?: string; dates?: { from: string; to: string } }[] {
  const f = join(jobDir, 'firestore-prospekt.json');
  if (!existsSync(f)) return [];
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  const prs = (Array.isArray(raw) ? raw : [raw]) as { marketName?: string; marketLogo?: string; marketAddress?: string; marketInstagram?: string; validFrom?: string; validUntil?: string }[];
  const iso = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  const out = new Map<string, { name: string; logo?: string; address?: string; instagram?: string; dates?: { from: string; to: string } }>();
  for (const p of prs) {
    if (!p.marketName) continue;
    if (!out.has(p.marketName)) out.set(p.marketName, { name: p.marketName, ...(p.marketLogo ? { logo: p.marketLogo } : {}), ...(p.marketAddress ? { address: p.marketAddress } : {}), ...(p.marketInstagram ? { instagram: p.marketInstagram } : {}) });
    // Zeitraum je Markt aus seinen Prospekten (frühester Start bis spätestes Ende) – jeder Markt hat seine eigenen Tage
    const m = out.get(p.marketName)!;
    const from = iso(p.validFrom);
    const to = iso(p.validUntil);
    if (from && to && from <= to) m.dates = { from: m.dates && m.dates.from < from ? m.dates.from : from, to: m.dates && m.dates.to > to ? m.dates.to : to };
  }
  return out.size >= 2 ? [...out.values()] : [];
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
 * Wie viele Produkte laut Firestore auf jeder Seite stehen, nach Dateiname ("p2-seite-03" bzw. "seite-03").
 * Liest die KI auf so einer Seite nichts, stimmt etwas nicht (siehe `expected` in extractJob).
 */
export function firestorePageProducts(jobDir: string): Map<string, number> {
  const out = new Map<string, number>();
  const f = join(jobDir, 'firestore-prospekt.json');
  if (!existsSync(f)) return out;
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  const prs = (Array.isArray(raw) ? raw : [raw]) as { products?: { locations?: { page?: number }[] }[] }[];
  prs.forEach((p, k) => {
    for (const prod of p.products ?? []) {
      // ein Produkt mit zwei Fundstellen auf derselben Seite zählt einmal
      for (const n of new Set((prod.locations ?? []).map((l) => l.page).filter((n): n is number => Number.isInteger(n)))) {
        const stem = `${prs.length > 1 ? `p${k + 1}-` : ''}seite-${String(n).padStart(2, '0')}`;
        out.set(stem, (out.get(stem) ?? 0) + 1);
      }
    }
  });
  return out;
}

/** Seiten, die nicht gelesen werden konnten, als Hinweis für die App: "Saray Market – Wochenangebote, Seite 3: …" */
export function unreadPages(ex: Pick<Extraction, 'pages'>, jobDir: string): string[] {
  const f = join(jobDir, 'firestore-prospekt.json');
  const raw = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
  const prs = (Array.isArray(raw) ? raw : [raw]) as { title?: string; marketName?: string }[];
  const failed = ex.pages.filter((p) => p.error);
  return failed.map((p) => {
    const m = basename(p.file).match(/^(?:p(\d+)-)?seite-(\d+)/);
    const pr = m ? prs[Number(m[1] ?? 1) - 1] : undefined;
    const where = pr && m ? `${[pr.marketName, pr.title].filter(Boolean).join(' – ')}, Seite ${Number(m[2])}` : basename(p.source);
    return `${where} nicht gelesen, ihre Angebote fehlen: ${p.error}`;
  });
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
  // Preise werden erst nach der Vorauswahl gegengeprüft (siehe unten) – nicht alle 180 Angebote eines dicken Prospekts
  let pagesRead = 0;
  const onPage = firestorePageProducts(jobDir);
  const ex = await extractJob({
    jobDir,
    reader,
    priceCheck: false,
    expected: (p) => onPage.get(basename(p.file).replace(/\.[^.]+$/, '')) ?? 0,
    log: (m) => {
      const n = m.match(/^(\d+) Seite\(n\) vorbereitet/);
      if (n) pagesTotal = Number(n[1]);
      // Seiten laufen parallel: Fortschritt nach Anzahl fertiger Seiten
      const page = m.match(/^Seite (\d+): (\d+) Angebot/);
      if (page) onProgress({ step: 'extract', message: `${(pagesRead = Math.min(pagesTotal, pagesRead + 1))} von ${pagesTotal} Seiten gelesen (Seite ${page[1]}: ${page[2]} Angebote)`, fraction: 0.05 + 0.4 * (pagesRead / pagesTotal) });
    },
  });
  applyFirestoreDates(ex, jobDir);
  applyFirestoreMarkets(ex, jobDir);
  // feste Namen, bevor ausgewählt wird: erst wie im Katalog, dann das Glossar (Hack bleibt Hack, egal wie der Prospekt es nennt)
  const library = await Library.open();
  const gloss = await glossary();
  const glossaryNotes = [...applyCatalogNames(ex.offers, library), ...(await normalizeNames(ex.offers, { namer: null })), ...applyGlossary(ex.offers, gloss)];
  await writeFile(join(jobDir, 'extraction.json'), JSON.stringify(ex, null, 2) + '\n');
  const unread = unreadPages(ex, jobDir);
  if (!ex.offers.length) {
    await writeFile(join(jobDir, 'report.md'), extractionReport(ex));
    throw new Error(`Keine Angebote erkannt. ${ex.warnings.join(' ')}`.trim());
  }

  // Vorauswahl mit Reserve, nur deren Preise gegenprüfen, dann daraus die endgültige Auswahl
  const boost = offerBoosts(ex, firestoreProductNames(jobDir));
  const markets = firestoreMarkets(jobDir);
  const names = markets.map((m) => m.name);
  const want = s.count ?? 8;
  // mehrere Märkte: jeder Markt eine Seite mit 5 Angeboten (2× frisches Fleisch groß, 3 weitere klein), Reserve von 2 je Markt
  const per = PER_MARKET;
  const shortlist = names.length
    ? selectByMarket(ex.offers, names, { topic, boost, per: per + 2 }).offers
    : selectOffers(ex.offers, { topic, count: want + Math.max(4, Math.ceil(want / 2)), boost }).offers;
  // neue Schreibweisen der Vorauswahl einmal vereinheitlichen lassen (nur Text, günstig, gemerkt) – danach gilt wieder das Glossar
  glossaryNotes.push(...(await normalizeNames(shortlist, { namer: s.recorded ? null : makeNamer(), library, glossary: gloss })), ...applyGlossary(shortlist, gloss));
  onProgress({ step: 'extract', message: `${ex.offers.length} Angebote erkannt – Preise der besten ${shortlist.length} werden gegengeprüft …`, fraction: 0.47 });
  ex.warnings.push(...(await checkPrices(shortlist, ex.pages, reader, join(jobDir, 'work'))));
  onProgress({ step: 'images', message: 'Auswahl und Produktbilder …', fraction: 0.5 });
  const sel = names.length ? selectByMarket(shortlist, names, { topic, boost, per }) : selectOffers(shortlist, { topic, count: s.count, boost });
  let done = 0;
  const { notes } = await resolveImages(sel.offers, {
    jobDir,
    library,
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
  if (markets.length) {
    // nur Märkte, die noch Angebote im Video haben; Seiten ergeben sich aus den Märkten der Angebote
    story.markets = markets.filter((m) => story.offers.some((o) => o.market === m.name));
    delete story.pages;
  }
  // Gespeichertes Design des Markts übernehmen
  const design = await readMarketDesign(story.market.slug).catch(() => null);
  // ohne gespeichertes Design: die Vorlage nach dem sincapp Design System
  story.design = Design.parse(design ?? { preset: 'marke' });
  notes.push(...(await markBestPrices(story, usable, jobDir)));
  await writeFile(join(jobDir, 'story.json'), JSON.stringify(story, null, 2) + '\n');
  await writeFile(join(jobDir, 'extraction.json'), JSON.stringify(ex, null, 2) + '\n');
  await writeFile(join(jobDir, 'report.md'), extractionReport(ex, { notes: [...sel.warnings, ...warnings, ...notes, ...glossaryNotes] }));
  onProgress({ step: 'story', message: 'Fertig zum Prüfen', fraction: 1 });
  // nicht gelesene Seiten zuerst: Sonst wundert man sich über fehlende Angebote, ohne den Grund zu sehen
  return { story, extraction: ex as Extraction, notes: [...unread, ...sel.warnings, ...warnings, ...notes] };
}
