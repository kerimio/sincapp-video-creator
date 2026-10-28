import type { BADGES, Lang } from './schema';

export type Badge = (typeof BADGES)[number];

/** Sticker-Texte je Sprache – kurz, damit sie auf die Karte passen. */
export const BADGE_TEXT: Record<Badge, Record<Lang, string>> = {
  knaller: { de: 'Knaller!', tr: 'Süper fiyat!' },
  woche: { de: 'Nur diese Woche', tr: 'Sadece bu hafta' },
  neu: { de: 'Neu', tr: 'Yeni' },
  halal: { de: 'Halal', tr: 'Helal' },
  bio: { de: 'Bio', tr: 'Organik' },
  bestpreis: { de: 'Bestpreis', tr: 'En iyi fiyat' },
  frisch: { de: 'Frisch', tr: 'Taze' },
  aktion: { de: 'Aktion', tr: 'Kampanya' },
  vorrat: { de: 'Solange Vorrat reicht', tr: 'Stoklarla sınırlı' },
  xxl: { de: 'XXL-Packung', tr: 'Büyük boy' },
};

const WEEKDAY = {
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  tr: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
};

/** Vorschläge fürs Laufband; der erste nennt den letzten Gültigkeitstag. */
export function bannerSuggestions(to: string): { de: string; tr: string }[] {
  const d = new Date(`${to}T12:00:00Z`).getUTCDay();
  return [
    { de: `Nur bis ${WEEKDAY.de[d]}!`, tr: `Sadece ${WEEKDAY.tr[d]} gününe kadar!` },
    { de: 'Solange der Vorrat reicht', tr: 'Stoklarla sınırlı' },
    { de: 'Diese Woche günstig', tr: 'Bu hafta ucuz' },
    { de: 'Neue Woche – neue Angebote', tr: 'Yeni hafta – yeni fırsatlar' },
    { de: 'Frisch eingetroffen', tr: 'Yeni geldi' },
  ];
}
