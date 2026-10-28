import { basename } from 'node:path';
import { bestPriceWeeks } from '../core/catalog';
import type { Story } from '../core/schema';
import type { ExtractedOffer } from '../extract/schema';
import { enrichFromJobs } from './catalog-api';
import { Library } from './library';

/**
 * "Bester Preis seit X Wochen" automatisch: Preisverlauf aus dem Katalog (frühere Prospekte)
 * mit dem aktuellen Preis vergleichen. Setzt den Bestpreis-Sticker nur, wo noch keiner ist.
 * Läuft lokal, kostet nichts. Gibt die Hinweise für den Bericht zurück.
 */
export async function markBestPrices(story: Story, offers: Pick<ExtractedOffer, 'id' | 'brand' | 'name' | 'unit'>[], jobDir: string, lib?: Library): Promise<string[]> {
  const library = lib ?? (await Library.open());
  await enrichFromJobs(library).catch(() => false);
  const job = basename(jobDir);
  const notes: string[] = [];
  for (const o of story.offers) {
    const src = offers.find((x) => x.id === o.id);
    const e = src && library.find({ brand: src.brand, name: src.name, unit: src.unit });
    const weeks = e ? bestPriceWeeks(o.price, e.seen, story.dates.from, job) : null;
    if (!weeks) continue;
    o.bestWeeks = weeks;
    if (!o.badge) o.badge = 'bestpreis';
    notes.push(`${src!.name.de}: bester Preis seit ${weeks} Wochen`);
  }
  return notes;
}
