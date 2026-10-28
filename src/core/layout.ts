/**
 * Maße je Format. "story" sind exakt die Werte der Referenz (1080×1920);
 * "feed" (Instagram-Beitrag 4:5) und "quadrat" (1:1) sind daraus abgeleitet.
 */
export type Format = 'story' | 'feed' | 'quadrat';

export interface Layout {
  W: number;
  H: number;
  /** höchstens so viele Angebote pro Seite */
  perPage: 2 | 3;
  intro: {
    lockTop: number;
    lockScale: number;
    headTop: number;
    head: number;
    eyebrow: number;
    chipTop: number;
    chipScale: number;
    infoTop: number;
    infoGap: number;
    pillH: number;
    pillFont: number;
    cal: number;
    addr: number;
    insta: number;
  };
  page: {
    lockTop: number;
    lockScale: number;
    chipTop: number;
    chipScale: number;
    infoTop: number;
    infoBottom: number;
    rowTop: number;
    rowH: number;
    rowGap: number;
    /** zwei Angebote auf einer Seite als große Karten (sonst als normale Zeilen) */
    bigPairs: boolean;
    bigH: number;
    bigName: number;
    imgCol: number;
    nameMax: number;
    tagScale: number;
    circle: number;
    revealY: number;
    /** Laufband unten */
    bannerTop: number;
    bannerH: number;
  };
  cta: {
    lockTop: number;
    headTop: number;
    size: number;
    gap: number;
    btnW: number;
    btnH: number;
    btnFont: number;
    phoneTop: number;
    revealY: number;
  };
}

export const LAYOUTS: Record<Format, Layout> = {
  story: {
    W: 1080, H: 1920, perPage: 3,
    intro: { lockTop: 250, lockScale: 1.7, headTop: 470, head: 110, eyebrow: 30, chipTop: 900, chipScale: 1.35, infoTop: 1230, infoGap: 24, pillH: 100, pillFont: 40, cal: 44, addr: 40, insta: 44 },
    page: { lockTop: 150, lockScale: 1, chipTop: 280, chipScale: 0.62, infoTop: 262, infoBottom: 488, rowTop: 500, rowH: 380, rowGap: 28, bigPairs: true, bigH: 600, bigName: 66, imgCol: 340, nameMax: 56, tagScale: 1, circle: 200, revealY: 560, bannerTop: 1764, bannerH: 96 },
    cta: { lockTop: 150, headTop: 280, size: 96, gap: 52, btnW: 700, btnH: 124, btnFont: 44, phoneTop: 1030, revealY: 1500 },
  },
  feed: {
    W: 1080, H: 1350, perPage: 3,
    intro: { lockTop: 100, lockScale: 1.5, headTop: 280, head: 100, eyebrow: 28, chipTop: 640, chipScale: 1.1, infoTop: 920, infoGap: 20, pillH: 92, pillFont: 36, cal: 40, addr: 34, insta: 38 },
    page: { lockTop: 60, lockScale: 0.9, chipTop: 140, chipScale: 0.5, infoTop: 112, infoBottom: 284, rowTop: 296, rowH: 316, rowGap: 22, bigPairs: true, bigH: 485, bigName: 60, imgCol: 290, nameMax: 50, tagScale: 0.86, circle: 176, revealY: 420, bannerTop: 1298, bannerH: 52 },
    cta: { lockTop: 80, headTop: 170, size: 82, gap: 48, btnW: 640, btnH: 112, btnFont: 40, phoneTop: 860, revealY: 1050 },
  },
  quadrat: {
    W: 1080, H: 1080, perPage: 2,
    intro: { lockTop: 60, lockScale: 1.3, headTop: 200, head: 86, eyebrow: 26, chipTop: 520, chipScale: 0.9, infoTop: 750, infoGap: 18, pillH: 84, pillFont: 34, cal: 38, addr: 30, insta: 34 },
    page: { lockTop: 44, lockScale: 0.82, chipTop: 112, chipScale: 0.44, infoTop: 70, infoBottom: 236, rowTop: 250, rowH: 380, rowGap: 24, bigPairs: false, bigH: 784, bigName: 66, imgCol: 340, nameMax: 56, tagScale: 0.92, circle: 190, revealY: 330, bannerTop: 1040, bannerH: 40 },
    cta: { lockTop: 60, headTop: 130, size: 72, gap: 44, btnW: 600, btnH: 104, btnFont: 38, phoneTop: 760, revealY: 850 },
  },
};
