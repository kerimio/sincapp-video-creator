// Textbreiten messen (Canvas), damit Namen und Adressen nie überlaufen.
// Läuft erst, nachdem die Fonts geladen sind, und ist damit deterministisch.
let ctx: CanvasRenderingContext2D | null = null;

export interface TextStyle {
  weight: number;
  size: number;
  /** Laufweite in em, z. B. -0.035 */
  tracking?: number;
  upper?: boolean;
  lang: string;
}

export function textWidth(text: string, s: TextStyle): number {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 0;
  ctx.font = `${s.weight} ${s.size}px Archivo`;
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(s.tracking ?? 0) * s.size}px`;
  const t = s.upper ? text.toLocaleUpperCase(s.lang) : text;
  return ctx.measureText(t).width;
}

/** Größte Schriftgröße ≤ size, bei der alle Zeilen in maxWidth passen. */
export function fitSize(lines: string[], maxWidth: number, s: TextStyle, min = 20): number {
  let size = s.size;
  while (size > min && Math.max(...lines.map((l) => textWidth(l, { ...s, size }))) > maxWidth) size -= 1;
  return size;
}
