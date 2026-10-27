import { defaultEyebrow } from '../core/format';
import { Market, parseStory, type Story } from '../core/schema';
import { offerKey } from '../extract/normalize';
import type { Category, ExtractedOffer, Extraction } from '../extract/schema';

export interface Topic {
  key: string;
  /** Suchwörter für `--topic` (klein, ohne Umlaute-Sonderfälle). */
  aliases: string[];
  categories: Category[];
  headline: { de: string[]; tr: string[] };
}

/** Themen für `--topic`; die Überschrift passt sich an. */
export const TOPICS: Topic[] = [
  { key: 'fleisch', aliases: ['fleisch', 'wurst', 'et', 'sucuk', 'metzgerei'], categories: ['fleisch', 'wurst'], headline: { de: ['Fleisch-', 'angebote'], tr: ['Et', 'fırsatları'] } },
  { key: 'snacks', aliases: ['snacks', 'snack', 'süßes', 'suesses', 'süßigkeiten', 'atistirmalik'], categories: ['snacks', 'suesses'], headline: { de: ['Snack-', 'angebote'], tr: ['Atıştırmalık', 'fırsatları'] } },
  { key: 'vorrat', aliases: ['vorrat', 'grundnahrung', 'trockenware', 'konserven', 'kiler'], categories: ['grundnahrung', 'konserven'], headline: { de: ['Vorrats-', 'angebote'], tr: ['Kiler', 'fırsatları'] } },
  { key: 'getraenke', aliases: ['getränke', 'getraenke', 'tee', 'kaffee', 'icecek'], categories: ['getraenke'], headline: { de: ['Getränke-', 'angebote'], tr: ['İçecek', 'fırsatları'] } },
  { key: 'frische', aliases: ['frische', 'obst', 'gemüse', 'gemuese', 'manav'], categories: ['obst_gemuese', 'kaese_milch', 'backwaren'], headline: { de: ['Frische-', 'angebote'], tr: ['Taze', 'fırsatlar'] } },
  { key: 'milch', aliases: ['milch', 'käse', 'kaese', 'molkerei', 'süt'], categories: ['kaese_milch'], headline: { de: ['Milch & Käse', 'im Angebot'], tr: ['Süt ürünleri', 'fırsatları'] } },
  { key: 'haushalt', aliases: ['haushalt', 'drogerie', 'reinigung', 'ev'], categories: ['haushalt', 'drogerie'], headline: { de: ['Haushalts-', 'angebote'], tr: ['Ev ürünleri', 'fırsatları'] } },
];

export const DEFAULT_HEADLINE = { de: ['Wochen-', 'angebote'], tr: ['Haftanın', 'fırsatları'] };

export function findTopic(q: string | undefined): Topic | null {
  if (!q) return null;
  const k = q.trim().toLocaleLowerCase('de');
  const t = TOPICS.find((t) => t.key === k || t.aliases.includes(k));
  if (!t) throw new Error(`Unbekanntes Thema "${q}". Möglich: ${TOPICS.map((t) => t.key).join(', ')}`);
  return t;
}

/** Wie gut eignet sich ein Angebot für die Story? Sichere Preise und saubere Bilder zuerst. */
export function offerScore(o: ExtractedOffer) {
  let s = o.confidence;
  if (o.priceConfidence >= 0.9) s += 3;
  if (o.img && !o.warnings.some((w) => w.startsWith('Bild:'))) s += 1;
  if (o.warnings.some((w) => /teilweise|Rand nur/.test(w))) s -= 2;
  return s;
}

export interface SelectOptions {
  topic?: Topic | null;
  /** Standard: 8 (wenn so viele da sind), mindestens 2. */
  count?: number;
}

/**
 * Wählt Angebote aus: ohne Preis fällt raus, Dubletten fallen raus, dann
 * reihum aus den Warengruppen (beste zuerst), damit die Seiten gemischt sind.
 */
export function selectOffers(offers: ExtractedOffer[], opts: SelectOptions = {}) {
  const warnings: string[] = [];
  let pool = offers.filter((o) => o.price);
  if (opts.topic) {
    const cats = new Set(opts.topic.categories);
    pool = pool.filter((o) => cats.has(o.category));
    if (pool.length < 2) throw new Error(`Zum Thema "${opts.topic.key}" gibt es nur ${pool.length} Angebot(e) – mindestens 2 nötig.`);
  }
  const seen = new Set<string>();
  pool = pool.filter((o) => (seen.has(offerKey(o)) ? false : (seen.add(offerKey(o)), true)));
  if (pool.length < 2) throw new Error(`Nur ${pool.length} Angebot(e) mit Preis gefunden – mindestens 2 nötig.`);

  const want = Math.max(2, Math.min(opts.count ?? 8, 15, pool.length));
  if (want < 5 && pool.length < 5) warnings.push(`Nur ${pool.length} Angebote verfügbar – Story wird kürzer als üblich.`);

  const byCat = new Map<string, ExtractedOffer[]>();
  for (const o of [...pool].sort((a, b) => offerScore(b) - offerScore(a))) {
    const list = byCat.get(o.category) ?? [];
    list.push(o);
    byCat.set(o.category, list);
  }
  // Warengruppen nach ihrem besten Angebot ordnen
  const queues = [...byCat.values()].sort((a, b) => offerScore(b[0]) - offerScore(a[0]));
  const picked: ExtractedOffer[] = [];
  while (picked.length < want) {
    for (const q of queues) {
      const o = q.shift();
      if (o) picked.push(o);
      if (picked.length === want) break;
    }
  }
  const unsure = picked.filter((o) => o.priceConfidence < 0.9);
  if (unsure.length) warnings.push(`Preis unsicher bei ${unsure.map((o) => o.id).join(', ')} – im Review prüfen.`);
  return { offers: picked, warnings };
}

export function offerToStory(o: ExtractedOffer) {
  return {
    id: o.id,
    img: o.img ?? `images/${o.id}.png`,
    price: o.price!,
    ...(o.unit ? { unit: o.unit } : {}),
    name: { de: o.lines.de, tr: o.lines.tr },
    ...(o.note ? { note: o.note } : {}),
    imgZoom: 1,
  };
}

/** story.json aus Extraktion, Markt und Auswahl. */
export function buildStory(ex: Extraction, marketRaw: unknown, picked: ExtractedOffer[], topic: Topic | null): { story: Story; warnings: string[] } {
  const warnings: string[] = [];
  const market = Market.parse(marketRaw);
  let dates = ex.validFrom && ex.validTo ? { from: ex.validFrom, to: ex.validTo } : null;
  if (!dates) {
    // Platzhalter: heute + 6 Tage, muss im Review korrigiert werden
    const d = new Date();
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    dates = { from: iso(d), to: iso(new Date(d.getTime() + 6 * 864e5)) };
    warnings.push('Gültigkeitszeitraum fehlt – Platzhalter eingesetzt, bitte im Review korrigieren.');
  }
  const norm = (a: string) => a.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  for (const a of ex.addresses) {
    if (!market.addresses.some((m) => norm(m) === norm(a))) warnings.push(`Adresse "${a}" steht im Prospekt, aber nicht in markets/${market.slug}.json.`);
  }
  if (ex.market && norm(ex.market) !== norm(market.name)) warnings.push(`Prospekt nennt "${ex.market}", gewählter Markt ist "${market.name}".`);
  const story = parseStory({
    version: 1,
    market,
    lang: ['de', 'tr'],
    dates,
    headline: topic?.headline ?? DEFAULT_HEADLINE,
    eyebrow: defaultEyebrow(market.name),
    offers: picked.map(offerToStory),
  });
  return { story, warnings };
}
