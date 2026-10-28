import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStory, type Story } from '../src/core/schema';
import { Design, resolveDesign } from '../src/core/design';
import { countdownCopy, countdownDays, daysBetween, offerCaption, planDir, planOverview, qrTarget, weekPlan } from '../src/core/magic';
import { MAGIC_PACK, PACKS } from '../src/core/packs';

const base = parseStory(JSON.parse(readFileSync(join(__dirname, 'fixtures/reference-job/story.json'), 'utf8')));
const withDates = (from: string, to: string): Story => ({ ...base, dates: { from, to } });

describe('QR-Code', () => {
  it('ist ohne Einstellung aus (Referenz bleibt unverändert)', () => {
    expect(resolveDesign(undefined).qr).toBe('aus');
    expect(qrTarget(base, 'de')).toBeNull();
  });

  it('Route führt zu Google Maps mit Name und Adresse', () => {
    const t = qrTarget({ ...base, design: Design.parse({ qr: 'route' }) }, 'de')!;
    expect(t.label).toBe('Route zum Markt');
    expect(decodeURIComponent(t.url)).toContain('query=Saray Market, Lange Laube 3, 30159 Hannover');
    expect(qrTarget({ ...base, design: Design.parse({ qr: 'route' }) }, 'tr')!.label).toBe('Markete yol tarifi');
  });

  it('eigener Link nur mit gültiger URL', () => {
    expect(() => Design.parse({ qr: 'link', qrLink: 'kein link' })).toThrow();
    const t = qrTarget({ ...base, design: Design.parse({ qr: 'link', qrLink: 'https://saray.example/angebote' }) }, 'de');
    expect(t?.url).toBe('https://saray.example/angebote');
    expect(qrTarget({ ...base, design: Design.parse({ qr: 'link' }) }, 'de')).toBeNull();
  });
});

describe('Countdown', () => {
  it('Texte für heute, morgen und mehrere Tage', () => {
    expect(countdownCopy(0, 'de', '2026-10-31')).toMatchObject({ sub: 'Nur noch heute!', ring: 'HEUTE', unit: '', until: 'Nur bis Samstag' });
    expect(countdownCopy(1, 'de', '2026-10-31')).toMatchObject({ sub: 'Nur noch bis morgen!', ring: '1', unit: 'TAG' });
    expect(countdownCopy(2, 'tr', '2026-10-31')).toMatchObject({ sub: 'Son 2 gün!', ring: '2', unit: 'GÜN', until: 'Cumartesi gününe kadar' });
  });

  it('"noch 2 Tage" nur, wenn der Zeitraum lang genug ist', () => {
    expect(countdownDays(withDates('2026-10-28', '2026-10-30'))).toEqual([0]);
    expect(countdownDays(withDates('2026-10-27', '2026-11-01'))).toEqual([2, 0]);
  });
});

describe('7-Tage-Plan', () => {
  it('höchstens 7 Tage, Angebote der Reihe nach', () => {
    const plan = weekPlan(withDates('2026-10-26', '2026-11-07'));
    expect(plan).toHaveLength(7);
    expect(plan.map((d) => d.offer)).toEqual([0, 1, 2, 3, 4, 0, 1]);
    expect(plan[0]).toMatchObject({ n: 1, date: '2026-10-26' });
    expect(planDir(plan[0])).toBe('01-montag-26-10');
    // länger als 7 Tage: Ende mit "noch 2 Tage" und "heute"
    expect(plan.slice(4).map((d) => [d.date, d.countdown])).toEqual([['2026-10-30', null], ['2026-11-05', 2], ['2026-11-07', 0]]);
  });

  it('Countdown liegt auf den letzten Tagen', () => {
    const plan = weekPlan(withDates('2026-10-27', '2026-11-01'));
    expect(plan).toHaveLength(6);
    expect(plan.map((d) => d.countdown)).toEqual([null, null, null, 2, null, 0]);
    expect(weekPlan(withDates('2026-10-27', '2026-11-01'), false).every((d) => d.countdown === null)).toBe(true);
  });

  it('kurzer Zeitraum: so viele Tage wie gültig', () => {
    expect(weekPlan(base)).toHaveLength(daysBetween(base.dates.from, base.dates.to) + 1);
  });

  it('Text pro Angebot mit Preis, Countdown und Hashtags', () => {
    const de = offerCaption(base, 0, 'de', { countdown: 0 });
    expect(de).toContain(`für nur ${base.offers[0].price} €`);
    expect(de).toContain('\nNur noch heute!\n');
    expect(de.replace(/🐿/g, '')).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(de).toContain('#hannover');
    expect(de).toContain('#sincapp');
    const tr = offerCaption(base, 0, 'tr');
    expect(tr).toContain('sadece');
    expect(tr).toContain('Saray Market’te');
    expect(tr).not.toContain('Sadece bugün');
  });

  it('Übersicht nennt jeden Tag mit Ordner', () => {
    const plan = weekPlan(withDates('2026-10-27', '2026-11-01'));
    const text = planOverview(base, plan);
    expect(text).toContain('Dienstag, 27.10.');
    expect(text).toContain('[Ordner 06-sonntag-01-11]');
    expect(text).toContain('Countdown „Nur noch heute!“');
  });
});

describe('Pakete', () => {
  it('Zauberpaket enthält Plan, Countdown und Videos', () => {
    expect(MAGIC_PACK).toMatchObject({ plan: true, countdown: true, videos: ['story', 'feed'] });
    expect(new Set(PACKS.map((p) => p.key)).size).toBe(PACKS.length);
  });
});
