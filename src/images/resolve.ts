// Produktbild für jedes Angebot finden: Katalog → Internet → Prospekt-Ausschnitt (siehe AGENTS.md, Bildquellen-Reihenfolge).
import { copyFile, mkdir, open as openFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { cutoutOffers } from '../cutout/cutout';
import type { Category, ExtractedOffer } from '../extract/schema';
import { Library, productKey, type LibraryEntry } from '../library/library';
import { runPython } from '../python';
import { pickBest, type ProductMatcher } from './match';
import { downloadImage, searchAll, searchQuery, type ImageSearchProvider } from './search';

export interface ResolveOptions {
  jobDir: string;
  library: Library;
  providers: ImageSearchProvider[];
  /** null = kein API-Key: Treffer werden nur als Alternativen angeboten */
  matcher: ProductMatcher | null;
  fetchImpl?: typeof fetch;
  /** Kandidaten pro Angebot, die geladen und verglichen werden */
  candidates?: number;
  log?: (m: string) => void;
}


/**
 * Angebot über mehrere Sorten (Red Bull blau, grün und normal für 0,81 €): Ein Internet- oder Katalogfoto zeigt nur eine Sorte –
 * dann lieber der Prospekt-Ausschnitt mit allen. Erkannt an der Zahl der Sorten im Bild oder am Zusatz ("diverse Sorten", "Karamell oder Erdbeere").
 */
export function multiVariant(o: Pick<ExtractedOffer, 'variants' | 'note' | 'category'>) {
  if (keepAsPhoto(o.category)) return false;
  if ((o.variants ?? 0) >= 2) return true;
  return !!o.note && /sorten|sorte\b|versch|geschmack|\boder\b|çeşit|cesit|\bveya\b/i.test(`${o.note.de} ${o.note.tr}`);
}

/**
 * Bild für jedes Angebot finden:
 * 1. Katalog (eigenes Bild, dann Internet-Foto), 2. Internet (von der KI mit dem Prospekt abgeglichen),
 * 3. Notfall: Prospekt-Ausschnitt. Bestätigte Internet-Bilder und bereinigte Ausschnitte wandern in den Katalog.
 */
export async function resolveImages(offers: ExtractedOffer[], opts: ResolveOptions) {
  const log = opts.log ?? (() => {});
  const notes: string[] = [];
  const imagesDir = join(opts.jobDir, 'images');
  await mkdir(imagesDir, { recursive: true });
  const open: ExtractedOffer[] = [];

  // 1. Bibliothek: eigenes Bild oder Internet-Foto → sofort, ohne Suche und ohne KI.
  //    Nur ein Prospekt-Ausschnitt wird einmal gegen das Internet getauscht (Internet zuerst).
  const fallback = new Map<string, LibraryEntry>();
  for (const o of offers) {
    // mehrere Sorten: alle aus dem Prospekt zeigen (ein eigenes Bild aus dem Katalog gewinnt trotzdem); keine Suche, keine KI
    if (multiVariant(o)) {
      const own = opts.library.find({ brand: o.brand, name: o.name, unit: o.unit });
      if (own?.source.type === 'manual' && own.variant && multiVariant({ note: own.variant, category: o.category })) {
        await opts.library.use(own, join(imagesDir, `${o.id}.png`));
        o.img = `images/${o.id}.png`;
        o.imgSource = 'library';
      }
      continue;
    }
    // frisches Fleisch: ein Bild je Produkt, egal ob 500 g oder 1 kg (Gemischtes Hack sieht überall gleich aus)
    const hit = opts.library.find({ brand: o.brand, name: o.name, unit: keepAsPhoto(o.category) ? null : o.unit });
    if (hit && (hit.source.type !== 'prospekt' || hit.webTried || !opts.providers.length)) {
      if (keepAsPhoto(o.category) && (hit.source.type === 'web' || hit.source.type === 'openfoodfacts') && hit.source.url && (await hasAlpha(opts.library.path(hit)))) {
        await redoAsPhoto(hit, opts, log);
      }
      await opts.library.use(hit, join(imagesDir, `${o.id}.png`));
      o.img = `images/${o.id}.png`;
      o.imgSource = 'library';
      log(`${o.id}: aus der Bibliothek (${hit.img})`);
    } else {
      if (hit) fallback.set(o.id, hit);
      open.push(o);
    }
  }

  // 2. Internet – dasselbe Produkt aus mehreren Märkten nur einmal suchen; alle bekommen dasselbe Bild
  const leaderOf = new Map<string, ExtractedOffer>();
  const byKey = new Map<string, ExtractedOffer>();
  for (const o of open) {
    const key = `${productKey(o.brand, o.name.de)}${keepAsPhoto(o.category) ? '' : `|${o.unit ?? ''}`}`;
    const first = byKey.get(key);
    if (first) leaderOf.set(o.id, first);
    else byKey.set(key, o);
  }
  const chosen: ({ o: ExtractedOffer } & WebFile)[] = [];
  if (open.length && opts.providers.length) {
    if (!opts.matcher) notes.push('Internet-Bilder werden ohne API-Key nicht automatisch mit dem Prospekt abgeglichen – sie stehen im Review zur Auswahl.');
    const searchErrors = new Set<string>();
    for (const o of open) {
      if (leaderOf.has(o.id)) continue;
      try {
        const r = await findWebImage(o, { image: join(opts.jobDir, o.pageFile), box: o.bbox }, join(opts.jobDir, 'work'), opts);
        r.errors.forEach((e) => searchErrors.add(e));
        o.imgAlternatives = r.files.map((f, i) => ({ source: f.provider, url: f.url, title: f.title, file: relative(opts.jobDir, f.file), ...(r.rated ? { match: r.rated[i].same_product && r.rated[i].same_variant && r.rated[i].clean_shot, verdict: r.rated[i].note } : {}) }));
        if (r.best) chosen.push({ o, ...r.best });
        log(`${o.id}: ${r.files.length} Internet-Treffer${!r.rated ? (opts.matcher ? '' : ' (nicht geprüft)') : r.best ? ', einer passt' : ', keiner passt sicher'}`);
      } catch (e) {
        o.warnings.push(`Bild: Abgleich mit dem Prospekt fehlgeschlagen (${(e as Error).message})`);
      }
    }
    if (searchErrors.size) notes.push(`Bildersuche: ${[...searchErrors].join('; ')}`);
  }

  // Gewählte Internet-Bilder freistellen (oder vorhandene Transparenz übernehmen)
  if (chosen.length) {
    const results = await cutoutWeb(chosen.map((c) => ({ image: c.file, out: join(imagesDir, `${c.o.id}.png`), photo: keepAsPhoto(c.o.category) }))).catch((e) => {
      notes.push(`Freisteller für Internet-Bilder abgebrochen: ${(e as Error).message.split('\n')[0]}`);
      return new Map<string, { ok: boolean; warnings: string[]; width?: number }>();
    });
    for (const c of chosen) {
      const r = results.get(join(imagesDir, `${c.o.id}.png`));
      if (r?.ok && r.width && !r.warnings.length) {
        c.o.img = `images/${c.o.id}.png`;
        c.o.imgSource = 'web';
        await opts.library.put({ brand: c.o.brand, name: c.o.name, unit: c.o.unit, category: c.o.category, note: c.o.note }, join(imagesDir, `${c.o.id}.png`), { type: c.provider === 'openfoodfacts' ? 'openfoodfacts' : 'web', url: c.url }, true);
      } else {
        c.o.warnings.push(`Bild: Internet-Treffer ließ sich nicht sauber freistellen${r?.warnings.length ? ` (${r.warnings.join('; ')})` : ''} – Prospekt-Ausschnitt verwendet`);
      }
    }
  }

  const share = async (o: ExtractedOffer, from: ExtractedOffer) => {
    await copyFile(join(opts.jobDir, from.img!), join(imagesDir, `${o.id}.png`));
    o.img = `images/${o.id}.png`;
    o.imgSource = from.imgSource;
    o.imgAlternatives = from.imgAlternatives;
  };
  for (const [id, leader] of leaderOf) {
    const o = open.find((x) => x.id === id)!;
    if (leader.imgSource === 'web') await share(o, leader);
  }

  // Kein Internet-Foto: vorhandener Prospekt-Ausschnitt aus dem Katalog, nicht bei jedem Video neu suchen
  const today = new Date().toISOString().slice(0, 10);
  for (const o of open) {
    const hit = fallback.get(o.id);
    if (!hit || o.imgSource === 'web') continue;
    hit.webTried = today;
    await opts.library.use(hit, join(imagesDir, `${o.id}.png`));
    o.img = `images/${o.id}.png`;
    o.imgSource = 'library';
  }

  // 3. Notfall: aus dem Prospekt ausschneiden. In den Katalog kommt eine einzelne, bereinigte Packung.
  const rest = offers.filter((o) => !o.img || (o.imgSource !== 'library' && o.imgSource !== 'web'));
  if (rest.length) {
    log(`${rest.length} Bild(er) aus dem Prospekt freistellen …`);
    await cutoutOffers(opts.jobDir, rest, log);
    // in den Katalog nur Einzelsorten: eine herausgeschnittene Dose stünde sonst für „alle Sorten“
    const fromPage = rest.filter((o) => o.img && o.imgSource === 'prospekt' && !multiVariant(o));
    const groups = rest.filter((o) => o.img && multiVariant(o));
    if (groups.length) log(`${groups.length} Angebot(e) mit mehreren Sorten: alle Sorten aus dem Prospekt`);
    const singles = await singleCopies(fromPage.map((o) => ({ image: join(opts.jobDir, o.img!), out: join(opts.jobDir, 'work/katalog', `${o.id}.png`) })));
    for (const o of fromPage) {
      const r = singles.get(join(opts.jobDir, 'work/katalog', `${o.id}.png`));
      if (!r?.ok) continue;
      const e = await opts.library.put({ brand: o.brand, name: o.name, unit: o.unit, category: o.category, note: o.note }, r.out, { type: 'prospekt' }, false);
      if (e.source.type === 'prospekt') {
        e.single = true;
        if (opts.providers.length) e.webTried = today;
      }
    }
  }
  // gleiches Produkt in mehreren Märkten ohne Internet-Foto: frisches Fleisch trotzdem überall mit demselben Bild
  for (const [id, leader] of leaderOf) {
    const o = open.find((x) => x.id === id)!;
    if (leader.img && o.imgSource !== 'web' && o.imgSource !== 'library' && keepAsPhoto(o.category)) await share(o, leader);
  }
  await opts.library.save();
  return { notes };
}

/** Im Review gewähltes Bild als Produktbild übernehmen und in der Bibliothek merken. */
export async function adoptImage(o: ExtractedOffer, jobDir: string, png: string, library: Library, source: { type: 'web' | 'openfoodfacts' | 'manual' | 'prospekt'; url?: string }) {
  const dest = join(jobDir, 'images', `${o.id}.png`);
  if (png !== dest) await copyFile(png, dest);
  o.img = `images/${o.id}.png`;
  o.imgSource = source.type === 'prospekt' ? 'prospekt' : source.type === 'manual' ? 'manual' : 'web';
  // Prospekt-Ausschnitt: im Katalog nur eine Packung, sauber
  const single = source.type === 'prospekt' ? (await singleCopies([{ image: dest, out: join(jobDir, 'work/katalog', `${o.id}.png`) }])).values().next().value : undefined;
  const e = await library.put({ brand: o.brand, name: o.name, unit: o.unit, category: o.category, note: o.note }, single?.ok ? single.out : dest, source, true);
  if (single?.ok && e.source.type === 'prospekt') e.single = true;
  await library.save();
}

export interface WebFile {
  file: string;
  url: string;
  title: string;
  provider: string;
}

/**
 * Internet-Fotos zu einem Produkt suchen, laden und – mit KI – gegen ein Referenzbild
 * (Prospekt-Ausschnitt) prüfen. Ohne KI gibt es nur Kandidaten, keinen sicheren Treffer.
 */
export async function findWebImage(
  o: { id: string; brand: string | null; name: { de: string; tr?: string }; unit?: string | null },
  ref: { image: string; box: number[] | null },
  workDir: string,
  opts: Pick<ResolveOptions, 'providers' | 'matcher' | 'fetchImpl' | 'candidates'>,
) {
  const { images, errors } = await searchAll(opts.providers, searchQuery(o));
  const files: WebFile[] = [];
  for (const [n, img] of images.entries()) {
    if (files.length >= (opts.candidates ?? 5)) break;
    try {
      const file = await downloadImage(img.url, join(workDir, 'candidates', o.id, String(n + 1)), opts.fetchImpl);
      files.push({ file, url: img.url, title: img.title, provider: img.provider });
    } catch {
      /* einzelne Downloads dürfen scheitern */
    }
  }
  if (!files.length || !opts.matcher) return { files, errors, rated: null, best: null };
  const crop = join(workDir, 'crops', `${o.id}.png`);
  // Für den KI-Vergleich verkleinert (512 px reichen zum Erkennen, kosten aber nur einen Bruchteil der Tokens)
  const small = files.map((_, i) => join(workDir, 'match', o.id, `${i + 1}.jpg`));
  await runPython('crops.py', [], [
    { image: ref.image, box: ref.box, out: crop, pad: ref.box ? 0.03 : 0, maxSide: 640 },
    ...files.map((f, i) => ({ image: f.file, box: null, out: small[i], pad: 0, maxSide: 512 })),
  ]);
  const rated = await opts.matcher.compare(crop, small, [o.brand, o.name.de, o.unit].filter(Boolean).join(' '));
  const i = pickBest(rated);
  return { files, errors, rated, best: i === null ? null : files[i] };
}

/**
 * Frisches Fleisch bleibt ein Foto mit Hintergrund: Kräuter, Zitrone und Brett schneidet der Freisteller
 * zackig und mit Löchern aus. Abgepacktes auf weißem Grund wird trotzdem sauber freigestellt (cutout.py).
 */
export const keepAsPhoto = (category: Category | undefined) => category === 'fleisch';

/** Hat die PNG einen Alphakanal? (Fotos speichert cutout.py ohne, Freisteller mit.) Byte 25 = Farbtyp. */
export async function hasAlpha(png: string) {
  const f = await openFile(png, 'r').catch(() => null);
  if (!f) return false;
  try {
    const buf = Buffer.alloc(26);
    await f.read(buf, 0, 26, 0);
    return buf[25] === 6 || buf[25] === 4;
  } finally {
    await f.close();
  }
}

/** Älteren Freisteller eines Fleisch-Fotos aus dem Katalog neu laden und als Foto speichern (kostenlos, ohne KI). */
async function redoAsPhoto(e: LibraryEntry, opts: ResolveOptions, log: (m: string) => void) {
  try {
    const file = await downloadImage(e.source.url!, join(opts.jobDir, 'work', 'foto', e.img.replace(/\.png$/, '')), opts.fetchImpl);
    const r = (await cutoutWeb([{ image: file, out: opts.library.path(e), photo: true }])).get(opts.library.path(e));
    if (r?.ok) log(`${e.name.de}: Foto statt Freisteller`);
  } catch {
    /* Bild nicht mehr erreichbar – der alte Freisteller bleibt */
  }
}

/** Internet-Foto freistellen (oder vorhandene Transparenz übernehmen); `photo` = als Foto behalten (siehe keepAsPhoto). */
export async function cutoutWeb(items: { image: string; out: string; photo?: boolean }[]) {
  const results = new Map<string, { ok: boolean; warnings: string[]; width?: number }>();
  if (!items.length) return results;
  await runPython('cutout.py', [], items.map((c) => ({ ...c, bbox: null })), (line) => {
    const r = JSON.parse(line);
    results.set(r.out, r);
  });
  return results;
}

/** Prospekt-Ausschnitte auf eine Packung zuschneiden und die Kante bereinigen (lokal, kostenlos). */
export async function singleCopies(items: { image: string; out: string }[]) {
  const results = new Map<string, { out: string; ok: boolean; copies?: number }>();
  if (!items.length) return results;
  try {
    await runPython('single.py', [], items, (line) => {
      const r = JSON.parse(line);
      results.set(r.out, r);
    });
  } catch {
    /* ohne Bereinigung geht es mit dem normalen Ausschnitt weiter */
  }
  return results;
}
