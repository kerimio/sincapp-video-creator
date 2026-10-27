import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Market, parseStory } from '../src/core/schema';

const ref = JSON.parse(readFileSync(new URL('./fixtures/reference-job/story.json', import.meta.url), 'utf8'));

describe('story.json', () => {
  it('Referenz-Story ist gültig und bekommt Standardwerte', () => {
    const s = parseStory(ref);
    expect(s.scenes).toEqual({ intro: 3.6, page: 4.5, cta: 6 });
    expect(s.offers[0].imgZoom).toBe(1.05);
    const noZoom = structuredClone(ref);
    delete noZoom.offers[3].imgZoom;
    expect(parseStory(noZoom).offers[3].imgZoom).toBe(1);
  });

  it('lehnt Preise im falschen Format ab', () => {
    const bad = structuredClone(ref);
    bad.offers[0].price = '10.99';
    expect(() => parseStory(bad)).toThrow(/13,99/);
  });

  it('lehnt mehr als 2 Namenszeilen ab', () => {
    const bad = structuredClone(ref);
    bad.offers[0].name.de = ['a', 'b', 'c'];
    expect(() => parseStory(bad)).toThrow();
  });

  it('prüft, dass die Seitenaufteilung zur Anzahl passt', () => {
    expect(() => parseStory({ ...ref, pages: [3, 3] })).toThrow(/Seiten/);
    expect(parseStory({ ...ref, pages: [2, 3] }).pages).toEqual([2, 3]);
  });

  it('lehnt vertauschte Daten ab', () => {
    expect(() => parseStory({ ...ref, dates: { from: '2026-11-07', to: '2026-10-28' } })).toThrow(/Startdatum/);
  });
});

describe('markets/*.json', () => {
  it('saray.json ist gültig', () => {
    const m = JSON.parse(readFileSync(new URL('../markets/saray.json', import.meta.url), 'utf8'));
    expect(Market.parse(m).slug).toBe('saray');
  });
  it('max. 3 Adressen', () => {
    expect(() => Market.parse({ name: 'X', slug: 'x', logo: 'x.png', instagram: 'x', addresses: ['a', 'b', 'c', 'd'] })).toThrow();
  });
});
