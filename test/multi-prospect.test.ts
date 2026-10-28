import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pagesToRead } from '../src/firestore/firestore';
import { applyFirestoreDates, firestoreProductNames } from '../src/app/pipeline';
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
