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
