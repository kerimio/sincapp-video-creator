/**
 * Zeitachse wie in der Referenz-Engine (animations-v3): Jede Szene hat eine
 * Abspieldauer (dur) und eine choreografierte Länge (nat). Innerhalb einer
 * Szene läuft die Choreografie-Zeit T mit nat/dur-facher Geschwindigkeit.
 */

export interface Scene {
  name: string;
  dur: number;
  nat: number;
}

/** Choreografierte Längen aus der Referenz. */
export const NAT = { intro: 3.6, page: 6.5, cta: 6 } as const;

export interface Durations {
  intro: number;
  page: number;
  cta: number;
}

export function buildScenes(pageCount: number, d: Durations): Scene[] {
  const scenes: Scene[] = [{ name: 'Intro', dur: d.intro, nat: NAT.intro }];
  for (let i = 0; i < pageCount; i++) scenes.push({ name: `S${i + 1}`, dur: d.page, nat: NAT.page });
  scenes.push({ name: 'CTA', dur: d.cta, nat: NAT.cta });
  return scenes;
}

interface Section extends Scene {
  playStart: number;
  authStart: number;
}

export interface Timeline {
  sections: Section[];
  cues: Record<string, number>;
  /** Abspieldauer in Sekunden. */
  total: number;
  authoredTotal: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function deriveTimeline(scenes: Scene[]): Timeline {
  let playStart = 0;
  let authStart = 0;
  const sections: Section[] = [];
  const cues: Record<string, number> = {};
  for (const s of scenes) {
    sections.push({ ...s, playStart, authStart });
    if (!(s.name in cues)) cues[s.name] = r3(authStart);
    playStart += s.dur;
    authStart += s.nat;
  }
  return { sections, cues, total: r3(playStart), authoredTotal: r3(authStart) };
}

/** Abspielzeit t (Sekunden) → Choreografie-Zeit T. */
export function warp(tl: Timeline, t: number): number {
  const ss = tl.sections;
  if (ss.length === 0) return 0;
  let idx = ss.length - 1;
  for (let i = 0; i < ss.length; i++) {
    if (t < ss[i].playStart + ss[i].dur) {
      idx = i;
      break;
    }
  }
  const s = ss[idx];
  const local = Math.min(Math.max(t - s.playStart, 0), s.dur);
  const T = s.authStart + (s.dur > 0 ? local * (s.nat / s.dur) : 0);
  return Math.min(T, tl.authoredTotal);
}
