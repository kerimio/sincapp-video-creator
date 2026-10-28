/**
 * Lesezugriff auf die sincapp-Firestore-Datenbank (Märkte und Prospekte).
 * Beide Collections sind laut Rules öffentlich lesbar – kein Login, kein Key nötig.
 * Geschrieben wird hier nie etwas.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../paths';

type Fetch = typeof fetch;

export const firestoreProject = () => process.env.SINCAPP_FIREBASE_PROJECT || 'trprosp';
const base = () => `https://firestore.googleapis.com/v1/projects/${firestoreProject()}/databases/(default)/documents/`;

// ---------- Firestore-REST-Werte → einfache JS-Werte ----------
type FsValue = Record<string, any>;
function value(v: FsValue): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(value);
  if ('mapValue' in v) return fields(v.mapValue.fields ?? {});
  return undefined;
}
const fields = (f: Record<string, FsValue>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, value(v)]));

async function collection(name: string, fetchImpl: Fetch): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  let token = '';
  do {
    const url = `${base()}${name}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Firestore (${name}): HTTP ${res.status}`);
    const data = (await res.json()) as { documents?: { name: string; fields?: Record<string, FsValue> }[]; nextPageToken?: string };
    for (const d of data.documents ?? []) out.push({ _id: d.name.split('/').pop()!, ...fields(d.fields ?? {}) });
    token = data.nextPageToken ?? '';
  } while (token);
  return out;
}

// ---------- Märkte ----------
export interface FsMarket {
  id: string;
  name: string;
  address: string | null;
  logoUrl: string | null;
  instagram: string | null;
}

/** "Deisterstraße 17, 30449 Hannover, Germany" → ohne Länderzusatz. */
export function cleanAddress(a: string | undefined | null) {
  if (!a) return null;
  return a.replace(/,\s*(Germany|Deutschland)\s*$/i, '').trim() || null;
}

export async function listMarkets(fetchImpl: Fetch = fetch): Promise<FsMarket[]> {
  const docs = await collection('markets', fetchImpl);
  return docs
    .map((d) => ({
      id: d._id as string,
      name: String(d.name ?? d._id),
      // neue Dokumente: profile.address; Altbestand: Adresse steht in profile.description
      address: cleanAddress(d.profile?.address ?? d.profile?.description),
      logoUrl: d.profile?.logoUrl || null,
      instagram: d.profile?.social?.instagram ? String(d.profile.social.instagram).replace(/^@/, '') : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// ---------- Prospekte ----------
export interface FsProspect {
  id: string;
  marketIds: string[];
  title: string;
  validFrom: string;
  validUntil: string;
  imageUrls: string[];
  thumbnailUrls: string[];
  /** Produkte mit Fundstellen aus dem Admin-Tool (Boxen [ymin, xmin, ymax, xmax] 0–1000) */
  products: { name_de: string; name_tr?: string; locations?: { page: number; box: number[]; label?: { de?: string; tr?: string } }[] }[];
}

export async function listProspects(fetchImpl: Fetch = fetch): Promise<FsProspect[]> {
  const docs = await collection('prospects', fetchImpl);
  return docs
    .map((d) => {
      // tolerant wie die App: marketIds, sonst [marketId]; leere/doppelte Einträge raus
      const ids = Array.isArray(d.marketIds) && d.marketIds.length ? d.marketIds : [d.marketId];
      return {
        id: d._id as string,
        marketIds: [...new Set<string>(ids.filter(Boolean))],
        title: String(d.title ?? 'Prospekt'),
        validFrom: String(d.validFrom ?? ''),
        validUntil: String(d.validUntil ?? ''),
        imageUrls: (d.imageUrls ?? d.images ?? []) as string[],
        thumbnailUrls: (d.thumbnailUrls ?? []) as string[],
        products: (d.products ?? []) as FsProspect['products'],
      };
    })
    .filter((p) => p.imageUrls.length)
    .sort((a, b) => b.validUntil.localeCompare(a.validUntil));
}

/** Heute in Berlin als YYYY-MM-DD (Gültigkeit wechselt um Mitternacht deutscher Zeit). */
export const todayBerlin = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

// ---------- Markt als lokale Markt-Datei (für story.json und Template) ----------
export function marketsCacheDir() {
  return process.env.SINCAPP_MARKETS_CACHE || join(ROOT, '.cache', 'markets');
}

/** Firestore-ID → Slug für story.json ("saray_market_tazrp7" → "saray-market-tazrp7"). */
export const marketSlug = (id: string) => id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'markt';

/** Legt <cache>/<slug>.json und das Logo an, damit Pipeline und Template den Markt wie eine lokale Markt-Datei nutzen. */
export async function cacheMarket(m: FsMarket, fetchImpl: Fetch = fetch) {
  const slug = marketSlug(m.id);
  const dir = marketsCacheDir();
  await mkdir(join(dir, slug), { recursive: true });
  let logo = `${slug}/logo.jpg`;
  if (m.logoUrl) {
    const res = await fetchImpl(m.logoUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Logo von ${m.name} nicht ladbar (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    logo = `${slug}/logo.${buf[0] === 0x89 ? 'png' : 'jpg'}`;
    await writeFile(join(dir, logo), buf);
  } else if (!existsSync(join(dir, logo))) {
    throw new Error(`${m.name} hat in Firestore kein Logo.`);
  }
  const market = {
    name: m.name,
    slug,
    logo,
    ...(m.instagram && /^[A-Za-z0-9._]+$/.test(m.instagram) ? { instagram: m.instagram } : {}),
    addresses: [m.address ?? m.name],
    firestoreId: m.id,
  };
  await writeFile(join(dir, `${slug}.json`), JSON.stringify(market, null, 2) + '\n');
  return market;
}

/** Markt-Datei suchen: erst markets/ im Repo, dann der Firestore-Cache. */
export function marketFile(slug: string): string | null {
  for (const dir of [join(ROOT, 'markets'), marketsCacheDir()]) {
    const f = join(dir, `${slug}.json`);
    if (existsSync(f)) return f;
  }
  return null;
}

export async function readMarket(slug: string): Promise<unknown> {
  const f = marketFile(slug);
  if (!f) throw new Error(`Markt "${slug}" nicht gefunden – bitte in der App neu aus Firestore wählen.`);
  return JSON.parse(await readFile(f, 'utf8'));
}

/** Ordner, unter denen /markets/… ausgeliefert wird (Logos). */
export const marketDirs = () => [join(ROOT, 'markets'), marketsCacheDir()];
