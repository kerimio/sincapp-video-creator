import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizePage } from '../src/extract/extract';
import { PageResult, type Extraction } from '../src/extract/schema';
import { buildStory, findTopic, selectOffers } from '../src/select/select';

const ROOT = join(__dirname, '..');
const offers = [1, 2, 3, 4, 5, 6].flatMap((n) => {
  const raw = PageResult.parse(JSON.parse(readFileSync(join(ROOT, `test/fixtures/saray-extraction/seite-${n}.json`), 'utf8')));
  const o = normalizePage(raw, { source: '', page: 1, file: `/job/work/pages/seite-${n}.png`, width: 1200, height: 1500 }, n, '/job');
  o.forEach((x) => (x.priceConfidence = 0.98));
  return o;
});
const ex: Extraction = { version: 1, createdAt: '', model: 'test', market: 'Saray Market', validFrom: '2026-10-28', validTo: '2026-11-07', addresses: ['Lange Laube 3, 30159 Hannover'], phone: null, pages: [], offers, warnings: [] };
const market = JSON.parse(readFileSync(join(ROOT, 'markets/saray.json'), 'utf8'));

describe('Auswahl', () => {
  it('Standard: 8 Angebote, Fleisch und Wurst zuerst, danach gemischt', () => {
    const { offers: picked } = selectOffers(offers);
    expect(picked).toHaveLength(8);
    expect(new Set(picked.map((o) => o.id)).size).toBe(8);
    // alle 3 Wurst-Angebote vorn, auch wenn andere Gruppen dafür wegfallen
    expect(picked.slice(0, 3).map((o) => o.category)).toEqual(['wurst', 'wurst', 'wurst']);
    // der Rest reihum aus verschiedenen Gruppen
    expect(new Set(picked.slice(3).map((o) => o.category)).size).toBe(5);
  });

  it('Konzept: halb Fleisch, halb Preis-Knaller aus dem Grundbedarf – auch bei nur 2 Plätzen', () => {
    const { offers: picked } = selectOffers(offers, { count: 2 });
    expect(picked.map((o) => o.category)).toEqual(['wurst', 'grundnahrung']);
  });

  it('Thema filtert und ändert die Überschrift', () => {
    const t = findTopic('Snacks')!;
    const { offers: picked } = selectOffers(offers, { topic: t });
    expect(picked.every((o) => ['snacks', 'suesses'].includes(o.category))).toBe(true);
    expect(picked).toHaveLength(5);
    const { story } = buildStory(ex, market, picked, t);
    expect(story.headline.de).toEqual(['Snack-', 'angebote']);
    expect(story.headline.tr[0]).toBe('Atıştırmalık');
  });

  it('Thema mit zu wenig Angeboten ist ein klarer Fehler', () => {
    expect(() => selectOffers(offers, { topic: findTopic('milch') })).toThrow(/mindestens 2/);
    expect(() => findTopic('autos')).toThrow(/Unbekanntes Thema/);
  });

  it('unsichere Preise kommen nach hinten und werden gemeldet', () => {
    const copy = offers.map((o) => ({ ...o, priceConfidence: o.id === 's1-1' ? 0.5 : 0.98 }));
    const all = selectOffers(copy, { count: 18 });
    // Wurst bleibt vorn, aber das unsichere Angebot hinter den sicheren Wurst-Angeboten
    expect(all.offers.slice(0, 3).map((o) => o.id).sort()).toEqual(['s1-1', 's1-2', 's1-3']);
    expect(all.offers[2].id).toBe('s1-1');
    expect(all.warnings.join()).toMatch(/s1-1/);
  });

  it('Marke steht im Namen, wenn sie in 2 Zeilen passt', () => {
    const byId = (id: string) => offers.find((o) => o.id === id)!;
    expect(byId('s1-1').lines).toEqual({ de: ['Egetürk Sırma', 'Knoblauchwurst'], tr: ['Egetürk Sırma', 'Parmak Sucuk'] });
    // zu lang mit Marke → Name allein; mehrere Marken → keine
    expect(byId('s4-1').lines.de).toEqual(['Yakut Ceylon-', 'Schwarztee']);
    expect(byId('s1-3').lines.de).toEqual(['Salami']);
  });

  it('baut eine gültige story.json mit Daten, Eyebrow und Zeilen', () => {
    const { offers: picked } = selectOffers(offers, { count: 6 });
    const { story, warnings } = buildStory(ex, market, picked, null);
    expect(story.dates).toEqual({ from: '2026-10-28', to: '2026-11-07' });
    expect(story.eyebrow?.tr).toBe('Şimdi Saray Market’te');
    expect(story.offers[0].img).toMatch(/^images\/s\d-\d\.png$/);
    expect(story.offers.every((o) => o.name.tr.every((l) => l.length <= 14))).toBe(true);
    expect(warnings).toEqual([]);
  });
});
