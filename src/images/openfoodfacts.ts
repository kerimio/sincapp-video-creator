/**
 * Produktbilder aus Open Food Facts als Alternative zum Prospekt-Ausschnitt.
 * Kein API-Key nötig. Die Treffer werden nur vorgeschlagen; ausgewählt wird im Review.
 */

export interface ImageCandidate {
  source: 'openfoodfacts';
  url: string;
  title: string;
}

const ENDPOINT = 'https://world.openfoodfacts.org/cgi/search.pl';
const USER_AGENT = 'sincapp-story/0.2 (https://github.com/kerimio/sincapp-video-creator)';

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  image_front_url?: string;
  image_url?: string;
}

function words(s: string) {
  return s
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);
}

/** Wie gut passt ein Treffer? Marke zählt doppelt. */
export function scoreCandidate(p: OffProduct, brand: string | null, names: string[]) {
  const hay = new Set(words(`${p.brands ?? ''} ${p.product_name ?? ''}`));
  const brandHit = brand ? words(brand).some((w) => hay.has(w)) : false;
  const nameWords = [...new Set(names.flatMap(words))];
  const nameHits = nameWords.filter((w) => hay.has(w)).length;
  return (brandHit ? 2 : 0) + nameHits;
}

export async function findProductImages(
  q: { brand: string | null; names: string[] },
  opts: { fetchImpl?: typeof fetch; limit?: number; timeoutMs?: number } = {},
): Promise<ImageCandidate[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const terms = [q.brand, q.names[0]].filter(Boolean).join(' ');
  const url = `${ENDPOINT}?${new URLSearchParams({
    search_terms: terms,
    search_simple: '1',
    action: 'process',
    json: '1',
    page_size: '12',
    fields: 'code,product_name,brands,image_front_url,image_url',
  })}`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(opts.timeoutMs ?? 10000) });
  if (!res.ok) throw new Error(`Open Food Facts: HTTP ${res.status}`);
  const data = (await res.json()) as { products?: OffProduct[] };
  return (data.products ?? [])
    .map((p) => ({ p, s: scoreCandidate(p, q.brand, q.names) }))
    .filter(({ p, s }) => (p.image_front_url || p.image_url) && s >= (q.brand ? 3 : 1))
    .sort((a, b) => b.s - a.s)
    .slice(0, opts.limit ?? 3)
    .map(({ p }) => ({
      source: 'openfoodfacts' as const,
      url: (p.image_front_url || p.image_url)!,
      title: [p.brands, p.product_name].filter(Boolean).join(' – '),
    }));
}
