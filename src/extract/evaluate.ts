import { normalizePrice } from './normalize';
import type { Extraction } from './schema';

/** Format von reference/samples/<name>/ground-truth.json */
export interface GroundTruth {
  market: string;
  validFrom: string;
  validTo: string;
  addresses: string[];
  offers: { page: number; brand: string; name: string; unit: string; price: string }[];
}

export interface Evaluation {
  expected: number;
  found: number;
  recall: number;
  /** Erkannte Angebote mit falschem Preis, die NICHT als unsicher markiert sind (muss 0 sein). */
  wrongUnflagged: string[];
  wrongFlagged: string[];
  missing: string[];
  validityOk: boolean;
  addressOk: boolean;
  passed: boolean;
}

const words = (s: string) =>
  new Set(
    s
      .toLocaleLowerCase('de')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2),
  );

function similarity(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

/** Abnahmekriterien: ≥ 95 % erkannt, Preise korrekt oder markiert (< 0.9), Zeitraum erkannt. */
export function evaluate(ex: Extraction, gt: GroundTruth): Evaluation {
  const used = new Set<string>();
  const missing: string[] = [];
  const wrongUnflagged: string[] = [];
  const wrongFlagged: string[] = [];
  for (const g of gt.offers) {
    const label = `S.${g.page} ${g.brand} ${g.name} (${g.price})`;
    const cands = ex.offers
      .filter((o) => o.page === g.page && !used.has(o.id))
      .map((o) => ({ o, s: similarity(`${o.brand ?? ''} ${o.name.de} ${o.note?.de ?? ''}`, `${g.brand} ${g.name}`) + (o.price === normalizePrice(g.price) ? 0.5 : 0) }))
      .filter((c) => c.s >= 0.5)
      .sort((a, b) => b.s - a.s);
    const m = cands[0]?.o;
    if (!m) {
      missing.push(label);
      continue;
    }
    used.add(m.id);
    if (m.price !== normalizePrice(g.price)) (m.priceConfidence < 0.9 ? wrongFlagged : wrongUnflagged).push(`${label} → ${m.price ?? '–'}`);
  }
  const found = gt.offers.length - missing.length;
  const recall = found / gt.offers.length;
  const validityOk = ex.validFrom === gt.validFrom && ex.validTo === gt.validTo;
  const norm = (a: string) => a.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  const addressOk = gt.addresses.every((a) => ex.addresses.some((b) => norm(a) === norm(b)));
  return {
    expected: gt.offers.length,
    found,
    recall,
    wrongUnflagged,
    wrongFlagged,
    missing,
    validityOk,
    addressOk,
    passed: recall >= 0.95 && wrongUnflagged.length === 0 && validityOk,
  };
}
