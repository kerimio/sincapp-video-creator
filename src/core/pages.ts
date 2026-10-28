import type { Story } from './schema';
import { LAYOUTS, type Format } from './layout';

/**
 * Teilt n Angebote auf Seiten mit 3 oder 2 Angeboten auf, nie 1.
 * Dreierseiten zuerst: 5 = 3+2, 7 = 3+2+2, 8 = 3+3+2.
 */
export function splitPages(n: number): (2 | 3)[] {
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`Mindestens 2 Angebote nötig, bekommen: ${n}`);
  }
  const threes = Math.floor(n / 3);
  const rest = n % 3;
  if (rest === 0) return Array(threes).fill(3);
  if (rest === 2) return [...Array(threes).fill(3), 2];
  // rest 1: eine Dreierseite wird zu zwei Zweierseiten
  return [...Array(threes - 1).fill(3), 2, 2];
}

/** Gruppiert Angebote nach Seitenaufteilung. */
export function paginate<T>(items: T[], pages?: number[]): T[][] {
  const counts = pages ?? splitPages(items.length);
  const out: T[][] = [];
  let i = 0;
  for (const c of counts) {
    out.push(items.slice(i, i + c));
    i += c;
  }
  return out;
}

/** Seiten eines Formats: Story/Feed wie gespeichert (3/2-Regel), Quadrat mit höchstens 2 pro Seite. */
export function pagesFor<T extends Pick<Story, 'offers' | 'pages'>>(story: T, format: Format = 'story'): T['offers'][] {
  // mehrere Märkte: jede Seite gehört genau einem Markt (aufeinanderfolgende Angebote desselben Markts)
  if (story.offers.some((o) => o.market)) return byMarket(story.offers, LAYOUTS[format].perPage);
  if (LAYOUTS[format].perPage === 3) return paginate(story.offers, story.pages);
  const n = story.offers.length;
  const counts = Array<number>(Math.floor(n / 2)).fill(2);
  if (n % 2) counts.push(1);
  return paginate(story.offers, counts);
}

/** Angebote nach Markt gruppieren, große Gruppen auf mehrere Seiten (4 → 2+2, 5 → 3+2, 1 bleibt allein). */
function byMarket<T extends { market?: string }>(offers: T[], perPage: number): T[][] {
  const groups: T[][] = [];
  for (const o of offers) {
    const last = groups.at(-1);
    if (last && last[0].market === o.market) last.push(o);
    else groups.push([o]);
  }
  return groups.flatMap((g) => {
    if (g.length <= perPage) return [g];
    if (perPage === 3) return paginate(g);
    return paginate(g, [...Array(Math.floor(g.length / 2)).fill(2), ...(g.length % 2 ? [1] : [])]);
  });
}
