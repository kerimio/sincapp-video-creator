import type { Lang } from './schema';

/** "2026-10-28" + "2026-11-07" → "28.10. – 07.11.2026" (wie in der Referenz). */
export function formatDateRange(from: string, to: string): string {
  const [fy, fm, fd] = from.split('-');
  const [ty, tm, td] = to.split('-');
  const left = fy === ty ? `${fd}.${fm}.` : `${fd}.${fm}.${fy}`;
  return `${left} – ${td}.${tm}.${ty}`;
}

const FRONT_VOWELS = 'eiöüEİÖÜ';
const ALL_VOWELS = 'aeıioöuüAEIİOÖUÜ';
const VOICELESS = 'fstkçşhpFSTKÇŞHP';

/** Türkisches Lokativ-Suffix mit Apostroph: "Saray Market" → "Saray Market’te". */
export function turkishLocative(name: string): string {
  const letters = name.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, '');
  const vowels = [...letters].filter((c) => ALL_VOWELS.includes(c));
  const lastVowel = vowels[vowels.length - 1] ?? 'e';
  const last = letters[letters.length - 1] ?? '';
  const d = VOICELESS.includes(last) ? 't' : 'd';
  const v = FRONT_VOWELS.includes(lastVowel) ? 'e' : 'a';
  return `${name}’${d}${v}`;
}

export function defaultEyebrow(marketName: string): Record<Lang, string> {
  return { de: `Jetzt bei ${marketName}`, tr: `Şimdi ${turkishLocative(marketName)}` };
}

const WEEKDAY: Record<Lang, string[]> = {
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  tr: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
};

/** Wochentag eines Datums (YYYY-MM-DD), z. B. "Samstag" / "Cumartesi". */
export const weekday = (isoDate: string, lang: Lang) => WEEKDAY[lang][new Date(`${isoDate}T12:00:00Z`).getUTCDay()];

/** Namenszeilen fürs Template wieder zu einem Text: ["Knoblauch-", "wurst"] → "Knoblauchwurst". */
export const joinLines = (lines: string[]) =>
  lines.reduce((acc, l) => (!acc ? l : acc.endsWith('-') ? (/^\p{Lu}/u.test(l) ? acc + l : acc.slice(0, -1) + l.toLowerCase()) : `${acc} ${l}`), '');

/** Hashtag-tauglich: ohne Akzente, Leer- und Sonderzeichen ("Saray Market" → "saraymarket"). */
export const hashtag = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/ı/g, 'i').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/** Preis als Zahl: "13,99" und "13.99" → 13.99; leer oder unlesbar → NaN. */
export const priceValue = (p: string | null | undefined) => (p ? Number(p.replace(',', '.')) : NaN);
