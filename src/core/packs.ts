import type { Format } from './layout';

/** Was ein Export-Paket enthält (ohne Sprachen). */
export interface PackOptions {
  videos: Format[];
  reels: number;
  pageImages: Format[];
  offerImages: Format[];
  captions: boolean;
  countdown: boolean;
  plan: boolean;
}

/** Fertige Pakete für den Export; "zauber" nutzt auch der Zauberknopf. */
export const PACKS: { key: string; label: string; hint: string; opts: PackOptions }[] = [
  { key: 'zauber', label: '✨ Alles für die Woche', hint: 'Story- und Feed-Video, 7-Tage-Plan (jeden Tag ein Reel, ein Bild und ein Text), „Letzte Chance“-Videos, Karussell-Bilder', opts: { videos: ['story', 'feed'], reels: 0, pageImages: ['feed'], offerImages: [], captions: true, countdown: true, plan: true } },
  { key: 'woche', label: 'Wochenpaket', hint: 'Story- und Feed-Video, 3 Reels für die Top-Angebote, Karussell-Bilder, jedes Angebot als Bild, Texte', opts: { videos: ['story', 'feed'], reels: 3, pageImages: ['feed'], offerImages: ['feed'], captions: true, countdown: false, plan: false } },
  { key: 'story', label: 'Nur Story', hint: 'Das Video für die Instagram-Story', opts: { videos: ['story'], reels: 0, pageImages: [], offerImages: [], captions: false, countdown: false, plan: false } },
  { key: 'feed', label: 'Feed-Beitrag', hint: 'Video 4:5 und Karussell-Bilder für einen Beitrag, mit Text', opts: { videos: ['feed'], reels: 0, pageImages: ['feed'], offerImages: [], captions: true, countdown: false, plan: false } },
  { key: 'bilder', label: 'Nur Bilder', hint: 'Jedes Angebot einzeln (4:5 und 1:1), schnell fertig', opts: { videos: [], reels: 0, pageImages: [], offerImages: ['feed', 'quadrat'], captions: true, countdown: false, plan: false } },
  { key: 'reels', label: 'Top-Reels', hint: 'Ein 7-Sekunden-Reel pro Top-Angebot (die ersten 3), mit Text', opts: { videos: [], reels: 3, pageImages: [], offerImages: [], captions: true, countdown: false, plan: false } },
  { key: 'endspurt', label: 'Endspurt', hint: '„Letzte Chance“-Videos für die letzten Tage: „Noch 2 Tage!“ und „Nur noch heute!“', opts: { videos: [], reels: 0, pageImages: [], offerImages: [], captions: false, countdown: true, plan: false } },
];
export const MAGIC_PACK = PACKS[0].opts;
