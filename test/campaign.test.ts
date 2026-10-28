import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCampaign, prepareCampaign } from '../src/app/campaign';
import { badgeText } from '../src/core/badges';
import { caption } from '../src/core/captions';
import { bestPriceWeeks } from '../src/core/catalog';
import { parseStory } from '../src/core/schema';
import { Library } from '../src/library/library';

const png = () => {
  const f = join(mkdtempSync(join(tmpdir(), 'camp-src-')), 'x.png');
  writeFileSync(f, 'png');
  return f;
};

describe('Bester Preis seit X Wochen', () => {
  const seen = [
    { market: 'Saray', price: '3.49', from: '2026-08-20', to: '2026-08-26', job: 'a' },
    { market: 'Saray', price: '2.99', from: '2026-09-24', to: '2026-09-30', job: 'b' },
    { market: 'Saray', price: '2.49', from: '2026-10-29', to: '2026-11-04', job: 'jetzt' },
  ];
  it('zählt Wochen bis zum ältesten früheren Preis', () => {
    expect(bestPriceWeeks('2,49', seen, '2026-10-29', 'jetzt')).toBe(10);
    expect(bestPriceWeeks('2,99', seen, '2026-10-29', 'jetzt')).toBe(10);
  });
  it('kein Sticker, wenn es früher günstiger war oder der Verlauf zu kurz ist', () => {
    expect(bestPriceWeeks('3,19', seen, '2026-10-29', 'jetzt')).toBeNull();
    expect(bestPriceWeeks('1,99', seen.slice(1), '2026-10-08')).toBeNull();
    expect(bestPriceWeeks('1,99', [], '2026-10-29')).toBeNull();
  });
  it('Texte für Sticker und Bildtext', () => {
    expect(badgeText({ badge: 'bestpreis', bestWeeks: 8 }, 'de')).toBe('Bester Preis seit 8 Wochen');
    expect(badgeText({ badge: 'bestpreis', bestWeeks: 8 }, 'tr')).toBe('Son 8 haftanın en iyi fiyatı');
    expect(badgeText({ badge: 'bestpreis' }, 'de')).toBe('Bestpreis');
    const story = parseStory(JSON.parse(readFileSync(join(__dirname, 'fixtures/reference-job/story.json'), 'utf8')));
    story.offers[0].badge = 'bestpreis';
    story.offers[0].bestWeeks = 8;
    expect(caption(story, 'de')).toContain('· Bester Preis seit 8 Wochen');
  });
});

describe('Kampagne aus dem Katalog', () => {
  const env = { lib: process.env.SINCAPP_LIBRARY, jobs: process.env.SINCAPP_JOBS };
  afterEach(() => {
    process.env.SINCAPP_LIBRARY = env.lib;
    process.env.SINCAPP_JOBS = env.jobs;
    if (env.lib === undefined) delete process.env.SINCAPP_LIBRARY;
    if (env.jobs === undefined) delete process.env.SINCAPP_JOBS;
  });

  it('prüft die Eingaben', () => {
    expect(() => checkCampaign({ items: [{ img: 'a', price: '1,99' }], from: '2026-10-29', to: '2026-11-04' })).toThrow(/mindestens 2/);
    expect(() => checkCampaign({ items: [{ img: 'a', price: '1,99' }, { img: 'b', price: 'x' }], from: '2026-10-29', to: '2026-11-04' })).toThrow(/Preis/);
    expect(() => checkCampaign({ items: [{ img: 'a', price: '1,99' }, { img: 'b', price: '2' }], from: '2026-11-05', to: '2026-11-04' })).toThrow(/Zeitraum/);
  });

  it('baut ohne Prospekt und ohne KI eine Story mit Katalog-Bildern und Bestpreis', async () => {
    process.env.SINCAPP_LIBRARY = mkdtempSync(join(tmpdir(), 'camp-lib-'));
    process.env.SINCAPP_JOBS = mkdtempSync(join(tmpdir(), 'camp-jobs-'));
    const lib = await Library.open();
    const tee = await lib.put({ brand: 'Tanay', name: { de: 'Yakut Ceylon-Schwarztee', tr: 'Yakut Yaprak Çayı' }, unit: '800 g', category: 'getraenke' }, png(), { type: 'web' }, true);
    lib.sighted(tee, { market: 'Saray Market', price: '4.99', from: '2026-08-01', to: '2026-08-07', job: 'alt' });
    const tahin = await lib.put({ brand: 'Durra', name: { de: 'Tahin', tr: 'Tahin' }, unit: '800 g', category: 'konserven', note: { de: 'geröstet', tr: 'kavrulmuş' } }, png(), { type: 'manual' }, true);
    await lib.save();

    const dir = join(process.env.SINCAPP_JOBS, '2026-10-28-saray');
    mkdirSync(dir);
    const { story } = await prepareCampaign(dir, 'saray', { items: [{ img: tee.img, price: '3,99' }, { img: tahin.img, price: '2.5' }], from: '2026-10-29', to: '2026-11-04' });
    expect(story.market.name).toBe('Saray Market');
    expect(story.dates).toEqual({ from: '2026-10-29', to: '2026-11-04' });
    expect(story.offers.map((o) => [o.img, o.price])).toEqual([['images/k1.png', '3,99'], ['images/k2.png', '2,50']]);
    expect(story.offers[0]).toMatchObject({ badge: 'bestpreis', bestWeeks: 12, name: { tr: ['Tanay Yakut', 'Yaprak Çayı'] } });
    expect(story.offers[1].badge).toBeUndefined();
    expect(story.offers[1].note).toEqual({ de: 'geröstet', tr: 'kavrulmuş' });
    expect(readFileSync(join(dir, 'images/k1.png'), 'utf8')).toBe('png');
  });
});
