import { copyFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { cutoutOffers } from '../cutout/cutout';
import type { ExtractedOffer } from '../extract/schema';
import { Library } from '../library/library';
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

const label = (o: ExtractedOffer) => [o.brand, o.name.de, o.unit].filter(Boolean).join(' ');

/**
 * Bild für jedes Angebot finden:
 * 1. Produkt-Bibliothek, 2. Internet (von Claude mit dem Prospekt abgeglichen), 3. Prospekt-Ausschnitt.
 * Bestätigte Internet-Bilder wandern in die Bibliothek.
 */
export async function resolveImages(offers: ExtractedOffer[], opts: ResolveOptions) {
  const log = opts.log ?? (() => {});
  const notes: string[] = [];
  const imagesDir = join(opts.jobDir, 'images');
  await mkdir(imagesDir, { recursive: true });
  const open: ExtractedOffer[] = [];

  // 1. Bibliothek
  for (const o of offers) {
    const hit = opts.library.find({ brand: o.brand, name: o.name, unit: o.unit });
    if (hit) {
      await opts.library.use(hit, join(imagesDir, `${o.id}.png`));
      o.img = `images/${o.id}.png`;
      o.imgSource = 'library';
      log(`${o.id}: aus der Bibliothek (${hit.img})`);
    } else open.push(o);
  }

  // 2. Internet
  const chosen: { o: ExtractedOffer; file: string; url: string; title: string; provider: string }[] = [];
  if (open.length && opts.providers.length) {
    if (!opts.matcher) notes.push('Internet-Bilder werden ohne API-Key nicht automatisch mit dem Prospekt abgeglichen – sie stehen im Review zur Auswahl.');
    const searchErrors = new Set<string>();
    for (const o of open) {
      const q = searchQuery(o);
      const { images, errors } = await searchAll(opts.providers, q);
      errors.forEach((e) => searchErrors.add(e));
      const files: { file: string; url: string; title: string; provider: string }[] = [];
      for (const [n, img] of images.entries()) {
        if (files.length >= (opts.candidates ?? 5)) break;
        try {
          const file = await downloadImage(img.url, join(opts.jobDir, 'work/candidates', o.id, String(n + 1)), opts.fetchImpl);
          files.push({ file, url: img.url, title: img.title, provider: img.provider });
        } catch {
          /* einzelne Downloads dürfen scheitern */
        }
      }
      o.imgAlternatives = files.map((f) => ({ source: f.provider, url: f.url, title: f.title, file: relative(opts.jobDir, f.file) }));
      if (!files.length || !opts.matcher) {
        log(`${o.id}: ${files.length} Internet-Treffer${opts.matcher ? '' : ' (nicht geprüft)'}`);
        continue;
      }
      try {
        const crop = join(opts.jobDir, 'work/crops', `${o.id}.png`);
        await runPython('crops.py', [], [{ image: join(opts.jobDir, o.pageFile), box: o.bbox, out: crop, pad: 0.03 }]);
        const rated = await opts.matcher.compare(
          crop,
          files.map((f) => f.file),
          label(o),
        );
        rated.forEach((r, i) => Object.assign(o.imgAlternatives![i], { match: r.same_product && r.same_variant && r.clean_shot, verdict: r.note }));
        const best = pickBest(rated);
        if (best !== null) chosen.push({ o, ...files[best] });
        log(`${o.id}: ${files.length} Treffer, ${best !== null ? `Treffer ${best + 1} passt` : 'keiner passt sicher'}`);
      } catch (e) {
        o.warnings.push(`Bild: Abgleich mit dem Prospekt fehlgeschlagen (${(e as Error).message})`);
      }
    }
    if (searchErrors.size) notes.push(`Bildersuche: ${[...searchErrors].join('; ')}`);
  }

  // Gewählte Internet-Bilder freistellen (oder vorhandene Transparenz übernehmen)
  if (chosen.length) {
    const results = new Map<string, { ok: boolean; warnings: string[]; width?: number }>();
    await runPython(
      'cutout.py',
      [],
      chosen.map((c) => ({ image: c.file, out: join(imagesDir, `${c.o.id}.png`), bbox: null })),
      (line) => {
        const r = JSON.parse(line);
        results.set(r.out, r);
      },
    ).catch((e) => notes.push(`Freisteller für Internet-Bilder abgebrochen: ${(e as Error).message.split('\n')[0]}`));
    for (const c of chosen) {
      const r = results.get(join(imagesDir, `${c.o.id}.png`));
      if (r?.ok && r.width && !r.warnings.length) {
        c.o.img = `images/${c.o.id}.png`;
        c.o.imgSource = 'web';
        await opts.library.put({ brand: c.o.brand, name: c.o.name, unit: c.o.unit }, join(imagesDir, `${c.o.id}.png`), { type: c.provider === 'openfoodfacts' ? 'openfoodfacts' : 'web', url: c.url }, true);
      } else {
        c.o.warnings.push(`Bild: Internet-Treffer ließ sich nicht sauber freistellen${r?.warnings.length ? ` (${r.warnings.join('; ')})` : ''} – Prospekt-Ausschnitt verwendet`);
      }
    }
  }

  // 3. Rest aus dem Prospekt
  const rest = offers.filter((o) => !o.img || (o.imgSource !== 'library' && o.imgSource !== 'web'));
  if (rest.length) {
    log(`${rest.length} Bild(er) aus dem Prospekt freistellen …`);
    await cutoutOffers(opts.jobDir, rest, log);
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
  await library.put({ brand: o.brand, name: o.name, unit: o.unit }, dest, source, true);
  await library.save();
}
