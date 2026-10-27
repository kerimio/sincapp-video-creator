// Easing und Tweens 1:1 aus der Referenz-Engine (animations-v3.jsx).
export type Ease = (t: number) => number;

export const Easing = {
  linear: (t: number) => t,
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  easeOutQuart: (t: number) => 1 - --t * t * t * t,
  easeInOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
} satisfies Record<string, Ease>;

export const MOTION = {
  enter: Easing.easeOutQuart,
  pop: Easing.easeOutBack,
  swipe: Easing.easeInOutCubic,
};

/** Wert zwischen from und to im Zeitfenster [a, b]; davor from, danach to. */
export function tw(T: number, a: number, b: number, from: number, to: number, ease: Ease): number {
  if (T <= a) return from;
  if (T >= b) return to;
  return from + (to - from) * ease((T - a) / (b - a));
}
