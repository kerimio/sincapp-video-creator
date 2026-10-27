import { describe, expect, it } from 'vitest';
import { BraveImages, providersFromEnv, searchAll, searchQuery, type ImageSearchProvider } from '../src/images/search';

describe('Bildersuche', () => {
  it('Brave: Anfrage mit Key-Header, Bild-URLs aus properties.url', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url: String(url), headers: init.headers as Record<string, string> };
      return new Response(JSON.stringify({ results: [{ title: 'Tahin', url: 'https://shop/t', properties: { url: 'https://img/t.jpg', width: 800, height: 800 } }, { title: 'ohne Bild' }] }));
    }) as unknown as typeof fetch;
    const r = await new BraveImages('KEY', f).search('Durra Tahin 800 g');
    expect(seen!.url).toContain('api.search.brave.com/res/v1/images/search');
    expect(seen!.url).toContain('q=Durra+Tahin+800+g');
    expect(seen!.headers['X-Subscription-Token']).toBe('KEY');
    expect(r).toEqual([{ url: 'https://img/t.jpg', title: 'Tahin', page: 'https://shop/t', provider: 'brave', width: 800, height: 800 }]);
  });

  it('Anbieter aus der .env', () => {
    expect(providersFromEnv({}).map((p) => p.name)).toEqual(['openfoodfacts']);
    expect(providersFromEnv({ BRAVE_API_KEY: 'x' }).map((p) => p.name)).toEqual(['brave', 'openfoodfacts']);
  });

  it('Suchtext aus Marke, Name und Menge', () => {
    expect(searchQuery({ brand: 'Tanay', name: { de: 'Yakut Ceylon-Schwarztee' }, unit: '800 g' })).toBe('Tanay Yakut Ceylon-Schwarztee 800 g');
  });

  it('ein ausfallender Anbieter bricht die Suche nicht ab, Dubletten fliegen raus', async () => {
    const ok: ImageSearchProvider = { name: 'a', search: async () => [{ url: 'u1', title: '', provider: 'a' }, { url: 'u2', title: '', provider: 'a' }] };
    const dup: ImageSearchProvider = { name: 'b', search: async () => [{ url: 'u2', title: '', provider: 'b' }] };
    const bad: ImageSearchProvider = { name: 'c', search: async () => { throw new Error('HTTP 429'); } };
    const r = await searchAll([bad, ok, dup], 'x');
    expect(r.images.map((i) => i.url)).toEqual(['u1', 'u2']);
    expect(r.errors).toEqual(['c: HTTP 429']);
  });
});
