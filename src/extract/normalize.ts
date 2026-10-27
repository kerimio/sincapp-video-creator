/** Preise, Einheiten, Daten und Zeilenumbrüche in die Form bringen, die das Template erwartet. */

/**
 * "13.99", "13,99 €", "13.⁹⁹", "13 99" → "13,99". Ganze Euro ("2,-", "2.–") → "2,00".
 * Gibt null zurück, wenn kein Preis erkennbar ist.
 */
export function normalizePrice(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const sup: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  let s = raw.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => sup[c]).replace(/€|eur(o)?/gi, '').trim();
  s = s.replace(/[–—-]+$/, '00').replace(/\s+/g, ' ');
  let m = s.match(/^(\d{1,4})\s*[.,]\s*(\d{2})$/);
  if (!m) m = s.match(/^(\d{1,4}) (\d{2})$/); // hochgestellte Cent als eigene Zahl
  if (!m) {
    const whole = s.match(/^(\d{1,4})$/);
    if (whole) return `${whole[1]},00`;
    return null;
  }
  return `${Number(m[1])},${m[2]}`;
}

/** "5X140 g" → "5×140 g", "1kg" → "1 kg", "950ML" → "950 ml". Leer → null. */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  s = s.replace(/(\d)\s*[xX×*]\s*(\d)/g, '$1×$2');
  s = s.replace(/(\d)\s*(kg|g|mg|ml|cl|l|L|Stk\.?|Stück|St\.)\b/gi, (_, d: string, u: string) => `${d} ${unitCase(u)}`);
  s = s.replace(/(\d)\.(\d)/g, '$1,$2');
  return s;
}

function unitCase(u: string) {
  const l = u.toLowerCase();
  if (l === 'l') return 'l';
  if (l.startsWith('st')) return u.charAt(0).toUpperCase() + u.slice(1).toLowerCase();
  return l;
}

/** "28.10.2026" / "2026-10-28" / "28.10.26" → "2026-10-28". */
export function normalizeDate(raw: string | null | undefined, fallbackYear?: number): string | null {
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return validDate(+iso[1], +iso[2], +iso[3]);
  const de = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?$/);
  if (de) {
    let y = de[3] ? +de[3] : fallbackYear;
    if (y === undefined) return null;
    if (y < 100) y += 2000;
    return validDate(y, +de[2], +de[1]);
  }
  return null;
}

function validDate(y: number, m: number, d: number) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface Wrapped {
  lines: string[];
  truncated: boolean;
}

/**
 * Bricht einen Namen in höchstens `maxLines` Zeilen à `maxChars` Zeichen um.
 * Wortgrenzen und Bindestriche sind Bruchstellen; die Aufteilung mit der
 * kürzesten längsten Zeile gewinnt. Passt der Text nicht, wird mit "…" gekürzt.
 */
export function wrapLines(text: string, maxChars: number, maxLines = 2, truncate = true): Wrapped {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return { lines: [clean], truncated: false };
  // Bruchstellen: nach Leerzeichen (Leerzeichen fällt weg) oder nach "-"
  const tokens = clean.match(/[^\s-]+-?|\s/g)?.filter((t) => t !== ' ') ?? [clean];
  const join = (ts: string[]) => ts.reduce((a, t) => (a === '' ? t : a.endsWith('-') ? a + t : `${a} ${t}`), '');

  let best: string[] | null = null;
  if (maxLines >= 2) {
    for (let i = 1; i < tokens.length; i++) {
      const cand = [join(tokens.slice(0, i)), join(tokens.slice(i))];
      if (cand.every((l) => l.length <= maxChars)) {
        if (!best || Math.max(...cand.map((l) => l.length)) < Math.max(...best.map((l) => l.length))) best = cand;
      }
    }
  }
  if (best) return { lines: best, truncated: false };
  if (!truncate) {
    // ausgewogen auf zwei Zeilen verteilen, auch wenn eine länger wird
    let bal: string[] = [clean];
    for (let i = 1; i < tokens.length && maxLines >= 2; i++) {
      const cand = [join(tokens.slice(0, i)), join(tokens.slice(i))];
      if (bal.length === 1 || Math.max(...cand.map((l) => l.length)) < Math.max(...bal.map((l) => l.length))) bal = cand;
    }
    return { lines: bal, truncated: false };
  }

  // Gierig füllen und den Rest abschneiden
  const lines: string[] = [];
  let cur = '';
  for (const t of tokens) {
    const next = join(cur ? [cur, t] : [t]);
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = t;
    }
  }
  if (cur) lines.push(cur);
  const kept = lines.slice(0, maxLines).map((l) => l.replace(/-$/, ''));
  const last = kept.length - 1;
  if (kept[last].length > maxChars - 1 || lines.length > maxLines || tokens.some((t) => t.length > maxChars)) {
    kept[last] = kept[last].slice(0, maxChars - 1).trimEnd() + '…';
  }
  return { lines: kept.map((l) => (l.length > maxChars ? l.slice(0, maxChars - 1) + '…' : l)), truncated: true };
}

/** Grenzen aus der Spezifikation. */
export const TR_MAX_CHARS = 14;
/** DE wird vom Template über die Schriftgröße eingepasst; das Limit sorgt nur für schöne Umbrüche. */
export const DE_SOFT_CHARS = 16;

/** Gleiche Angebote erkennen (gleiche Marke, gleicher Name, gleicher Preis). */
export function offerKey(o: { brand: string | null; name: { de: string }; price: string | null }) {
  const n = (s: string | null) => (s ?? '').toLocaleLowerCase('de').replace(/[^\p{L}\p{N}]+/gu, '');
  return `${n(o.brand)}|${n(o.name.de)}|${o.price ?? ''}`;
}
