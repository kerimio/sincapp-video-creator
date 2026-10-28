import { describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { checkPrices, extractJob } from '../src/extract/extract';
import { PageResult } from '../src/extract/schema';
import { pythonBin } from '../src/python';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pagesToRead } from '../src/firestore/firestore';
import { applyFirestoreDates, applyFirestoreMarkets, firestoreProductNames } from '../src/app/pipeline';
import { caption } from '../src/core/captions';
import { parseStory } from '../src/core/schema';
import { offerToStory, selectByMarket } from '../src/select/select';
import { pagesFor } from '../src/core/pages';
import { readFileSync } from 'node:fs';
import { offerBoosts, selectOffers } from '../src/select/select';
import { CachingReader } from '../src/ai/cache';
import type { ExtractedOffer } from '../src/extract/schema';

const urls = ['a', 'b', 'c', 'd'];

describe('Seiten ohne Produkte überspringen', () => {
  it('nur wenn alle Produkte Fundstellen haben', () => {
    const loc = (page: number) => ({ page, box: [0, 0, 10, 10] });
    expect(pagesToRead({ imageUrls: urls, products: [{ name_de: 'A', locations: [loc(2)] }, { name_de: 'B', locations: [loc(3)] }] })).toEqual([2, 3]);
    expect(pagesToRead({ imageUrls: urls, products: [{ name_de: 'A', locations: [loc(2)] }, { name_de: 'B' }] })).toEqual([1, 2, 3, 4]);
    expect(pagesToRead({ imageUrls: urls, products: [] })).toEqual([1, 2, 3, 4]);
  });
});

describe('Mehrere Prospekte', () => {
  it('Datum vom frühesten Start bis zum spätesten Ende, Namen aus allen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-'));
    writeFileSync(
      join(dir, 'firestore-prospekt.json'),
      JSON.stringify([
        { validFrom: '2026-10-28', validUntil: '2026-11-07', products: [{ name_de: 'Sucuk', locations: [{ page: 1, box: [], label: { de: 'Sırma Knoblauchwurst' } }] }] },
        { validFrom: '2026-10-26', validUntil: '2026-11-01', products: [{ name_de: 'Rinderhack' }] },
      ]),
    );
    const ex = { validFrom: null, validTo: '2026-11-30', warnings: ['Gültigkeitszeitraum nicht gefunden – bitte von Hand eintragen', 'anderes'] };
    applyFirestoreDates(ex, dir);
    expect(ex).toEqual({ validFrom: '2026-10-26', validTo: '2026-11-07', warnings: ['anderes'] });
    expect(firestoreProductNames(dir)).toEqual(['Sucuk', 'Sırma Knoblauchwurst', 'Rinderhack']);
  });
});

const offer = (id: string, name: string, bbox: number[], category = 'fleisch'): ExtractedOffer => ({
  id, page: 1, pageFile: 'p.png', brand: null, name: { de: name, tr: name }, lines: { de: [name], tr: [name] }, unit: null, price: '1,99',
  note: null, category: category as ExtractedOffer['category'], bbox: bbox as ExtractedOffer['bbox'], priceTagBbox: null, confidence: 0.9, priceConfidence: 0.98, warnings: [],
});

describe('Beste Angebote', () => {
  it('große und in Firestore gepflegte Angebote kommen zuerst', () => {
    const ex = {
      pages: [{ file: 'p.png', source: 'p.png', width: 1000, height: 1000, offers: 3 }],
      offers: [offer('klein', 'Nudeln', [0, 0, 100, 100]), offer('gross', 'Lammkeule', [0, 0, 500, 500]), offer('gepflegt', 'Sırma Sucuk', [0, 0, 100, 100])],
    };
    const boost = offerBoosts(ex, ['sirma sucuk']);
    expect(boost.get('gross')).toBeGreaterThan(boost.get('klein')!);
    expect(boost.get('gepflegt')).toBeGreaterThan(boost.get('klein')!);
    const sel = selectOffers(ex.offers, { count: 2, boost });
    expect(sel.offers.map((o) => o.id).sort()).toEqual(['gepflegt', 'gross']);
  });
});

describe('KI-Antworten merken', () => {
  it('liest dieselbe Seite nur einmal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ki-'));
    const page = join(dir, 'seite.png');
    writeFileSync(page, 'bild');
    let calls = 0;
    const inner = {
      name: 'fake',
      async readPage() {
        calls++;
        return { market: 'X', validFrom: null, validTo: null, addresses: [], phone: null, offers: [] };
      },
      async readPrices(c: string[]) {
        calls++;
        return c.map(() => '1.99');
      },
    };
    const r = new CachingReader(inner, join(dir, 'cache'));
    await r.readPage(page, { width: 10, height: 10 });
    await r.readPage(page, { width: 10, height: 10 });
    await r.readPrices([page], page);
    await r.readPrices([page], page);
    expect(calls).toBe(2);
    expect(r.hits).toBe(2);
  });
});

describe('Prospekte mehrerer Märkte', () => {
  it('jedes Angebot bekommt den Markt seines Prospekts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-'));
    writeFileSync(join(dir, 'firestore-prospekt.json'), JSON.stringify([{ marketName: 'Saray Market' }, { marketName: 'Yıldız Market' }]));
    const ex = { offers: [{ pageFile: 'work/pages/p1-seite-01.png' }, { pageFile: 'work/pages/p2-seite-03.png' }] as { pageFile: string; market?: string }[] };
    applyFirestoreMarkets(ex, dir);
    expect(ex.offers.map((o) => o.market)).toEqual(['Saray Market', 'Yıldız Market']);
    // ein Markt (auch mit mehreren Prospekten): kein Markt am Angebot
    writeFileSync(join(dir, 'firestore-prospekt.json'), JSON.stringify([{ marketName: 'Saray Market' }, { marketName: 'Saray Market' }]));
    const one = { offers: [{ pageFile: 'work/pages/p2-seite-01.png' }] as { pageFile: string; market?: string }[] };
    applyFirestoreMarkets(one, dir);
    expect(one.offers[0].market).toBeUndefined();
  });

  it('gleiches Produkt in zwei Märkten: nur das günstigste', () => {
    const a = { ...offer('a', 'Sucuk', [0, 0, 100, 100]), brand: 'Egetürk', price: '9,99', market: 'Saray Market' };
    const b = { ...offer('b', 'Sucuk', [0, 0, 100, 100]), brand: 'Egetürk', price: '8,49', market: 'Yıldız Market' };
    const c = { ...offer('c', 'Tahin', [0, 0, 100, 100], 'konserven'), market: 'Saray Market' };
    const sel = selectOffers([a, b, c], { count: 8 });
    expect(sel.offers.map((o) => o.id)).toEqual(['b', 'c']);
    expect(offerToStory(b).market).toBe('Yıldız Market');
  });

  it('Bildtext nennt den Markt je Angebot', () => {
    const story = parseStory(JSON.parse(readFileSync(join(__dirname, 'fixtures/reference-job/story.json'), 'utf8')));
    story.offers[0].market = 'Yıldız Market';
    expect(caption(story, 'de')).toContain('bei Yıldız Market');
    expect(caption(story, 'tr')).toContain('Yıldız Market’te');
    expect(caption(story, 'de')).toContain('#yildizmarket');
  });
});

describe.skipIf(!existsSync(pythonBin()))('Schneller lesen', () => {
  it('liest Seiten parallel in fester Reihenfolge und prüft Preise nur für die Vorauswahl', async () => {
    const job = mkdtempSync(join(tmpdir(), 'schnell-'));
    mkdirSync(join(job, 'input'));
    for (const n of [1, 2, 3, 4, 5, 6]) copyFileSync(join(__dirname, `../reference/samples/saray-2026-10-28/seite-${n}.png`), join(job, 'input', `seite-${n}.png`));
    let running = 0;
    let most = 0;
    const priceCalls: number[] = [];
    const reader = {
      name: 'fake',
      async readPage(file: string) {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 30));
        running--;
        const n = file.match(/seite-(\d)/)![1];
        return PageResult.parse(JSON.parse(readFileSync(join(__dirname, `fixtures/saray-extraction/seite-${n}.json`), 'utf8')));
      },
      async readPrices(crops: string[]) {
        priceCalls.push(crops.length);
        return crops.map(() => null);
      },
    };
    const ex = await extractJob({ jobDir: job, reader, priceCheck: false, parallel: 3 });
    expect(most).toBe(3);
    expect(ex.pages.map((p) => p.source.match(/seite-\d/)![0])).toEqual(['seite-1', 'seite-2', 'seite-3', 'seite-4', 'seite-5', 'seite-6']);
    expect(ex.offers[0].id).toBe('s1-1');
    expect(priceCalls).toEqual([]);
    // zwei Angebote auf zwei Seiten: zwei Aufrufe mit je einem Schild, der Rest bleibt ungeprüft
    const pick = [ex.offers.find((o) => o.page === 1 && o.priceTagBbox)!, ex.offers.find((o) => o.page === 3 && o.priceTagBbox)!];
    await checkPrices(pick, ex.pages, reader, join(job, 'work'));
    expect(priceCalls).toEqual([1, 1]);
  }, 120000);
});

describe('Eine Seite pro Markt', () => {
  const o = (id: string, market: string, cat = 'fleisch', size = 100) => ({ ...offer(id, `Produkt ${id}`, [0, 0, size, size], cat), market });

  it('jeder Markt bekommt seine besten Angebote, auch wenn ein anderer viel mehr hat', () => {
    const all = [o('a1', 'A'), o('a2', 'A'), o('a3', 'A'), o('a4', 'A'), o('a5', 'A'), o('b1', 'B', 'konserven'), o('b2', 'B', 'snacks'), o('c1', 'C')];
    const sel = selectByMarket(all, ['A', 'B', 'C']);
    expect(sel.offers.map((x) => x.market)).toEqual(['A', 'A', 'A', 'B', 'B']);
    expect(sel.warnings.join()).toMatch(/C: zu wenige/);
    // ab 6 Märkten je 2
    const many = ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((m) => [o(`${m}1`, m), o(`${m}2`, m), o(`${m}3`, m)]);
    expect(selectByMarket(many, ['A', 'B', 'C', 'D', 'E', 'F']).offers).toHaveLength(12);
  });

  it('Seiten folgen den Märkten', () => {
    const story = { offers: ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'C', 'C'].map((market) => ({ market, img: 'x.png', price: '1,99', name: { de: ['X'], tr: ['X'] }, imgZoom: 1 })) };
    expect(pagesFor(story).map((p) => p.map((x) => x.market).join(''))).toEqual(['AAA', 'BB', 'CC', 'CC']);
    expect(pagesFor(story, 'quadrat').map((p) => p.length)).toEqual([2, 1, 2, 2, 2]);
  });
});
