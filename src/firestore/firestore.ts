/**
 * Lesezugriff auf die sincapp-Firestore-Datenbank (Märkte und Prospekte).
 * Beide Collections sind laut Rules öffentlich lesbar – kein Login, kein Key nötig.
 * Geschrieben wird hier nie etwas.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

/**
 * Nur Dokumente mit `field >= value` lesen (Firestore berechnet pro gelesenem Dokument –
 * so werden alte Prospekte gar nicht erst geladen). Klappt die Abfrage nicht, null.
 */
async function queryFrom(name: string, field: string, min: string, fetchImpl: Fetch): Promise<Record<string, any>[] | null> {
  try {
    const res = await fetchImpl(`${base().replace(/\/$/, '')}:runQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: name }], where: { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: min } } } } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { document?: { name: string; fields?: Record<string, FsValue> } }[];
    if (!Array.isArray(rows)) return null;
    return rows.filter((r) => r.document).map((r) => ({ _id: r.document!.name.split('/').pop()!, ...fields(r.document!.fields ?? {}) }));
  } catch {
    return null;
  }
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

/** Prospekte; mit `since` (YYYY-MM-DD) nur die, die bis mindestens dahin gültig sind. */
export async function listProspects(fetchImpl: Fetch = fetch, since?: string): Promise<FsProspect[]> {
  const docs = (since ? await queryFrom('prospects', 'validUntil', since, fetchImpl) : null) ?? (await collection('prospects', fetchImpl));
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

/**
 * Seiten, die gelesen werden müssen (1-basiert). Haben alle Produkte des Prospekts Fundstellen,
 * werden Seiten ohne Produkte (Titelblatt, Rückseite mit Adressen …) übersprungen – das spart KI-Kosten.
 * Sonst (keine oder unvollständige Fundstellen) alle Seiten.
 */
export function pagesToRead(pr: Pick<FsProspect, 'imageUrls' | 'products'>): number[] {
  const all = pr.imageUrls.map((_, i) => i + 1);
  const prods = pr.products ?? [];
  if (!prods.length || prods.some((p) => !p.locations?.length)) return all;
  const used = new Set(prods.flatMap((p) => p.locations!.map((l) => l.page)));
  const pages = all.filter((n) => used.has(n));
  return pages.length ? pages : all;
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
  const own = ownLogo(slug);
  if (own) logo = own;
  else if (m.logoUrl) {
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

/** Eigenes Logo (in der App hochgeladen) hat Vorrang vor dem Firestore-Bild. */
export function ownLogo(slug: string): string | null {
  for (const ext of ['png', 'jpg']) if (existsSync(join(marketsCacheDir(), slug, `logo-eigenes.${ext}`))) return `${slug}/logo-eigenes.${ext}`;
  return null;
}

export async function saveOwnLogo(slug: string, buf: Buffer) {
  const dir = join(marketsCacheDir(), slug);
  await mkdir(dir, { recursive: true });
  const ext = buf[0] === 0x89 ? 'png' : 'jpg';
  for (const e of ['png', 'jpg']) await rm(join(dir, `logo-eigenes.${e}`), { force: true });
  await writeFile(join(dir, `logo-eigenes.${ext}`), buf);
  const f = marketFile(slug);
  if (f && f.startsWith(marketsCacheDir())) {
    const market = JSON.parse(await readFile(f, 'utf8'));
    market.logo = `${slug}/logo-eigenes.${ext}`;
    delete market.logoCrop;
    await writeFile(f, JSON.stringify(market, null, 2) + '\n');
  }
  return `${slug}/logo-eigenes.${ext}`;
}

/** Gespeichertes Standard-Design eines Markts (oder null). */
export async function readMarketDesign(slug: string): Promise<unknown | null> {
  const f = join(marketsCacheDir(), `${slug}.design.json`);
  return existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : null;
}

export async function saveMarketDesign(slug: string, design: unknown) {
  await mkdir(marketsCacheDir(), { recursive: true });
  await writeFile(join(marketsCacheDir(), `${slug}.design.json`), JSON.stringify(design, null, 2) + '\n');
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
