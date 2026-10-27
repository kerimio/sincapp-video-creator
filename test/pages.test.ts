import { describe, expect, it } from 'vitest';
import { paginate, splitPages } from '../src/core/pages';

describe('splitPages', () => {
  it.each([
    [2, [2]], [3, [3]], [4, [2, 2]], [5, [3, 2]], [6, [3, 3]],
    [7, [3, 2, 2]], [8, [3, 3, 2]], [9, [3, 3, 3]], [10, [3, 3, 2, 2]],
  ])('%i Angebote → %j', (n, pages) => {
    expect(splitPages(n)).toEqual(pages);
  });

  it('erzeugt nie eine Seite mit 1 Angebot', () => {
    for (let n = 2; n <= 30; n++) {
      const p = splitPages(n);
      expect(p.every((c) => c === 2 || c === 3)).toBe(true);
      expect(p.reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it('lehnt weniger als 2 Angebote ab', () => {
    expect(() => splitPages(1)).toThrow();
    expect(() => splitPages(0)).toThrow();
  });
});

describe('paginate', () => {
  it('gruppiert in Reihenfolge', () => {
    expect(paginate([1, 2, 3, 4, 5])).toEqual([[1, 2, 3], [4, 5]]);
  });
  it('nimmt eine vorgegebene Aufteilung', () => {
    expect(paginate([1, 2, 3, 4, 5], [2, 3])).toEqual([[1, 2], [3, 4, 5]]);
  });
});
