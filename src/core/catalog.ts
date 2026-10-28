import { CATEGORIES, type Category } from '../extract/schema';
import { priceValue } from './format';

// Bausteine für den Produkt-Katalog: Warengruppen-Namen und Mengenangaben verstehen.

export const CATEGORY_LABEL: Record<Category, { de: string; tr: string }> = {
  fleisch: { de: 'Fleisch', tr: 'Et' },
  wurst: { de: 'Wurst & Sucuk', tr: 'Şarküteri' },
  kaese_milch: { de: 'Käse & Milch', tr: 'Süt ürünleri' },
  obst_gemuese: { de: 'Obst & Gemüse', tr: 'Meyve & sebze' },
  grundnahrung: { de: 'Grundnahrung', tr: 'Temel gıda' },
  konserven: { de: 'Konserven & Eingelegtes', tr: 'Konserve & turşu' },
  backwaren: { de: 'Brot & Backwaren', tr: 'Ekmek & unlu mamul' },
  suesses: { de: 'Süßes', tr: 'Tatlı' },
  snacks: { de: 'Snacks & Knabberzeug', tr: 'Atıştırmalık' },
  getraenke: { de: 'Getränke, Tee & Kaffee', tr: 'İçecek, çay & kahve' },
  tiefkuehl: { de: 'Tiefkühl', tr: 'Dondurulmuş' },
  haushalt: { de: 'Haushalt', tr: 'Ev' },
  drogerie: { de: 'Drogerie', tr: 'Kişisel bakım' },
  sonstiges: { de: 'Sonstiges', tr: 'Diğer' },
};
export { CATEGORIES };
export type { Category };

/** Menge in Grundeinheit: Gewicht in g, Volumen in ml, sonst Stück. */
export interface Size {
  /** Packungen im Angebot ("5×140 g" → 5) */
  count: number;
  /** Menge je Packung in der Grundeinheit */
  each: number;
  base: 'g' | 'ml' | 'stk';
  /** Gesamtmenge (count × each) */
  total: number;
  /** schön lesbar, z. B. "700 g (5 × 140 g)" oder "1 kg" */
  label: string;
}

const UNITS: Record<string, { base: Size['base']; f: number }> = {
  g: { base: 'g', f: 1 }, gr: { base: 'g', f: 1 }, kg: { base: 'g', f: 1000 },
  ml: { base: 'ml', f: 1 }, cl: { base: 'ml', f: 10 }, l: { base: 'ml', f: 1000 }, lt: { base: 'ml', f: 1000 }, ltr: { base: 'ml', f: 1000 },
  st: { base: 'stk', f: 1 }, stk: { base: 'stk', f: 1 }, stück: { base: 'stk', f: 1 }, stck: { base: 'stk', f: 1 }, adet: { base: 'stk', f: 1 }, pck: { base: 'stk', f: 1 }, packung: { base: 'stk', f: 1 }, rolle: { base: 'stk', f: 1 }, rollen: { base: 'stk', f: 1 },
};

const num = priceValue;

/** Grundeinheit lesbar: 1500 g → "1,5 kg", 330 ml → "330 ml" */
export function formatAmount(v: number, base: Size['base']): string {
  const de = (x: number) => x.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  if (base === 'g') return v >= 1000 ? `${de(v / 1000)} kg` : `${de(v)} g`;
  if (base === 'ml') return v >= 1000 ? `${de(v / 1000)} l` : `${de(v)} ml`;
  return `${de(v)} Stück`;
}

/**
 * Mengenangabe aus dem Prospekt verstehen: "1 kg", "800 g", "5×140 g", "4 x 1,5 l",
 * "2750 g", "6 Stück", "950 ml". null, wenn nichts Sinnvolles drinsteht.
 */
export function parseSize(unit: string | null | undefined): Size | null {
  if (!unit) return null;
  const s = unit.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(?:(\d+)\s*[x×*]\s*)?(\d+(?:[.,]\d+)?)\s*([a-zäöüß]+)\.?/i);
  if (!m) return null;
  const u = UNITS[m[3]];
  if (!u) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const each = Math.round(num(m[2]) * u.f * 100) / 100;
  if (!each || !count) return null;
  const total = Math.round(count * each * 100) / 100;
  const label = count > 1 ? `${formatAmount(total, u.base)} (${count} × ${formatAmount(each, u.base)})` : formatAmount(total, u.base);
  return { count, each, base: u.base, total, label };
}

/** Grundpreis wie im Laden: "2,99" für 800 g → "3,74 €/kg" */
export function unitPrice(price: string | null | undefined, size: Size | null): string | null {
  if (!price || !size) return null;
  const p = num(price);
  if (!p || !size.total) return null;
  const de = (x: number) => x.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (size.base === 'g') return `${de((p / size.total) * 1000)} €/kg`;
  if (size.base === 'ml') return `${de((p / size.total) * 1000)} €/l`;
  return size.total > 1 ? `${de(p / size.total)} €/Stück` : null;
}

/**
 * "Bester Preis seit X Wochen": Ist der Preis höchstens so hoch wie jeder frühere Preis
 * desselben Produkts (aus früheren Prospekten im Katalog), zählt die Zeitspanne bis zum
 * ältesten Vorkommen. Erst ab 4 Wochen Verlauf, sonst null.
 */
export function bestPriceWeeks(price: string | null | undefined, seen: { price: string | null; from: string | null; job?: string }[] | undefined, from: string, job?: string): number | null {
  const p = priceValue(price);
  if (!p || !seen?.length) return null;
  const before = seen.filter((s) => s.from && s.from < from && s.price && (!job || s.job !== job));
  if (!before.length) return null;
  const min = Math.min(...before.map((s) => priceValue(s.price)).filter((x) => x > 0));
  if (!(p <= min)) return null;
  const oldest = before.map((s) => s.from!).sort()[0];
  const weeks = Math.floor((Date.parse(from) - Date.parse(oldest)) / (7 * 86_400_000));
  return weeks >= 4 ? Math.min(weeks, 104) : null;
}
