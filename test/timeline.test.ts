import { describe, expect, it } from 'vitest';
import { buildScenes, deriveTimeline, warp } from '../src/core/timeline';

const tl = deriveTimeline(buildScenes(2, { intro: 3.6, page: 4.5, cta: 6 }));

describe('timeline', () => {
  it('entspricht der Referenz (2 Seiten)', () => {
    expect(tl.total).toBe(18.6);
    expect(tl.authoredTotal).toBe(22.6);
    expect(tl.cues).toEqual({ Intro: 0, S1: 3.6, S2: 10.1, CTA: 16.6 });
  });

  it('streckt Angebotsseiten (6,5 s Choreografie in 4,5 s)', () => {
    expect(warp(tl, 3.6)).toBeCloseTo(3.6);
    expect(warp(tl, 3.6 + 4.5 / 2)).toBeCloseTo(3.6 + 3.25);
    expect(warp(tl, 8.1)).toBeCloseTo(10.1);
  });

  it('bleibt am Ende stehen', () => {
    expect(warp(tl, 100)).toBe(22.6);
    expect(warp(tl, -1)).toBe(0);
  });

  it('8 Angebote → 3 Seiten → 23,1 s', () => {
    expect(deriveTimeline(buildScenes(3, { intro: 3.6, page: 4.5, cta: 6 })).total).toBe(23.1);
  });
});
