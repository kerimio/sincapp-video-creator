import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizePage } from '../src/extract/extract';
import { evaluate, type GroundTruth } from '../src/extract/evaluate';
import { PageResult, type Extraction } from '../src/extract/schema';

const FIX = join(__dirname, 'fixtures/saray-extraction');
const GT = JSON.parse(readFileSync(join(__dirname, '../reference/samples/saray-2026-10-28/ground-truth.json'), 'utf8')) as GroundTruth;

function fromFixtures(mutate?: (p: PageResult, n: number) => void): Extraction {
  const offers = [1, 2, 3, 4, 5, 6].flatMap((n) => {
    const raw = PageResult.parse(JSON.parse(readFileSync(join(FIX, `seite-${n}.json`), 'utf8')));
    mutate?.(raw, n);
    const o = normalizePage(raw, { source: '', page: 1, file: `/job/work/pages/seite-${n}.png`, width: 1200, height: 1500 }, n, '/job');
    o.forEach((x) => (x.priceConfidence = 0.98));
    return o;
  });
  return { version: 1, createdAt: '', model: 'test', market: 'Saray Market', validFrom: '2026-10-28', validTo: '2026-11-07', addresses: ['Lange Laube 3, 30159 Hannover'], phone: null, pages: [], offers, warnings: [] };
}

describe('Saray-Referenz (handannotierte Antworten)', () => {
  it('alle 18 Angebote, Preise im Format 13,99, TR ≤ 2 × 14', () => {
    const ex = fromFixtures();
    expect(ex.offers).toHaveLength(18);
    for (const o of ex.offers) {
      expect(o.price).toMatch(/^\d{1,4},\d{2}$/);
      expect(o.lines.tr.length).toBeLessThanOrEqual(2);
      for (const l of o.lines.tr) expect(l.length).toBeLessThanOrEqual(14);
      expect(o.bbox[2]).toBeGreaterThan(o.bbox[0]);
    }
    expect(ex.offers.find((o) => o.id === 's5-1')?.unit).toBe('5×140 g');
  });

  it('Abnahme besteht', () => {
    const ev = evaluate(fromFixtures(), GT);
    expect(ev.found).toBe(18);
    expect(ev.passed).toBe(true);
  });

  it('erkennt fehlende Angebote und falsche, unmarkierte Preise', () => {
    const ex = fromFixtures((p, n) => {
      if (n === 5) p.offers.splice(0, 2); // zwei Angebote verloren
      if (n === 2) p.offers[0].price = '7.59'; // falsch gelesen
    });
    const ev = evaluate(ex, GT);
    expect(ev.found).toBe(16);
    expect(ev.recall).toBeLessThan(0.95);
    expect(ev.wrongUnflagged).toHaveLength(1);
    expect(ev.passed).toBe(false);
  });

  it('falscher Preis mit Markierung zählt als markiert', () => {
    const ex = fromFixtures((p, n) => {
      if (n === 2) p.offers[0].price = '7.59';
    });
    ex.offers.find((o) => o.id === 's2-1')!.priceConfidence = 0.5;
    const ev = evaluate(ex, GT);
    expect(ev.wrongUnflagged).toHaveLength(0);
    expect(ev.wrongFlagged).toHaveLength(1);
    expect(ev.passed).toBe(true);
  });

  it('ungültige Boxen werden gemeldet statt abzubrechen', () => {
    const ex = fromFixtures((p, n) => {
      if (n === 4) p.offers[0].bbox = [10, 10, 12];
    });
    const o = ex.offers.find((x) => x.id === 's4-1')!;
    expect(o.warnings.join()).toMatch(/Bildausschnitt/);
  });
});
