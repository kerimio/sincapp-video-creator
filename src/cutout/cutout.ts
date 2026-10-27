import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPython } from '../python';
import type { ExtractedOffer } from '../extract/schema';

export interface CutoutResult {
  out: string;
  ok: boolean;
  model?: string;
  width?: number;
  height?: number;
  edgeTransparent?: number;
  coverage?: number;
  warnings: string[];
}

/** Bilder pro Python-Prozess: die onnxruntime-Arena wächst mit jedem Bild. */
const BATCH = 6;

/**
 * Stellt die Produkte aller Angebote frei und schreibt <job>/images/<id>.png.
 * Fehler landen als Warnung am Angebot; der Lauf bricht nicht ab.
 */
export async function cutoutOffers(jobDir: string, offers: ExtractedOffer[], log: (m: string) => void = () => {}) {
  await mkdir(join(jobDir, 'images'), { recursive: true });
  const jobs = offers.map((o) => ({
    id: o.id,
    image: join(jobDir, o.pageFile),
    out: join(jobDir, 'images', `${o.id}.png`),
    bbox: o.bbox,
    erase: o.priceTagBbox ? [o.priceTagBbox] : [],
  }));
  const results = new Map<string, CutoutResult>();
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    try {
      await runPython('cutout.py', [], batch, (line) => {
        const r = JSON.parse(line) as CutoutResult;
        const job = batch.find((j) => j.out === r.out);
        if (job) results.set(job.id, r);
        log(`Freisteller ${results.size}/${jobs.length}`);
      });
    } catch (e) {
      for (const j of batch) if (!results.has(j.id)) results.set(j.id, { out: j.out, ok: false, warnings: [`Freisteller-Prozess abgebrochen: ${(e as Error).message.split('\n')[0]}`] });
    }
  }

  const key = process.env.REMOVEBG_API_KEY;
  for (const o of offers) {
    const r = results.get(o.id);
    if (!r) continue;
    if (!r.ok && key) {
      try {
        await removeBg(join(jobDir, o.pageFile), o.bbox, join(jobDir, 'images', `${o.id}.png`), key);
        o.img = `images/${o.id}.png`;
        o.imgSource = 'removebg';
        o.warnings.push('Lokal nicht sauber freigestellt – remove.bg verwendet');
        continue;
      } catch (e) {
        r.warnings.push(`remove.bg fehlgeschlagen: ${(e as Error).message}`);
      }
    }
    if (r.width) {
      o.img = `images/${o.id}.png`;
      o.imgSource = 'prospekt';
    }
    o.warnings.push(...r.warnings.map((w) => `Bild: ${w}`));
  }
  return results;
}

/** remove.bg mit dem gleichen Ausschnitt (Rand 6 %); braucht REMOVEBG_API_KEY. */
export async function removeBg(pageFile: string, bbox: number[], out: string, apiKey: string, fetchImpl: typeof fetch = fetch) {
  const tmp = `${out}.crop.png`;
  await runPython('crops.py', [], [{ image: pageFile, box: bbox, out: tmp, pad: 0.06 }]);
  const form = new FormData();
  form.append('image_file', new Blob([await readFile(tmp)]), 'crop.png');
  form.append('size', 'auto');
  form.append('crop', 'true');
  form.append('format', 'png');
  const res = await fetchImpl('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': apiKey }, body: form });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
}
