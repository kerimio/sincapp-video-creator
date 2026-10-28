// Prospekt lesen: Seiten vorbereiten, an die KI geben (gecacht), Preise gegenprüfen, extraction.json schreiben.
import { readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { runPython } from '../python';
import type { PageReader } from './claude';
import { DE_SOFT_CHARS, TR_MAX_CHARS, normalizeDate, normalizePrice, normalizeUnit, offerKey, nameLines } from './normalize';
import type { ExtractedOffer, Extraction, PageResult } from './schema';

const INPUT_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf']);

export interface PreparedPage {
  source: string;
  page: number;
  file: string;
  width: number;
  height: number;
}

/** Alle Prospektdateien aus <job>/input, natürlich sortiert (seite-2 vor seite-10). */
export async function listInputs(inputDir: string) {
  const names = (await readdir(inputDir)).filter((n) => INPUT_EXT.has(extname(n).toLowerCase()) && !n.startsWith('.'));
  names.sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
  return names.map((n) => join(inputDir, n));
}

export async function preparePages(files: string[], outDir: string): Promise<PreparedPage[]> {
  if (!files.length) return [];
  const [line] = await runPython('prep.py', [outDir, ...files]);
  return JSON.parse(line);
}

const box = (b: number[] | null | undefined, w: number, h: number): [number, number, number, number] | null => {
  if (!b || b.length !== 4 || b.some((v) => !Number.isFinite(v))) return null;
  const [x0, y0, x1, y1] = [Math.max(0, Math.min(b[0], b[2])), Math.max(0, Math.min(b[1], b[3])), Math.min(w, Math.max(b[0], b[2])), Math.min(h, Math.max(b[1], b[3]))];
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  return [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)];
};

/** Rohes Seitenergebnis → normalisierte Angebote mit Warnungen. */
export function normalizePage(raw: PageResult, page: PreparedPage, pageNo: number, jobDir: string): ExtractedOffer[] {
  return raw.offers.map((o, i) => {
    const warnings: string[] = [];
    const price = normalizePrice(o.price);
    if (!price) warnings.push(`Preis "${o.price}" nicht lesbar`);
    const tr = nameLines(o.brand, o.name_tr, TR_MAX_CHARS);
    if (tr.truncated) warnings.push(`Türkischer Name "${o.name_tr}" passt nicht in 2 × ${TR_MAX_CHARS} Zeichen – gekürzt auf "${tr.lines.join(' / ')}"`);
    const de = nameLines(o.brand, o.name_de, DE_SOFT_CHARS, false);
    const bbox = box(o.bbox, page.width, page.height);
    if (!bbox) warnings.push('Kein gültiger Bildausschnitt erkannt');
    const confidence = Math.max(0, Math.min(1, o.confidence));
    return {
      id: `s${pageNo}-${i + 1}`,
      page: pageNo,
      pageFile: relative(jobDir, page.file),
      brand: o.brand?.trim() || null,
      name: { de: o.name_de.trim(), tr: o.name_tr.trim() },
      lines: { de: de.lines, tr: tr.lines },
      unit: normalizeUnit(o.unit),
      price,
      note: o.note_de && o.note_tr ? { de: o.note_de.trim(), tr: o.note_tr.trim() } : null,
      category: o.category,
      bbox: bbox ?? [0, 0, page.width, page.height],
      priceTagBbox: box(o.price_tag_bbox, page.width, page.height),
      confidence,
      // wird im Gegencheck gesetzt; ohne Gegencheck bleibt der Preis zu prüfen
      priceConfidence: price ? Math.min(confidence, 0.85) : 0,
      warnings,
    };
  });
}

/**
 * Zweiter Durchgang: Preisschilder einzeln ausschneiden und erneut lesen.
 * Stimmen beide Lesungen überein, gilt der Preis als sicher (0.98), sonst < 0.9.
 */
export async function crossCheckPrices(offers: ExtractedOffer[], page: PreparedPage, reader: PageReader, workDir: string) {
  const withTag = offers.filter((o) => o.priceTagBbox);
  for (const o of offers) if (!o.priceTagBbox) o.warnings.push('Kein Preisschild gefunden – Preis bitte prüfen');
  if (!withTag.length) return;
  const jobs = withTag.map((o) => ({ image: page.file, box: o.priceTagBbox, out: join(workDir, 'tags', `${o.id}.png`) }));
  await runPython('crops.py', [], jobs);
  const second = await reader.readPrices(
    jobs.map((j) => j.out),
    page.file,
  );
  withTag.forEach((o, i) => {
    const again = normalizePrice(second[i]);
    if (o.price && again === o.price) {
      o.priceConfidence = 0.98;
    } else {
      o.priceConfidence = Math.min(o.priceConfidence, 0.5);
      o.warnings.push(`Preis unsicher: erste Lesung ${o.price ?? '–'}, Gegencheck ${again ?? 'unlesbar'}`);
      if (!o.price && again) o.price = again;
    }
  });
}

/** Häufigsten Wert nehmen (bei Gleichstand den ersten). */
function majority<T>(values: (T | null | undefined)[]): T | null {
  const counts = new Map<string, { v: T; n: number }>();
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const k = JSON.stringify(v);
    const e = counts.get(k) ?? { v, n: 0 };
    e.n++;
    counts.set(k, e);
  }
  let best: { v: T; n: number } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best?.v ?? null;
}

function normAddress(a: string) {
  return a.replace(/\s+/g, ' ').replace(/(\S)\s+(\d{5})\b/, '$1, $2').replace(/,\s*,/g, ',').trim();
}

export interface ExtractOptions {
  jobDir: string;
  reader: PageReader;
  log?: (m: string) => void;
  /** Gegencheck der Preise (Standard: an). Aus: später nur für die Auswahl mit `checkPrices` – spart Zeit und Geld. */
  priceCheck?: boolean;
  /** So viele Seiten gleichzeitig lesen (Standard 4) – die KI braucht pro Seite einige Sekunden. */
  parallel?: number;
}

/**
 * Preis-Gegencheck nur für bestimmte Angebote, gebündelt pro Seite (ein KI-Aufruf je Seite).
 * Bei 180 erkannten Angeboten, von denen 8 ins Video kommen, prüft das ~12 statt 180 Preisschilder.
 */
export async function checkPrices(offers: ExtractedOffer[], pages: { file: string }[], reader: PageReader, workDir: string): Promise<string[]> {
  const warnings: string[] = [];
  const byPage = new Map<number, ExtractedOffer[]>();
  for (const o of offers) byPage.set(o.page, [...(byPage.get(o.page) ?? []), o]);
  await Promise.all(
    [...byPage].map(async ([no, list]) => {
      const page = pages[no - 1];
      if (!page) return;
      try {
        await crossCheckPrices(list, page as PreparedPage, reader, workDir);
      } catch (e) {
        warnings.push(`Seite ${no}: Preis-Gegencheck fehlgeschlagen (${(e as Error).message}) – Preise bitte prüfen`);
      }
    }),
  );
  return warnings;
}

export async function extractJob(opts: ExtractOptions): Promise<Extraction> {
  const log = opts.log ?? (() => {});
  const workDir = join(opts.jobDir, 'work');
  const warnings: string[] = [];
  const inputs = await listInputs(join(opts.jobDir, 'input'));
  if (!inputs.length) throw new Error(`Keine Prospektseiten in ${join(opts.jobDir, 'input')} (erlaubt: PNG, JPG, WEBP, PDF)`);
  const pages = await preparePages(inputs, join(workDir, 'pages'));
  log(`${pages.length} Seite(n) vorbereitet`);

  // Mehrere Seiten gleichzeitig lesen; Ergebnisse bleiben in Seitenreihenfolge.
  const raws: (PageResult | null)[] = new Array(pages.length).fill(null);
  const perPage: ExtractedOffer[][] = pages.map(() => []);
  const pageWarnings: string[][] = pages.map(() => []);
  let next = 0;
  const worker = async () => {
    while (next < pages.length) {
      const i = next++;
      const page = pages[i];
      const no = i + 1;
      try {
        log(`Seite ${no}: lese mit ${opts.reader.name} …`);
        const raw = await opts.reader.readPage(page.file, page);
        raws[i] = raw;
        const found = normalizePage(raw, page, no, opts.jobDir);
        if (opts.priceCheck !== false) {
          try {
            await crossCheckPrices(found, page, opts.reader, workDir);
          } catch (e) {
            pageWarnings[i].push(`Seite ${no}: Preis-Gegencheck fehlgeschlagen (${(e as Error).message}) – Preise bitte prüfen`);
          }
        }
        perPage[i] = found;
        log(`Seite ${no}: ${found.length} Angebot(e)`);
      } catch (e) {
        pageWarnings[i].push(`Seite ${no} (${page.source}): ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.parallel ?? 4, pages.length)) }, worker));
  const offers = perPage.flat();
  warnings.push(...pageWarnings.flat());
  const pageInfo: Extraction['pages'] = pages.map((page, i) => ({ file: page.file, source: page.source, width: page.width, height: page.height, offers: perPage[i].length }));

  // Doppelte Angebote (gleiche Marke, Name, Preis) zusammenfassen
  const seen = new Map<string, ExtractedOffer>();
  const unique: ExtractedOffer[] = [];
  for (const o of offers) {
    const k = offerKey(o);
    const prev = seen.get(k);
    if (prev) {
      warnings.push(`Doppelt: ${o.id} entspricht ${prev.id} (${o.brand ?? ''} ${o.name.de}) – nur einmal übernommen`);
      continue;
    }
    seen.set(k, o);
    unique.push(o);
  }

  const ok = raws.filter((r): r is PageResult => !!r);
  const validTo = majority(ok.map((r) => normalizeDate(r.validTo)));
  const year = validTo ? Number(validTo.slice(0, 4)) : undefined;
  const validFrom = majority(ok.map((r) => normalizeDate(r.validFrom, year)));
  if (!validFrom || !validTo) warnings.push('Gültigkeitszeitraum nicht gefunden – bitte von Hand eintragen');
  else if (validFrom > validTo) warnings.push(`Gültigkeitszeitraum unplausibel: ${validFrom} bis ${validTo}`);

  const addresses = [...new Map(ok.flatMap((r) => r.addresses).map((a) => [normAddress(a).toLowerCase(), normAddress(a)])).values()];
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    model: opts.reader.name,
    market: majority(ok.map((r) => r.market?.trim())),
    validFrom,
    validTo,
    addresses,
    phone: majority(ok.map((r) => r.phone?.trim())),
    pages: pageInfo,
    offers: unique,
    warnings,
  };
}
