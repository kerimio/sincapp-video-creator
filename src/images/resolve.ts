// Produktbild für jedes Angebot finden: Katalog → Internet → Prospekt-Ausschnitt (siehe AGENTS.md, Bildquellen-Reihenfolge).
import { copyFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { cutoutOffers } from '../cutout/cutout';
import type { ExtractedOffer } from '../extract/schema';
import { Library, type LibraryEntry } from '../library/library';
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
    const hit = opts.library.find({ brand: o.brand, name: o.name, unit: o.unit });
    if (hit && (hit.source.type !== 'prospekt' || hit.webTried || !opts.providers.length)) {
      await opts.library.use(hit, join(imagesDir, `${o.id}.png`));
      o.img = `images/${o.id}.png`;
      o.imgSource = 'library';
      log(`${o.id}: aus der Bibliothek (${hit.img})`);
    } else {
      if (hit) fallback.set(o.id, hit);
      open.push(o);
    }
  }

  // 2. Internet
  const chosen: ({ o: ExtractedOffer } & WebFile)[] = [];
  if (open.length && opts.providers.length) {
    if (!opts.matcher) notes.push('Internet-Bilder werden ohne API-Key nicht automatisch mit dem Prospekt abgeglichen – sie stehen im Review zur Auswahl.');
    const searchErrors = new Set<string>();
    for (const o of open) {
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
    const results = await cutoutWeb(chosen.map((c) => ({ image: c.file, out: join(imagesDir, `${c.o.id}.png`) }))).catch((e) => {
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
    const fromPage = rest.filter((o) => o.img && o.imgSource === 'prospekt');
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

/** Internet-Foto freistellen (oder vorhandene Transparenz übernehmen). */
export async function cutoutWeb(items: { image: string; out: string }[]) {
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
