import { describe, expect, it } from 'vitest';
import { defaultEyebrow, formatDateRange, turkishLocative } from '../src/core/format';

describe('formatDateRange', () => {
  it('formatiert wie die Referenz', () => {
    expect(formatDateRange('2026-10-28', '2026-11-07')).toBe('28.10. – 07.11.2026');
  });
  it('zeigt das Jahr links, wenn es wechselt', () => {
    expect(formatDateRange('2026-12-29', '2027-01-04')).toBe('29.12.2026 – 04.01.2027');
  });
});

describe('turkishLocative', () => {
  it.each([
    ['Saray Market', 'Saray Market’te'],
    ['Bizim', 'Bizim’de'],
    ['Akdeniz Market', 'Akdeniz Market’te'],
    ['Anadolu', 'Anadolu’da'],
    ['Ulaş', 'Ulaş’ta'],
  ])('%s → %s', (name, out) => expect(turkishLocative(name)).toBe(out));

  it('Eyebrow wie in der Referenz', () => {
    expect(defaultEyebrow('Saray Market')).toEqual({ de: 'Jetzt bei Saray Market', tr: 'Şimdi Saray Market’te' });
  });
});

import { joinName } from '../src/template/Story';
describe('joinName', () => {
  it.each([
    [['Rinder-', 'mett'], 'Rindermett'],
    [['Ceylon-', 'Schwarztee'], 'Ceylon-Schwarztee'],
    [['Rindfleisch-', 'Salami Extra'], 'Rindfleisch-Salami Extra'],
    [['Dana', 'kıyma'], 'Dana kıyma'],
    [['Tahin'], 'Tahin'],
  ])('%j → %s', (lines, out) => expect(joinName(lines)).toBe(out));
});
