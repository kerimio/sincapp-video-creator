import { describe, expect, it } from 'vitest';
import { findProductImages, scoreCandidate } from '../src/images/openfoodfacts';

const products = [
  { code: '1', product_name: 'Sucuk', brands: 'Egetürk', image_front_url: 'https://img/1.jpg' },
  { code: '2', product_name: 'Sırma Parmak Sucuk', brands: 'Egetürk', image_front_url: 'https://img/2.jpg' },
  { code: '3', product_name: 'Sucuk', brands: 'Andere Marke', image_front_url: 'https://img/3.jpg' },
  { code: '4', product_name: 'Sırma Sucuk', brands: 'Egeturk' }, // ohne Bild
];

function mockFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('Open Food Facts', () => {
  it('bewertet Marke doppelt, ignoriert Akzente', () => {
    expect(scoreCandidate(products[1], 'Egetürk', ['Sırma Knoblauchwurst', 'Sırma Parmak Sucuk'])).toBe(5);
    expect(scoreCandidate(products[2], 'Egetürk', ['Sucuk'])).toBe(1);
  });

  it('liefert die besten Treffer mit Bild', async () => {
    const { f, calls } = mockFetch({ products });
    const r = await findProductImages({ brand: 'Egetürk', names: ['Sırma Knoblauchwurst', 'Sırma Parmak Sucuk'] }, { fetchImpl: f });
    expect(calls[0]).toContain('search_terms=Eget%C3%BCrk+S%C4%B1rma+Knoblauchwurst');
    expect(r.map((c) => c.url)).toEqual(['https://img/2.jpg', 'https://img/1.jpg']);
    expect(r[0].title).toBe('Egetürk – Sırma Parmak Sucuk');
  });

  it('wirft bei HTTP-Fehlern (der Aufrufer macht daraus eine Warnung)', async () => {
    const { f } = mockFetch({}, 403);
    await expect(findProductImages({ brand: null, names: ['x'] }, { fetchImpl: f })).rejects.toThrow(/403/);
  });
});
