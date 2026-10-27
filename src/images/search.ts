import { findProductImages } from './openfoodfacts';

/** Ein Bildtreffer aus dem Internet. */
export interface WebImage {
  url: string;
  title: string;
  /** Seite, auf der das Bild steht */
  page?: string;
  provider: string;
  width?: number;
  height?: number;
}

export interface ImageSearchProvider {
  name: string;
  search(query: string, opts?: { limit?: number }): Promise<WebImage[]>;
}

type Fetch = typeof fetch;

/** Brave-Bildersuche (BRAVE_API_KEY). */
export class BraveImages implements ImageSearchProvider {
  name = 'brave';
  constructor(private key: string, private fetchImpl: Fetch = fetch) {}
  async search(query: string, opts: { limit?: number } = {}) {
    const url = `https://api.search.brave.com/res/v1/images/search?${new URLSearchParams({ q: query, count: String(Math.min(50, (opts.limit ?? 8) * 2)), country: 'de', safesearch: 'strict' })}`;
    const res = await this.fetchImpl(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': this.key }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Brave: HTTP ${res.status}`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; properties?: { url?: string; width?: number; height?: number } }[] };
    return (data.results ?? [])
      .filter((r) => r.properties?.url)
      .slice(0, opts.limit ?? 8)
      .map((r) => ({ url: r.properties!.url!, title: r.title ?? '', page: r.url, provider: this.name, width: r.properties?.width, height: r.properties?.height }));
  }
}

/** Open Food Facts als Suchanbieter (kein Key). */
export class OpenFoodFactsImages implements ImageSearchProvider {
  name = 'openfoodfacts';
  constructor(private fetchImpl: Fetch = fetch) {}
  async search(query: string, opts: { limit?: number } = {}) {
    // Open Food Facts verlangt alle Suchwörter – Menge weglassen und notfalls nur mit dem Namen ohne Marke suchen
    const noUnit = query.replace(/\b\d+(?:[.,]\d+)?\s*(?:x|×)?\s*\d*\s*(?:kg|g|l|ml|cl|stk|st)\b\.?/gi, ' ').replace(/\s+/g, ' ').trim();
    const tries = [...new Set([query, noUnit, noUnit.split(' ').slice(1).join(' ')])].filter((q) => q.split(' ').length >= 1 && q.length > 2);
    for (const q of tries) {
      const r = await findProductImages({ brand: null, names: [q] }, { fetchImpl: this.fetchImpl, limit: opts.limit ?? 4 });
      if (r.length) return r.map((c) => ({ url: c.url, title: c.title, provider: this.name }));
    }
    return [];
  }
}

/** Anbieter laut .env: BRAVE_API_KEY, Open Food Facts immer dabei. */
export function providersFromEnv(env = process.env, fetchImpl: Fetch = fetch): ImageSearchProvider[] {
  const list: ImageSearchProvider[] = [];
  if (env.BRAVE_API_KEY) list.push(new BraveImages(env.BRAVE_API_KEY, fetchImpl));
  if (env.SINCAPP_NO_OPENFOODFACTS !== '1') list.push(new OpenFoodFactsImages(fetchImpl));
  return list;
}

/** Suchtext: Marke + deutscher Name + Menge, z. B. "Egetürk Sırma Knoblauchwurst 1 kg". */
export function searchQuery(o: { brand: string | null; name: { de: string; tr?: string }; unit?: string | null }) {
  return [o.brand, o.name.de, o.unit].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Alle Anbieter fragen, Dubletten entfernen. Fehler einzelner Anbieter werden gesammelt, nicht geworfen. */
export async function searchAll(providers: ImageSearchProvider[], query: string, limit = 8) {
  const errors: string[] = [];
  const seen = new Set<string>();
  const out: WebImage[] = [];
  for (const p of providers) {
    try {
      for (const img of await p.search(query, { limit })) {
        if (seen.has(img.url)) continue;
        seen.add(img.url);
        out.push(img);
      }
    } catch (e) {
      errors.push(`${p.name}: ${(e as Error).message}`);
    }
  }
  return { images: out, errors };
}

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

/** Bild herunterladen (max. 8 MB, nur echte Bildformate). Gibt den Dateipfad zurück. */
export async function downloadImage(url: string, destNoExt: string, fetchImpl: Fetch = fetch) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 sincapp-story' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new Error(`kein Bild (${type || 'unbekannt'})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new Error('Bild größer als 8 MB');
  if (buf.length < 2000) throw new Error('Bild zu klein');
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(destNoExt), { recursive: true });
  const file = destNoExt + ext;
  await writeFile(file, buf);
  return file;
}
