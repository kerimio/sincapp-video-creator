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
