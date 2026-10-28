// Sticker auf Angeboten (z. B. „Bester Preis seit 6 Wochen“) als Text in DE und TR.
import type { BADGES, Lang } from './schema';
import { weekday } from './format';

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

/** Sticker-Text fürs Angebot, beim Bestpreis mit Zeitraum für Bildtexte ("Bester Preis seit 8 Wochen"). */
export function badgeText(o: { badge?: Badge; bestWeeks?: number }, lang: Lang): string | null {
  if (!o.badge) return null;
  if (o.badge === 'bestpreis' && o.bestWeeks) return lang === 'de' ? `Bester Preis seit ${o.bestWeeks} Wochen` : `Son ${o.bestWeeks} haftanın en iyi fiyatı`;
  return BADGE_TEXT[o.badge][lang];
}

/** Vorschläge fürs Laufband; der erste nennt den letzten Gültigkeitstag. */
export function bannerSuggestions(to: string): { de: string; tr: string }[] {
  return [
    { de: `Nur bis ${weekday(to, 'de')}!`, tr: `Sadece ${weekday(to, 'tr')} gününe kadar!` },
    { de: 'Solange der Vorrat reicht', tr: 'Stoklarla sınırlı' },
    { de: 'Diese Woche günstig', tr: 'Bu hafta ucuz' },
    { de: 'Neue Woche – neue Angebote', tr: 'Yeni hafta – yeni fırsatlar' },
    { de: 'Frisch eingetroffen', tr: 'Yeni geldi' },
  ];
}
