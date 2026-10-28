import type { Lang, Story } from './schema';
import { resolveDesign } from './design';
import { formatDateRange, turkishLocative } from './format';
import { badgeText } from './badges';
import { cityOf } from './captions';

// Bausteine für die "Zauber"-Funktionen: QR-Code am Schluss, Countdown-Videos und 7-Tage-Plan.
// Alles ohne KI.

// ---------- QR-Code ----------

const QR_LABEL = {
  route: { de: 'Route zum Markt', tr: 'Markete yol tarifi' },
  instagram: { de: 'Auf Instagram', tr: 'Instagram’da' },
  link: { de: 'Mehr bei uns', tr: 'Daha fazlası' },
} as const;

/** Ziel des QR-Codes laut Design, oder null (kein QR-Code). */
export function qrTarget(story: Story, lang: Lang): { url: string; label: string } | null {
  const d = resolveDesign(story.design);
  const m = story.market;
  if (d.qr === 'route') {
    const q = `${m.name}, ${m.addresses[0]}`;
    return { url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, label: QR_LABEL.route[lang] };
  }
  if (d.qr === 'instagram' && m.instagram) return { url: `https://instagram.com/${m.instagram}`, label: QR_LABEL.instagram[lang] };
  if (d.qr === 'link' && d.qrLink) return { url: d.qrLink, label: QR_LABEL.link[lang] };
  return null;
}

// ---------- Datum ----------

const WEEKDAY = {
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  tr: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
};
const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const weekday = (isoDate: string, lang: Lang) => WEEKDAY[lang][day(isoDate).getUTCDay()];
/** "2026-10-29" → "29.10." */
export const shortDate = (isoDate: string) => `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.`;
/** Tage von a bis b (b − a), ganze Kalendertage */
export const daysBetween = (a: string, b: string) => Math.round((day(b).getTime() - day(a).getTime()) / 86_400_000);
export const addDays = (isoDate: string, n: number) => iso(new Date(day(isoDate).getTime() + n * 86_400_000));

// ---------- Countdown ("Letzte Chance") ----------

export const COUNTDOWN_DURATION = 8;

/** Texte für das Countdown-Video; daysLeft = 0 heißt "letzter Tag". */
export function countdownCopy(daysLeft: number, lang: Lang, to: string) {
  const n = Math.max(0, Math.floor(daysLeft));
  if (lang === 'tr') {
    return {
      head: ['Son', 'fırsat'],
      sub: n === 0 ? 'Sadece bugün!' : n === 1 ? 'Sadece yarına kadar!' : `Son ${n} gün!`,
      ring: n === 0 ? 'BUGÜN' : String(n),
      unit: n === 0 ? '' : 'GÜN',
      until: `${weekday(to, 'tr')} gününe kadar`,
    };
  }
  return {
    head: ['Letzte', 'Chance'],
    sub: n === 0 ? 'Nur noch heute!' : n === 1 ? 'Nur noch bis morgen!' : `Nur noch ${n} Tage!`,
    ring: n === 0 ? 'HEUTE' : String(n),
    unit: n === 0 ? '' : n === 1 ? 'TAG' : 'TAGE',
    until: `Nur bis ${weekday(to, 'de')}`,
  };
}

/** Welche Countdown-Videos zur Laufzeit passen: "noch 2 Tage" (wenn Platz) und "heute". */
export function countdownDays(story: Story): number[] {
  const len = daysBetween(story.dates.from, story.dates.to);
  return len >= 3 ? [2, 0] : [0];
}
export const countdownName = (n: number) => (n === 0 ? 'letzte-chance-heute' : `letzte-chance-${n}-tage`);

// ---------- 7-Tage-Plan ----------

export interface PlanDay {
  /** 1-basiert */
  n: number;
  date: string;
  /** Angebot (Index in story.offers) */
  offer: number;
  /** Countdown an diesem Tag (Tage bis Ende), sonst null */
  countdown: number | null;
}

/**
 * Ein Top-Angebot pro Tag (höchstens 7 Posts; bei wenigen Angeboten von vorn).
 * Läuft der Prospekt länger als 7 Tage, sind es die ersten 5 Tage plus der
 * vorletzte-2 und der letzte Tag – so liegen die "Letzte Chance"-Posts im Plan.
 */
export function weekPlan(story: Story, withCountdown = true): PlanDay[] {
  const last = daysBetween(story.dates.from, story.dates.to);
  const offsets = last + 1 <= 7 ? Array.from({ length: Math.max(1, last + 1) }, (_, k) => k) : [0, 1, 2, 3, 4, last - 2, last];
  const cds = withCountdown ? countdownDays(story) : [];
  return offsets.map((off, k) => {
    const left = last - off;
    return { n: k + 1, date: addDays(story.dates.from, off), offer: k % story.offers.length, countdown: cds.includes(left) ? left : null };
  });
}

/** Ordnername eines Plantags: "01-mittwoch-29-10" */
export function planDir(d: PlanDay) {
  const wd = weekday(d.date, 'de').toLowerCase();
  return `${String(d.n).padStart(2, '0')}-${wd}-${d.date.slice(8, 10)}-${d.date.slice(5, 7)}`;
}

const lineName = (lines: string[]) =>
  lines.reduce((acc, l) => (!acc ? l : acc.endsWith('-') ? (/^\p{Lu}/u.test(l) ? acc + l : acc.slice(0, -1) + l.toLowerCase()) : `${acc} ${l}`), '');
const tag = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/ı/g, 'i').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/** Instagram-Text für ein einzelnes Angebot (Reel oder Bild des Tages). */
export function offerCaption(story: Story, index: number, lang: Lang, opts: { countdown?: number | null } = {}): string {
  const o = story.offers[index];
  const m = story.market;
  const unit = typeof o.unit === 'string' ? o.unit : o.unit?.[lang];
  const name = lineName(o.name[lang]);
  const dates = formatDateRange(story.dates.from, story.dates.to);
  const handle = m.instagram ? ` @${m.instagram}` : '';
  const city = cityOf(m.addresses[0] ?? '');
  const cd = opts.countdown != null ? countdownCopy(opts.countdown, lang, story.dates.to).sub : null;
  const badge = o.badge ? ` ${badgeText(o, lang)}!` : '';
  const tags = [...new Set([...(lang === 'de' ? ['angebot', 'sparen', 'supermarkt'] : ['indirim', 'firsat', 'turkmarket']), tag(name.split(' ')[0]), tag(m.name), city ? tag(city) : null, 'sincapp'].filter((x): x is string => !!x))].map((t) => `#${t}`);
  if (lang === 'de') {
    return [
      `${badge ? `${badge.trim()} ` : ''}${name} für nur ${o.price} €${unit ? ` (${unit})` : ''}!`,
      ...(cd ? [cd] : []),
      `Gültig ${dates} bei ${m.name}${handle}`,
      m.addresses.join(' · '),
      "Alle Angebote in der sincapp App. Wissen, wo's günstig ist. 🐿",
      '',
      tags.join(' '),
    ].join('\n');
  }
  return [
    `${badge ? `${badge.trim()} ` : ''}${name} sadece ${o.price} €${unit ? ` (${unit})` : ''}!`,
    ...(cd ? [cd] : []),
    `Geçerlilik: ${dates} – ${turkishLocative(m.name)}${handle}`,
    m.addresses.join(' · '),
    'Tüm fırsatlar sincapp uygulamasında. Ucuzu bilenler. 🐿',
    '',
    tags.join(' '),
  ].join('\n');
}

/** Übersicht des Plans als Text (liegt im ZIP). */
export function planOverview(story: Story, plan: PlanDay[]): string {
  const rows = plan.map((d) => {
    const o = story.offers[d.offer];
    const extra = d.countdown != null ? ` + Countdown „${countdownCopy(d.countdown, 'de', story.dates.to).sub}“` : '';
    return `${weekday(d.date, 'de')}, ${shortDate(d.date)}  →  ${lineName(o.name.de)} (${o.price} €): Reel + Bild${extra}   [Ordner ${planDir(d)}]`;
  });
  return [
    `7-Tage-Plan für ${story.market.name} (${formatDateRange(story.dates.from, story.dates.to)})`,
    '',
    'Jeden Tag ein Top-Angebot: das Reel als Reel oder Story, das Bild als Beitrag. Der passende Text liegt daneben.',
    'Tipp: Zwischen 17 und 19 Uhr sind die meisten online.',
    '',
    ...rows,
    '',
    'Das große Wochenvideo (story-*.mp4) am ersten Tag als Story posten.',
  ].join('\n');
}
