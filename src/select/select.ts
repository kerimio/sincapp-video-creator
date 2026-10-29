// Aus allen gelesenen Angeboten die besten für die Story wählen und Überschriften bauen.
import { parseSize } from '../core/catalog';
import { defaultEyebrow, priceValue } from '../core/format';
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

const norm = (s: string) => s.toLocaleLowerCase('de').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();

/** Seite im Original-Prospekt: "work/pages/p2-seite-03.png" → Prospekt "p2", Seite 3 (Seiten ohne Produkte fehlen in der Zählung nicht). */
function prospectPage(o: Pick<ExtractedOffer, 'page' | 'pageFile'>): { prospect: string; n: number } {
  const m = o.pageFile.match(/(?:^|\/)(p\d+-)?seite-(\d+)/);
  return m ? { prospect: m[1] ?? '', n: Number(m[2]) } : { prospect: '', n: o.page };
}

/**
 * Märkte legen die wichtigsten Angebote nach vorn: Titelseite +4, Seite 2 +2,5, Seite 3 +1,5, danach abnehmend,
 * die hinteren Seiten (Restposten, Non-Food) bis −2. Das wiegt mehr als alles andere.
 */
export function pageBoost(n: number, last: number) {
  if (n <= 1) return 4;
  if (n === 2) return 2.5;
  const rel = last > 3 ? (n - 3) / (last - 3) : 0;
  return Number((1.5 - 3.5 * rel).toFixed(2));
}

/**
 * "Beste Angebote": Was vorn im Prospekt steht, ist dem Markt am wichtigsten (siehe pageBoost); was groß
 * abgebildet ist, ist meist ein Hauptangebot (bis +1,5); was in Firestore als Produkt gepflegt ist, ist bewusst ausgewählt (+1).
 */
export function offerBoosts(ex: Pick<Extraction, 'offers' | 'pages'>, firestoreNames: string[] = []): Map<string, number> {
  const names = firestoreNames.map(norm).filter((n) => n.length >= 3);
  const out = new Map<string, number>();
  const last = new Map<string, number>();
  for (const o of ex.offers) {
    const { prospect, n } = prospectPage(o);
    last.set(prospect, Math.max(last.get(prospect) ?? 1, n));
  }
  for (const o of ex.offers) {
    const pg = ex.pages[o.page - 1];
    const area = pg ? ((o.bbox[2] - o.bbox[0]) * (o.bbox[3] - o.bbox[1])) / (pg.width * pg.height) : 0;
    const { prospect, n } = prospectPage(o);
    let b = Math.min(1.5, area * 10) + pageBoost(n, last.get(prospect)!);
    const mine = norm(`${o.brand ?? ''} ${o.name.de} ${o.name.tr}`);
    if (names.some((n) => mine.includes(n) || n.includes(norm(o.name.de)))) b += 1;
    out.set(o.id, b);
  }
  return out;
}

/** Warengruppen, die bei der Auswahl immer Vorrang haben. */
export const MEAT: string[] = ['fleisch', 'wurst'];

/**
 * Wie sehr eine Warengruppe im Wochenvideo zieht: Grundbedarf ja, Nischen kaum.
 * 0 = nur, wenn sonst nichts da ist (z. B. ein Kontaktgrill).
 */
// Süßes und Snacks zuletzt (Chips interessieren im Wochenangebot niemanden), Küchen-Grundbedarf wie Tomatenmark,
// Öl, Reis und Konserven davor. Werte ≤ 0 kommen nur dran, wenn sonst nichts mehr da ist.
export const INTEREST: Record<Category, number> = {
  fleisch: 3, wurst: 1, obst_gemuese: 2, kaese_milch: 2, grundnahrung: 2.5, konserven: 2, getraenke: 1.5, backwaren: 1, tiefkuehl: 1,
  haushalt: 0.5, drogerie: 0.5, suesses: -1, snacks: -1, sonstiges: 0,
};
// Was fast jeder kauft, zieht mehr als ein Nischenprodukt derselben Gruppe ("Reis 5 kg" vor "Tahin")
const STAPLE = /(tomatenmark|paprikamark|salça|salca|kichererbsen|nohut|bohnen|fasulye|hähnchen|haehnchen|hühner|huhn|tavuk|rind|dana|kalb|lamm|kuzu|hack|kıyma|kiyma|sucuk|reis|pirinç|pirinc|mehl|un |zucker|şeker|seker|öl|oel|yağ|yag|butter|eier|yumurta|milch|süt|sut|joghurt|yoğurt|yogurt|ayran|käse|kaese|peynir|tee|çay|cay|kaffee|brot|ekmek|tomate|domates|gurke|salatalık|kartoffel|patates|zwiebel|soğan|sogan|banane|muz|apfel|elma|orange|portakal|wasser|nudeln|makarna|bulgur|linsen|mercimek)/i;
const NICHE = /(olive|zeytin|gewürz|gewuerz|baharat|soße|sosse|sauce|sos |essig|sirke|pul biber|sumak|nane|minze|duft|kerze|grill|maschine|topf|pfanne|deko)/i;

/**
 * Wie günstig ein Angebot ist, ohne KI: Grundpreis (€/kg, €/l) gegen den Median derselben Warengruppe
 * im selben Prospekt bzw. Markt (bis ±1,5). Märkte werden nicht untereinander verglichen.
 */
export function dealScores(offers: ExtractedOffer[], reference: ExtractedOffer[] = offers): Map<string, number> {
  const per = (o: ExtractedOffer) => {
    const size = parseSize(o.unit);
    const p = priceValue(o.price ?? '');
    return size && p && size.total && size.base !== 'stk' ? { key: `${o.category}|${size.base}`, v: p / size.total } : null;
  };
  const groups = new Map<string, number[]>();
  for (const o of reference) {
    const u = per(o);
    if (u) groups.set(u.key, [...(groups.get(u.key) ?? []), u.v]);
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const out = new Map<string, number>();
  for (const o of offers) {
    let d = 0;
    const u = per(o);
    const g = u && groups.get(u.key);
    if (u && g && g.length >= 3) d += Math.max(-1.5, Math.min(1.5, (1 - u.v / median(g)) * 3));
    out.set(o.id, Number(d.toFixed(2)));
  }
  return out;
}

export interface SelectOptions {
  topic?: Topic | null;
  /** Zusatzpunkte je Angebot (id → Punkte), z. B. vorn oder groß im Prospekt oder in Firestore gepflegt. */
  boost?: Map<string, number>;
  /** Standard: 8 (wenn so viele da sind), mindestens 2. */
  count?: number;
  /** Vergleichsmenge für „günstig“ (Grundpreis-Median); Standard: die Angebote selbst */
  reference?: ExtractedOffer[];
  /**
   * Seite eines Markts: so viele große Plätze vorn, nur mit frischem Fleisch (keine Wurst, kein Sucuk);
   * fehlt frisches Fleisch, kommen dort die besten anderen Angebote hin.
   */
  freshMeat?: number;
  /** weniger als so viele Angebote ist ein Fehler (Standard 2) */
  min?: number;
}

/**
 * Wählt Angebote nach festem Konzept: die Hälfte Fleisch (frisches Fleisch vor Wurst), die andere Hälfte
 * „Preis-Knaller“ aus dem Grundbedarf – günstig im Vergleich, vorn im Prospekt, aus verschiedenen Warengruppen.
 * Nischen (Oliven, Gewürze, Haushalt) nur, wenn nichts Besseres da ist. Mit Thema: die besten des Themas, gemischt.
 */
export function selectOffers(offers: ExtractedOffer[], opts: SelectOptions = {}) {
  const warnings: string[] = [];
  let pool = offers.filter((o) => o.price);
  const min = opts.min ?? 2;
  if (opts.topic) {
    const cats = new Set(opts.topic.categories);
    pool = pool.filter((o) => cats.has(o.category));
    if (pool.length < min) throw new Error(`Zum Thema "${opts.topic.key}" gibt es nur ${pool.length} Angebot(e) – mindestens ${min} nötig.`);
  }
  // Dubletten (gleiches Produkt, gleicher Preis, gleicher Markt) nur einmal
  const seen = new Set<string>();
  const key = (o: ExtractedOffer) => `${o.market ?? ''}|${offerKey(o)}`;
  pool = pool.filter((o) => (seen.has(key(o)) ? false : (seen.add(key(o)), true)));
  if (pool.length < min) throw new Error(`Nur ${pool.length} Angebot(e) mit Preis gefunden – mindestens ${min} nötig.`);

  const want = Math.max(min, Math.min(opts.count ?? 8, pool.length));
  if (want < 5 && pool.length < 5) warnings.push(`Nur ${pool.length} Angebote verfügbar – Story wird kürzer als üblich.`);

  const deal = dealScores(pool, opts.reference ?? pool);
  const base = (o: ExtractedOffer) => offerScore(o) + (opts.boost?.get(o.id) ?? 0) + (deal.get(o.id) ?? 0);
  const text = (o: ExtractedOffer) => `${o.brand ?? ''} ${o.name.de} ${o.name.tr}`;
  const picked: ExtractedOffer[] = [];
  const take = (list: ExtractedOffer[], n: number, score: (o: ExtractedOffer) => number, ok: (o: ExtractedOffer) => boolean = () => true) => {
    for (const o of [...list].sort((a, b) => score(b) - score(a))) {
      if (picked.length >= want || n <= 0) break;
      if (picked.includes(o) || !ok(o)) continue;
      picked.push(o);
      n--;
    }
  };

  if (opts.topic) {
    // Thema: reihum aus den Warengruppen des Themas, beste zuerst
    const byCat = new Map<string, ExtractedOffer[]>();
    for (const o of [...pool].sort((a, b) => base(b) - base(a))) byCat.set(o.category, [...(byCat.get(o.category) ?? []), o]);
    const queues = [...byCat.values()].sort((a, b) => base(b[0]) - base(a[0]));
    while (picked.length < want && queues.some((q) => q.length)) for (const q of queues) if (q.length && picked.length < want) picked.push(q.shift()!);
  } else if (opts.freshMeat != null) {
    // Seite eines Markts: vorn groß frisches Fleisch (Hähnchen, Hack … vor Spezialitäten), Wurst und Sucuk nicht bevorzugt
    const fresh = pool.filter((o) => o.category === 'fleisch');
    const rest = pool.filter((o) => o.category !== 'fleisch');
    const meatScore = (o: ExtractedOffer) => base(o) + (STAPLE.test(text(o)) ? 0.5 : 0);
    const dealScore = (o: ExtractedOffer) => base(o) + (deal.get(o.id) ?? 0) + INTEREST[o.category] + (STAPLE.test(text(o)) ? 1 : 0) - (NICHE.test(text(o)) ? 2 : 0);
    take(fresh, opts.freshMeat, meatScore);
    // zu wenig frisches Fleisch: die großen Plätze bekommen die besten anderen Angebote – Wurst nur, wenn sonst nichts da ist
    take(rest, opts.freshMeat - picked.length, dealScore, (o) => o.category !== 'wurst' && INTEREST[o.category] > 0 && !NICHE.test(text(o)));
    take(rest, opts.freshMeat - picked.length, dealScore);
    const cats = () => new Set(picked.map((p) => p.category));
    take([...rest, ...fresh], want, dealScore, (o) => INTEREST[o.category] > 0 && !NICHE.test(text(o)) && !cats().has(o.category));
    take([...rest, ...fresh], want, dealScore, (o) => INTEREST[o.category] > 0);
    take([...rest, ...fresh], want, dealScore);
  } else {
    // 1. Hälfte Fleisch: frisches Fleisch vor Wurst, Grundbedarf (Hähnchen, Hack …) vor Spezialitäten
    const meat = pool.filter((o) => MEAT.includes(o.category));
    const meatScore = (o: ExtractedOffer) => base(o) + (o.category === 'fleisch' ? 0.5 : 0) + (STAPLE.test(text(o)) ? 0.5 : 0);
    const meatN = Math.min(Math.max(1, Math.floor(want / 2)), meat.length);
    take(meat, Math.ceil(meatN / 2), meatScore);
    // höchstens die Hälfte der Fleisch-Plätze Wurst, solange frisches Fleisch da ist
    const wurstCap = Math.floor(meatN / 2);
    take(meat, meatN - picked.length, meatScore, (o) => o.category === 'fleisch' || picked.filter((p) => p.category === 'wurst').length < wurstCap);
    take(meat, meatN - picked.length, meatScore);
    // 2. Preis-Knaller: günstig zählt doppelt, Grundbedarf vor Nische, jede Warengruppe erst einmal
    const rest = pool.filter((o) => !MEAT.includes(o.category));
    const dealScore = (o: ExtractedOffer) => base(o) + (deal.get(o.id) ?? 0) + INTEREST[o.category] + (STAPLE.test(text(o)) ? 1 : 0) - (NICHE.test(text(o)) ? 2 : 0);
    const cats = () => new Set(picked.map((p) => p.category));
    take(rest, want, dealScore, (o) => INTEREST[o.category] > 0 && !NICHE.test(text(o)) && !cats().has(o.category));
    take(rest, want, dealScore, (o) => INTEREST[o.category] > 0);
    take([...rest, ...meat], want, dealScore);
  }
  const unsure = picked.filter((o) => o.priceConfidence < 0.9);
  if (unsure.length) warnings.push(`Preis unsicher bei ${unsure.map((o) => o.id).join(', ')} – im Review prüfen.`);
  return { offers: picked, warnings };
}

/** Angebote je Markt im Video: eine Seite mit 5 – oben 2× frisches Fleisch groß, darunter 3 weitere klein. */
export const PER_MARKET = 5;
/** davon große Plätze für frisches Fleisch */
export const FRESH_MEAT = 2;

/**
 * Video aus mehreren Märkten: jeder Markt kommt rein, mit seiner Seite (siehe PER_MARKET), in der Reihenfolge der Märkte.
 * Märkte werden nicht verglichen – jeder zeigt seine wichtigsten Angebote, auch wenn ein anderer dasselbe günstiger hat.
 * Ein Markt ohne Angebot mit Preis fehlt und steht in den Hinweisen.
 */
export function selectByMarket(offers: ExtractedOffer[], markets: string[], opts: Omit<SelectOptions, 'count'> & { per?: number } = {}) {
  const per = opts.per ?? PER_MARKET;
  const offersOut: ExtractedOffer[] = [];
  const warnings: string[] = [];
  const pool = offers.filter((o) => o.price);
  for (const m of markets) {
    const mine = pool.filter((o) => o.market === m);
    if (!mine.length) {
      warnings.push(`${m}: kein Angebot mit Preis erkannt – nicht im Video`);
      continue;
    }
    const sel = selectOffers(mine, { ...opts, reference: mine, count: per, freshMeat: opts.freshMeat ?? FRESH_MEAT, min: 1 });
    offersOut.push(...sel.offers);
    warnings.push(...sel.warnings.filter((w) => !/Story wird kürzer/.test(w)));
    if (sel.offers.length < per) warnings.push(`${m}: nur ${sel.offers.length} Angebot(e) mit Preis`);
  }
  if (offersOut.length < 2) throw new Error('Zu wenige Angebote mit Preis in den gewählten Prospekten.');
  return { offers: offersOut, warnings };
}

export function offerToStory(o: ExtractedOffer) {
  return {
    id: o.id,
    img: o.img ?? `images/${o.id}.png`,
    price: o.price!,
    ...(o.unit ? { unit: o.unit } : {}),
    name: { de: o.lines.de, tr: o.lines.tr },
    ...(o.note ? { note: o.note } : {}),
    ...(o.market ? { market: o.market } : {}),
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
    if (!market.addresses.some((m) => norm(m) === norm(a))) warnings.push(`Adresse "${a}" steht im Prospekt, aber nicht bei ${market.name} hinterlegt.`);
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
