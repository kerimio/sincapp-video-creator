import { describe, expect, it } from 'vitest';
import { normalizeDate, normalizePrice, normalizeUnit, offerKey, wrapLines } from '../src/extract/normalize';

describe('normalizePrice', () => {
  it.each([
    ['13.99', '13,99'],
    ['13,99 €', '13,99'],
    ['13.⁹⁹', '13,99'],
    ['1 69', '1,69'],
    ['0.65€', '0,65'],
    ['2.–', '2,00'],
    ['5', '5,00'],
    ['014.99', '14,99'],
  ])('%s → %s', (raw, out) => expect(normalizePrice(raw)).toBe(out));
  it('gibt null bei Unsinn', () => {
    expect(normalizePrice('ab 3')).toBeNull();
    expect(normalizePrice('')).toBeNull();
    expect(normalizePrice('13.9')).toBeNull();
  });
});

describe('normalizeUnit', () => {
  it.each([
    ['5X140 g', '5×140 g'],
    ['18x18 g', '18×18 g'],
    ['1kg', '1 kg'],
    ['950ML', '950 ml'],
    ['1,5 L', '1,5 l'],
    ['1.5l', '1,5 l'],
    ['10 Stück', '10 Stück'],
  ])('%s → %s', (raw, out) => expect(normalizeUnit(raw)).toBe(out));
  it('leer → null', () => expect(normalizeUnit('  ')).toBeNull());
});

describe('normalizeDate', () => {
  it('liest ISO und deutsche Daten', () => {
    expect(normalizeDate('2026-10-28')).toBe('2026-10-28');
    expect(normalizeDate('28.10.2026')).toBe('2026-10-28');
    expect(normalizeDate('7.11.26')).toBe('2026-11-07');
    expect(normalizeDate('28.10.', 2026)).toBe('2026-10-28');
  });
  it('lehnt ungültige Daten ab', () => {
    expect(normalizeDate('2026-02-30')).toBeNull();
    expect(normalizeDate('28.10.')).toBeNull();
  });
});

describe('wrapLines', () => {
  it('kurz bleibt eine Zeile', () => expect(wrapLines('Tahin', 14)).toEqual({ lines: ['Tahin'], truncated: false }));
  it('bricht ausgewogen um', () => {
    expect(wrapLines('Sırma Parmak Sucuk', 14).lines).toEqual(['Sırma', 'Parmak Sucuk']);
    expect(wrapLines('Saklıköy Sütlü Bisküvi', 14).lines).toEqual(['Saklıköy', 'Sütlü Bisküvi']);
  });
  it('bricht nach Bindestrich und behält ihn', () => {
    expect(wrapLines('Yakut Ceylon-Schwarztee', 16, 2, false).lines).toEqual(['Yakut Ceylon-', 'Schwarztee']);
  });
  it('kürzt mit … und meldet es', () => {
    const r = wrapLines('Çok uzun bir ürün adı burada yazıyor', 14);
    expect(r.truncated).toBe(true);
    expect(r.lines).toHaveLength(2);
    expect(r.lines.every((l) => l.length <= 14)).toBe(true);
    expect(r.lines[1].endsWith('…')).toBe(true);
  });
  it('kürzt zu lange Einzelwörter', () => {
    const r = wrapLines('Süpermarketçilik', 14);
    expect(r.truncated).toBe(true);
    expect(r.lines[0].length).toBeLessThanOrEqual(14);
  });
  it('ohne Kürzen: DE darf länger werden', () => {
    const r = wrapLines('Saklıköy Doppelkekse mit Milchfüllung', 16, 2, false);
    expect(r.truncated).toBe(false);
    expect(r.lines).toHaveLength(2);
  });
});

describe('offerKey', () => {
  it('ignoriert Groß/Kleinschreibung und Satzzeichen', () => {
    expect(offerKey({ brand: 'Egetürk', name: { de: 'Sırma Knoblauchwurst' }, price: '13,99' })).toBe(
      offerKey({ brand: 'EGETÜRK', name: { de: 'Sırma  Knoblauch-wurst' }, price: '13,99' }),
    );
  });
});
