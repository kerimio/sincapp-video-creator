import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { pythonBin, runPython } from '../src/python';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_LABEL, parseSize, unitPrice } from '../src/core/catalog';
import { Library } from '../src/library/library';
import { enrichFromJobs } from '../src/library/catalog-api';

const png = () => {
  const f = join(mkdtempSync(join(tmpdir(), 'cat-src-')), 'x.png');
  writeFileSync(f, 'png');
  return f;
};

describe('Mengenangaben', () => {
  it('versteht Gewicht, Volumen, Stück und Mehrfachpackungen', () => {
    expect(parseSize('1 kg')).toMatchObject({ base: 'g', total: 1000, label: '1 kg' });
    expect(parseSize('800g')).toMatchObject({ base: 'g', total: 800, label: '800 g' });
    expect(parseSize('5×140 g')).toMatchObject({ count: 5, each: 140, total: 700, label: '700 g (5 × 140 g)' });
    expect(parseSize('4 x 1,5 l')).toMatchObject({ base: 'ml', total: 6000, label: '6 l (4 × 1,5 l)' });
    expect(parseSize('6 Stück')).toMatchObject({ base: 'stk', total: 6 });
    expect(parseSize('je Packung')).toBeNull();
    expect(parseSize(null)).toBeNull();
  });

  it('rechnet den Grundpreis wie im Laden', () => {
    expect(unitPrice('2,99', parseSize('800 g'))).toBe('3,74 €/kg');
    expect(unitPrice('0.99', parseSize('330 ml'))).toBe('3,00 €/l');
    expect(unitPrice('3.00', parseSize('6 Stück'))).toBe('0,50 €/Stück');
    expect(unitPrice('3.00', parseSize('1 Stück'))).toBeNull();
    expect(unitPrice(null, parseSize('1 kg'))).toBeNull();
  });

  it('jede Warengruppe hat einen deutschen und türkischen Namen', () => {
    for (const c of CATEGORIES) expect(CATEGORY_LABEL[c].de && CATEGORY_LABEL[c].tr).toBeTruthy();
  });
});

describe('Katalog-Einträge', () => {
  it('Bearbeiten behält den alten Namen als Alias, EAN nur Ziffern', async () => {
    const lib = await Library.open(mkdtempSync(join(tmpdir(), 'cat-')));
    const e = await lib.put({ brand: 'Tat', name: { de: 'Kichererbsen' }, unit: '1 kg', category: 'grundnahrung' }, png(), { type: 'web' }, false);
    lib.update(e, { brand: 'Tat', name: { de: 'Kichererbsen extra', tr: 'Nohut' }, variant: { de: 'getrocknet', tr: 'kuru' }, ean: '869 0000 123', verified: true });
    expect(e.ean).toBe('8690000123');
    expect(e.variant).toEqual({ de: 'getrocknet', tr: 'kuru' });
    expect(lib.find({ brand: 'Tat', name: { de: 'Kichererbsen' }, unit: '1 kg' })).toBe(e);
    expect(lib.find({ brand: 'Tat', name: { de: 'Nohut' } })).toBe(e);
    // erneutes Speichern aus einem Prospekt überschreibt Handeingaben nicht
    await lib.put({ brand: 'Tat', name: { de: 'Kichererbsen extra' }, unit: '1 kg', category: 'konserven', note: null }, png(), { type: 'web' }, true);
    expect(e.category).toBe('grundnahrung');
    expect(e.variant).toEqual({ de: 'getrocknet', tr: 'kuru' });
  });

  it('merkt Prospekt-Vorkommen einmal pro Job, neueste zuerst', async () => {
    const lib = await Library.open(mkdtempSync(join(tmpdir(), 'cat-')));
    const e = await lib.put({ brand: 'Durra', name: { de: 'Tahin' }, unit: '800 g' }, png(), { type: 'web' }, true);
    lib.sighted(e, { market: 'Saray', price: '4.99', from: '2026-10-01', to: '2026-10-07', job: 'a' });
    lib.sighted(e, { market: 'Saray', price: '3.99', from: '2026-10-28', to: '2026-11-03', job: 'b' });
    lib.sighted(e, { market: 'Saray', price: '3.79', from: '2026-10-28', to: '2026-11-03', job: 'b' });
    expect(e.seen?.map((s) => s.price)).toEqual(['3.79', '4.99']);
  });
});

describe('Bildquelle im Katalog', () => {
  it('eigenes Bild vor Internet vor Prospekt', async () => {
    const lib = await Library.open(mkdtempSync(join(tmpdir(), 'cat-')));
    const q = { brand: 'Tat', name: { de: 'Ketchup' }, unit: '600 g' };
    const e = await lib.put(q, png(), { type: 'prospekt' }, false);
    e.webTried = '2026-10-01';
    await lib.put(q, png(), { type: 'web', url: 'https://x/k.png' }, true);
    expect(e.source.type).toBe('web');
    expect(e.webTried).toBeUndefined();
    await lib.put(q, png(), { type: 'prospekt' }, false);
    expect(e.source.type).toBe('web');
    await lib.put(q, png(), { type: 'manual' }, true);
    await lib.put(q, png(), { type: 'web' }, true);
    expect(e.source.type).toBe('manual');
    expect(lib.entries).toHaveLength(1);
  });
});

describe('Katalog aus bisherigen Jobs', () => {
  it('ergänzt Warengruppe, Sorte und Preise ohne KI', async () => {
    const lib = await Library.open(mkdtempSync(join(tmpdir(), 'cat-')));
    const e = await lib.put({ brand: 'Egetürk', name: { de: 'Sırma Knoblauchwurst', tr: 'Sırma Parmak Sucuk' }, unit: '1 kg' }, png(), { type: 'web' }, true);
    const jobs = mkdtempSync(join(tmpdir(), 'cat-jobs-'));
    const job = join(jobs, '2026-10-28-saray');
    mkdirSync(job);
    const offer = { brand: 'Egetürk', name: { de: 'Sırma Knoblauchwurst', tr: 'Sırma Parmak Sucuk' }, unit: '1 kg', price: '13.99', category: 'wurst', note: { de: 'scharf', tr: 'acılı' } };
    writeFileSync(join(job, 'extraction.json'), JSON.stringify({ market: 'Saray Market', validFrom: '2026-10-28', validTo: '2026-11-07', offers: [offer] }));
    writeFileSync(join(job, 'story.json'), JSON.stringify({ market: { name: 'Saray Market' }, dates: { from: '2026-10-28', to: '2026-11-07' } }));

    expect(await enrichFromJobs(lib, jobs)).toBe(true);
    expect(e.category).toBe('wurst');
    expect(e.variant).toEqual({ de: 'scharf', tr: 'acılı' });
    expect(e.seen).toEqual([{ market: 'Saray Market', price: '13.99', from: '2026-10-28', to: '2026-11-07', job: '2026-10-28-saray' }]);
    // zweiter Lauf ändert nichts
    expect(await enrichFromJobs(lib, jobs)).toBe(false);
  });
});

describe.skipIf(!existsSync(pythonBin()))('Doppelte Packungen', () => {
  it('schneidet aus zwei gleichen Packungen genau eine aus', async () => {
    // Packung 120×160 mit Muster, zweimal versetzt (hintere links oben, vordere rechts unten)
    const W = 300, H = 200, pw = 120, ph = 160;
    const pack = (x: number, y: number) => {
      const v = ((x >> 3) * 73856093) ^ ((y >> 3) * 19349663);
      return [(v & 255), ((v >> 8) & 255), ((v >> 16) & 255)];
    };
    const p = new PNG({ width: W, height: H });
    for (const [ox, oy] of [[20, 10], [150, 30]])
      for (let y = 0; y < ph; y++)
        for (let x = 0; x < pw; x++) {
          const i = ((y + oy) * W + x + ox) * 4;
          const [r, g, b] = pack(x, y);
          p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
        }
    const dir = mkdtempSync(join(tmpdir(), 'single-'));
    writeFileSync(join(dir, 'in.png'), PNG.sync.write(p));
    const [line] = await runPython('single.py', [], [{ image: join(dir, 'in.png'), out: join(dir, 'out.png') }]);
    const r = JSON.parse(line);
    expect(r).toMatchObject({ ok: true, copies: 2 });
    expect(r.width).toBeGreaterThan(pw - 12);
    expect(r.width).toBeLessThan(pw + 12);
  }, 120000);
});
