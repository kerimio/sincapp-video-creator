// sincapp Werbevideo, portiert aus reference/story-saray.jsx.
// Im Design "klassik" und Format "story" (1080×1920) sind Maße, Farben, Timing und
// Animationen exakt die der Referenz; Designs und Formate variieren davon ausgehend.
// Alle Inhalte kommen aus story.json.
import type { CSSProperties, ReactNode } from 'react';
import type { Lang, Offer, Story } from '../core/schema';
import { pagesFor } from '../core/pages';
import { formatDateRange, defaultEyebrow } from '../core/format';
import { pageMode, resolveDesign, rgba, textOn, type Palette, type PageMode, type ResolvedDesign } from '../core/design';
import { LAYOUTS, type Format, type Layout } from '../core/layout';
import { Easing, MOTION, tw } from './motion';
import { fitSize, textWidth } from './fit';

const COPY = {
  tr: {
    cta: [{ t: 'Ve çok daha', up: true }, { t: 'fazla fırsat', up: true }, { t: 'sincapp’ta', red: true }],
    btn: 'Şimdi indir',
  },
  de: {
    cta: [{ t: 'Viele weitere', up: true }, { t: 'Angebote', up: true }, { t: 'bei sincapp', red: true }],
    btn: 'Jetzt laden',
  },
} as const;

interface PageTheme {
  bg: string;
  mode: PageMode;
  white?: boolean;
  dark?: boolean;
  tagBg: string;
  tagTx: string;
  shadow: string;
  /** Phasenversatz fürs Wippen; entspricht in der Referenz der Länge des Theme-Namens ("saray"/"sarayDark"). */
  phase: number;
}
/** Phasen der Referenz für die erste und zweite Seitenfarbe. */
const PHASES = [5 * 0.7, 9 * 0.7];

function shadowFor(bg: string, mode: PageMode): string {
  if (mode === 'dark') return '0 24px 60px rgba(0,0,0,.35)';
  if (mode === 'light') return '0 18px 44px rgba(41,32,25,.14)';
  // Referenz: Rot #C24A18 → rgba(80,20,0,.35); andere Farben entsprechend abgedunkelt
  if (bg.toUpperCase() === '#C24A18') return '0 24px 60px rgba(80,20,0,.35)';
  const [r, g, b] = [1, 3, 5].map((i) => Math.round(parseInt(bg.slice(i, i + 2), 16) * 0.4));
  return `0 24px 60px rgba(${r},${g},${b},.35)`;
}

export function pageTheme(bg: string, c: Palette, phase: number): PageTheme {
  const mode = pageMode(bg, c.ink);
  const tagBg = mode === 'dark' ? c.accent2 : c.accent;
  return { bg, mode, white: mode === 'white', dark: mode === 'dark', tagBg, tagTx: textOn(tagBg, c.ink), shadow: shadowFor(bg, mode), phase };
}

/** Alles, was die Komponenten über das Aussehen wissen müssen. */
interface Look {
  d: ResolvedDesign;
  c: Palette;
  L: Layout;
}

export interface Urls {
  job: (p: string) => string;
  market: (p: string) => string;
  asset: (p: string) => string;
}

export interface StoryProps {
  story: Story;
  lang: Lang;
  format?: Format;
  /** Choreografie-Zeit (siehe core/timeline.ts) */
  T: number;
  cues: Record<string, number>;
  logoSize: { w: number; h: number };
  urls: Urls;
}

/**
 * Namenszeilen zu einem Text: "Rinder-" + "mett" → "Rindermett",
 * "Ceylon-" + "Schwarztee" → "Ceylon-Schwarztee".
 */
export function joinName(lines: string[]): string {
  return lines.reduce((acc, l) => {
    if (!acc) return l;
    if (acc.endsWith('-')) return /^\p{Lu}/u.test(l) ? acc + l : acc.slice(0, -1) + l;
    return `${acc} ${l}`;
  }, '');
}

const abs = (s: CSSProperties): CSSProperties => ({ position: 'absolute', ...s });
const unitOf = (o: Offer, lang: Lang) => (typeof o.unit === 'string' ? o.unit : o.unit?.[lang]);

function MarketLogo({ story, logoSize, urls }: Pick<StoryProps, 'story' | 'logoSize' | 'urls'>) {
  const m = story.market;
  const crop = m.logoCrop ?? { w: logoSize.w, h: logoSize.h, offsetX: 0, offsetY: 0 };
  const boxW = 380;
  const boxH = 175;
  const s = Math.min(boxW / crop.w, boxH / crop.h);
  return (
    <div style={{ width: crop.w * s, height: crop.h * s, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
      <img
        src={urls.market(m.logo)}
        alt={m.name}
        style={{ position: 'absolute', left: -crop.offsetX * s, top: -crop.offsetY * s, width: logoSize.w * s, height: logoSize.h * s, display: 'block', maxWidth: 'none' }}
      />
    </div>
  );
}

function MarketChip({ style, ...p }: Pick<StoryProps, 'story' | 'logoSize' | 'urls'> & { style: CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute', width: 420, height: 200, boxSizing: 'border-box', background: '#fff', overflow: 'hidden',
        borderRadius: 40, border: '2px solid rgba(41,32,25,.08)', boxShadow: '0 10px 30px rgba(41,32,25,.10)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', transformOrigin: '0 0',
        ...style,
      }}
    >
      <MarketLogo {...p} />
    </div>
  );
}

function Lockup({ dark, white, h = 64, urls }: { dark?: boolean; white?: boolean; h?: number; urls: Urls }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: h * 0.16 }}>
      <img src={urls.asset(white ? 'logo/marke-white.svg' : 'logo/marke-red.svg')} alt="" style={{ height: h, width: 'auto', display: 'block' }} />
      <img src={urls.asset(dark || white ? 'logo/wortmarke-weiss.svg' : 'logo/wortmarke-dunkel-rot.svg')} alt="sincapp" style={{ height: h * 0.74, width: 'auto', display: 'block' }} />
    </div>
  );
}

function Pill({ light, white, value, urls, c }: { light: boolean; white?: boolean; value: string; urls: Urls; c: Palette }) {
  return (
    <div
      style={{
        position: 'relative', height: 76, padding: '0 30px 0 24px', borderRadius: 999, boxSizing: 'border-box',
        border: white ? '2px solid rgba(255,255,255,.45)' : light ? '2px solid rgba(250,246,241,.28)' : `2px solid ${rgba(c.ink, 0.18)}`,
        display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap',
      }}
    >
      <img src={urls.asset('icons/calendar.svg')} alt="" style={{ width: 32, height: 32, display: 'block', ...(light ? { filter: 'invert(1) brightness(2)' } : {}) }} />
      <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.01em', color: light ? '#FAF6F1' : c.ink }}>{value}</span>
    </div>
  );
}

// Header rechts: Datum, Adresse(n), @handle. Muss oberhalb der Karten enden.
function addressSize(addresses: string[], lang: Lang, L: Layout, insta: boolean): number {
  for (let size = 24; size > 16; size--) {
    const lines = addresses.reduce((n, a) => n + Math.ceil(textWidth(a, { weight: 600, size, lang }) / 560), 0);
    const height = 76 + 10 + lines * size * 1.25 + (insta ? 10 + 26 * 1.2 : 0);
    if (L.page.infoTop + height <= L.page.infoBottom) return size;
  }
  return 16;
}

function MarketInfo({ theme, dates, story, lang, hd, urls, look }: { theme: PageTheme; dates: string; story: Story; lang: Lang; hd: number; urls: Urls; look: Look }) {
  const { c, L } = look;
  const light = !!(theme.dark || theme.white);
  const size = addressSize(story.market.addresses, lang, L, !!story.market.instagram);
  return (
    <div style={{ position: 'absolute', right: 90, top: L.page.infoTop, width: 600, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, transform: `translateX(${hd * 760}px)` }}>
      <Pill light={light} white={theme.white} value={dates} urls={urls} c={c} />
      <div style={{ maxWidth: 560, textAlign: 'right', fontSize: size, fontWeight: 600, lineHeight: 1.25, color: light ? '#FAF6F1' : c.ink2, textWrap: 'balance' } as CSSProperties}>
        {story.market.addresses.map((a, i) => <div key={i}>{a}</div>)}
      </div>
      {story.market.instagram && <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em', color: light ? (theme.white ? '#fff' : c.accent2) : c.accent }}>@{story.market.instagram}</div>}
    </div>
  );
}

function PriceTag({ o, lang, theme, p, look }: { o: Offer; lang: Lang; theme: PageTheme; p: number; look: Look }) {
  const unit = unitOf(o, lang);
  const flat = look.d.price === 'flach';
  const k = look.L.page.tagScale;
  return (
    <div style={{ alignSelf: 'flex-start', marginTop: 10 * k, display: 'flex', alignItems: 'stretch', gap: 18, padding: flat ? `${12 * k}px ${22 * k}px ${10 * k}px` : '12px 24px 10px', borderRadius: flat ? 10 : 24, background: theme.tagBg, color: theme.tagTx, transform: flat ? `scale(${p})` : k === 1 ? `scale(${p}) rotate(-3deg)` : `scale(${p * k}) rotate(-3deg)`, transformOrigin: '0 50%', boxShadow: flat ? 'none' : '0 8px 18px rgba(41,32,25,.18)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, lineHeight: 0.9 }}>
        <span style={{ fontSize: flat ? 80 * k : 80, fontWeight: 900, letterSpacing: '-0.05em' }}>{o.price}</span>
        <span style={{ fontSize: flat ? 40 * k : 40, fontWeight: 900, marginBottom: 4 }}>€</span>
        {unit && <span style={{ fontSize: flat ? 28 * k : 28, fontWeight: 800, marginLeft: 8, marginBottom: 8, whiteSpace: 'nowrap' }}>{unit}</span>}
      </div>
    </div>
  );
}

/** Runder Preis-Sticker, sitzt auf der Kartenecke. */
function PriceCircle({ o, lang, theme, p, size }: { o: Offer; lang: Lang; theme: PageTheme; p: number; size: number }) {
  const unit = unitOf(o, lang);
  const [eur, ct] = o.price.split(',');
  const f = size / 200;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: theme.tagBg, color: theme.tagTx, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transform: `scale(${p}) rotate(-8deg)`, boxShadow: '0 10px 24px rgba(41,32,25,.25)', border: `${Math.round(6 * f)}px solid ${theme.tagTx === '#ffffff' ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.6)'}`, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', lineHeight: 0.85, fontWeight: 900, letterSpacing: '-0.05em' }}>
        <span style={{ fontSize: (eur.length > 2 ? 64 : 84) * f }}>{eur}</span>
        <span style={{ fontSize: 40 * f, marginTop: 4 * f }}>,{ct}</span>
      </div>
      <div style={{ fontSize: 24 * f, fontWeight: 800, marginTop: 6 * f, whiteSpace: 'nowrap' }}>€{unit ? ` ${unit}` : ''}</div>
    </div>
  );
}

function OfferRow({ o, k, n, s, T, lang, theme, urls, look }: { o: Offer; k: number; n: number; s: number; T: number; lang: Lang; theme: PageTheme; urls: Urls; look: Look }) {
  const { d: D, c, L } = look;
  const P = L.page;
  const big = n === 1 || (n === 2 && P.bigPairs);
  const rh = big ? (n === 1 ? P.rowH * 2 + P.rowGap : P.bigH) : P.rowH;
  const name = o.name[lang];
  const other = o.name[lang === 'tr' ? 'de' : 'tr'];
  const alt = joinName(other);
  const d = s + 0.35 + k * 0.22;
  const ent = MOTION.enter;
  // Einflug je nach Effekt; "wischen" ist der Referenz-Einflug.
  const x = D.enter === 'wischen' ? tw(T, d, d + 0.85, 1150, 0, ent) : 0;
  const rot = D.enter === 'wischen' ? tw(T, d, d + 0.85, 7, 0, ent) : 0;
  const y = D.enter === 'hoch' ? tw(T, d, d + 0.85, 260, 0, ent) : 0;
  const op = D.enter === 'wischen' ? 1 : D.enter === 'pop' ? tw(T, d, d + 0.3, 0, 1, ent) : tw(T, d, d + 0.75, 0, 1, ent);
  const sc = D.enter === 'pop' ? tw(T, d, d + 0.7, 0.4, 1, MOTION.pop) : D.enter === 'blende' ? tw(T, d, d + 0.9, 0.94, 1, ent) : 1;
  const tagP = tw(T, d + 0.5, d + 1.0, 0, 1, MOTION.pop);
  const kb = tw(T, d, d + 6.5, 1, 1.07, Easing.linear);
  const live = D.wobble ? tw(T, d + 0.6, d + 1.2, 0, 1, Easing.easeInOutSine) : 0;
  const ph = k * 2.1 + theme.phase;
  const wob = Math.sin(T * 1.3 + ph) * 0.8 * live;
  const bob = Math.sin(T * 1.1 + ph * 1.3) * 5 * live;
  const nameStyle = { weight: 900, tracking: -0.035, upper: true, lang };
  const circle = D.price === 'kreis';
  const textW = 900 - 56 - P.imgCol - 24 - (circle ? Math.round(P.circle * 0.55) : 0);
  // Referenz-Formel; zusätzlich gemessen, damit nichts überläuft.
  const maxLen = Math.max(...name.map((l) => l.length));
  const fs = big
    ? fitSize(name, 820, { ...nameStyle, size: P.bigName })
    : fitSize(name, textW, { ...nameStyle, size: Math.min(P.nameMax, Math.round(textW / (maxLen * 0.72))) });
  const imgBase: CSSProperties = { objectFit: 'contain', mixBlendMode: 'multiply', display: 'block' };
  const note = o.note ? o.note[lang] : alt;
  const card: CSSProperties = { position: 'absolute', inset: 0, background: '#fff', borderRadius: 40, border: '2px solid rgba(41,32,25,.08)', boxShadow: theme.shadow, boxSizing: 'border-box', overflow: 'hidden' };
  const nameLines = (lh: number) => (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {name.map((l, j) => <div key={j} style={{ fontSize: fs, fontWeight: 900, lineHeight: lh, letterSpacing: '-0.035em', textTransform: 'uppercase', color: c.ink, whiteSpace: 'nowrap' }}>{l}</div>)}
    </div>
  );
  const tag = <PriceTag o={o} lang={lang} theme={theme} p={tagP} look={look} />;
  const transform = D.enter === 'wischen' ? `translate(${x}px, ${bob}px) rotate(${rot + wob}deg)` : `translate(0px, ${y + bob}px) rotate(${wob}deg) scale(${sc})`;
  return (
    <div style={abs({ left: 90, top: P.rowTop + k * (rh + P.rowGap), width: 900, height: rh, transform, transformOrigin: '50% 50%', ...(op < 1 ? { opacity: op } : {}) })}>
      {big ? (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', padding: 20, gap: 14 }}>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', borderRadius: 28 }}>
            <img src={urls.job(o.img)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: `scale(${kb * o.imgZoom * 1.3})`, ...imgBase }} />
          </div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6, padding: '0 20px 14px' }}>
            {nameLines(1.0)}
            <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.25, color: c.ink2 }}>{note}</div>
            {!circle && <div style={{ position: 'absolute', right: 10, top: -120 }}>{tag}</div>}
          </div>
        </div>
      ) : (
        <div style={{ ...card, display: 'grid', gridTemplateColumns: `${P.imgCol}px minmax(0,1fr)`, gap: 24, padding: '20px 36px 20px 20px' }}>
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 28 }}>
            <img src={urls.job(o.img)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: `scale(${kb * o.imgZoom})`, ...imgBase }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, minWidth: 0, ...(circle ? { paddingRight: P.circle * 0.55 } : {}) }}>
            {nameLines(1.04)}
            <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.25, color: c.ink2 }}>{note}</div>
            {!circle && tag}
          </div>
        </div>
      )}
      {circle && (
        <div style={abs(big ? { right: 30, bottom: 120 } : { right: -22, bottom: -18 })}>
          <PriceCircle o={o} lang={lang} theme={theme} p={tagP} size={P.circle} />
        </div>
      )}
    </div>
  );
}

function Watermark({ dark, T, op, urls }: { dark?: boolean; T: number; op?: number; urls: Urls }) {
  const d = Math.sin(T * 0.25) * 14;
  return <img src={urls.asset(dark ? 'logo/marke-white.svg' : 'logo/marke-dark.svg')} alt="" style={{ position: 'absolute', left: -300, bottom: -260, width: 1150, height: 'auto', opacity: op || (dark ? 0.06 : 0.05), transform: `translate(${d}px, ${-d}px) rotate(-8deg)`, display: 'block', pointerEvents: 'none' }} />;
}

/** Hintergrund-Muster einer Fläche: Logo-Wasserzeichen (Referenz), Punkte, Verlauf oder nichts. */
function Backdrop({ look, T, urls, mode }: { look: Look; T: number; urls: Urls; mode?: PageMode }) {
  const kind = look.d.background;
  const onColor = mode === 'white' || mode === 'dark';
  if (kind === 'logo') return mode ? <Watermark dark={onColor} T={T} op={mode === 'white' ? 0.08 : undefined} urls={urls} /> : <Watermark T={T} urls={urls} />;
  if (kind === 'punkte') {
    const dot = onColor ? 'rgba(255,255,255,.11)' : rgba(look.c.ink, 0.07);
    const shift = T * 6;
    return <div style={abs({ inset: 0, backgroundImage: `radial-gradient(circle, ${dot} 4px, transparent 4.6px)`, backgroundSize: '46px 46px', backgroundPosition: `${shift}px ${shift}px`, pointerEvents: 'none' })} />;
  }
  if (kind === 'verlauf') {
    const g = onColor ? 'linear-gradient(165deg, rgba(255,255,255,.14) 0%, rgba(255,255,255,0) 45%, rgba(0,0,0,.28) 100%)' : `linear-gradient(180deg, rgba(255,255,255,0) 30%, ${rgba(look.c.accent, 0.1)} 100%)`;
    return <div style={abs({ inset: 0, background: g, pointerEvents: 'none' })} />;
  }
  return null;
}

/** Sichtbar, solange from ≤ T < to; Kinder bleiben gemountet (Bilder bleiben geladen). */
function Shot({ T, from, to, children }: { T: number; from: number; to: number; children: ReactNode }) {
  return <div style={{ position: 'absolute', inset: 0, visibility: T >= from && T < to ? 'visible' : 'hidden' }}>{children}</div>;
}

/** Übergang einer Fläche: Kreis (Referenz), Schieben oder Überblenden. p: 0 → 1. */
function reveal(look: Look, p: number, cx: number, cy: number, fromLeft: boolean): CSSProperties {
  if (look.d.transition === 'schieben') return p >= 1 ? {} : { transform: `translateX(${(fromLeft ? -1 : 1) * (1 - p) * look.L.W}px)` };
  if (look.d.transition === 'blende') return p >= 1 ? {} : { opacity: p };
  return { clipPath: `circle(${p * 2400}px at ${cx}px ${cy}px)` };
}

/** Seitenfarben: Design-Farben, alte Markt-Einstellung (red/nut) wird darauf abgebildet. */
function pageThemes(story: Story, c: Palette): PageTheme[] {
  const legacy = story.market.theme?.pages;
  const idx = legacy && !story.design?.colors?.pages ? legacy.map((v) => (v === 'red' ? 0 : 1 % c.pages.length)) : c.pages.map((_, i) => i);
  return idx.map((i) => pageTheme(c.pages[i], c, PHASES[i % 2]));
}

export function StoryView({ story, lang, T, cues, logoSize, urls, format = 'story' }: StoryProps) {
  const d = resolveDesign(story.design);
  const c = d.colors;
  const Lay = LAYOUTS[format];
  const look: Look = { d, c, L: Lay };
  const { W, H } = Lay;
  const I = Lay.intro;
  const Cta = Lay.cta;
  const L = COPY[lang];
  const eyebrow = (story.eyebrow ?? defaultEyebrow(story.market.name))[lang];
  const head = story.headline[lang];
  const dates = formatDateRange(story.dates.from, story.dates.to);
  const pages = pagesFor(story, format);
  const themes = pageThemes(story, c);
  const chipProps = { story, logoSize, urls };
  const btnTx = textOn(c.accent, c.ink);

  const c1 = cues.S1;
  const cC = cues.CTA;
  const lockIn = tw(T, 0.1, 0.8, 0, 1, MOTION.enter);
  const headDrift = tw(T, 0, c1, 1, 1.04, Easing.linear);
  const eyeIn = tw(T, 0.35, 0.95, 40, 0, MOTION.enter);
  const eyeOp = tw(T, 0.35, 0.95, 0, 1, MOTION.enter);
  const chipP = tw(T, 1.0, 1.6, 0, 1, MOTION.pop);
  const CS = I.chipScale;
  const infoIn = tw(T, 1.5, 2.1, 0, 1, MOTION.enter);
  const chipBob = Math.sin(T * 1.2) * 8 * tw(T, 1.6, 2.2, 0, 1, Easing.easeInOutSine);

  const ctaLine = (dl: number) => tw(T, cC + 0.15 + dl, cC + 0.8 + dl, 115, 0, MOTION.enter);
  const ctaFade = (dl: number) => tw(T, cC + 0.3 + dl, cC + 0.9 + dl, 0, 1, MOTION.enter);
  const btnPop = tw(T, cC + 0.7, cC + 1.2, 0, 1, MOTION.pop);
  const pulse = 1 + Math.max(0, Math.sin((T - cC - 1.4) * 4.2)) * 0.035 * (T > cC + 1.4 ? 1 : 0);
  const phoneY = tw(T, cC + 0.3, cC + 2.0, 1000, -20, Easing.easeInOutCubic) + Math.sin(Math.max(0, T - cC - 2.0) * 1.2) * 10;
  const lockCta = tw(T, cC + 0.1, cC + 0.6, 0, 1, MOTION.enter);
  const pCta = tw(T, cC - 0.45, cC + 0.45, 0, 1, MOTION.swipe);
  const nextCue = (i: number) => cues[i < pages.length - 1 ? `S${i + 2}` : 'CTA'];

  // Intro: Adressen untereinander, bei Bedarf kleiner, damit sie in die Breite passen.
  const introAddrSize = fitSize(story.market.addresses, 1000, { weight: 600, size: I.addr, lang });
  // Eyebrow und Headline verkleinern sich nur, wenn sie sonst überlaufen würden.
  const eyebrowSize = fitSize([eyebrow], 980, { weight: 800, size: I.eyebrow, tracking: 0.2, upper: true, lang });
  const headSize = fitSize(head, 1000 / 1.04, { weight: 900, size: I.head, tracking: -0.045, upper: true, lang });

  // CTA: Headline → Button = Button → Badges (aus den Zeilenhöhen berechnet).
  const ctaLineH = 22 - 10 + Cta.size + 8;
  const ctaHeadBottom = Cta.headTop + ctaLineH * L.cta.length;
  const btnTop = ctaHeadBottom + Cta.gap;
  const badgesTop = btnTop + Cta.btnH + Cta.gap;

  return (
    <div lang={lang} style={{ position: 'absolute', inset: 0, width: W, height: H, overflow: 'hidden', background: c.paper, fontFamily: 'Archivo, system-ui, sans-serif' }}>
      <Backdrop look={look} T={T} urls={urls} />
      <Shot T={T} from={0} to={c1 + 0.6}>
        <div style={abs({ left: W / 2, top: I.lockTop, transform: `translateX(-50%) scale(${I.lockScale})`, transformOrigin: '50% 0', opacity: lockIn })}><Lockup h={64} urls={urls} /></div>
        <div style={abs({ left: 0, width: W, top: I.headTop, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 })}>
          <div style={{ opacity: eyeOp, transform: `translateY(${eyeIn}px)`, fontSize: eyebrowSize, fontWeight: 800, letterSpacing: '.2em', textTransform: 'uppercase', color: c.ink2 }}>{eyebrow}</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${headDrift})` }}>
            {head.map((h, k) => (
              <div key={k} style={{ overflow: 'hidden', paddingTop: 22, marginTop: -10, paddingBottom: 6 }}>
                <div style={{ transform: `translateY(${tw(T, 0.45 + k * 0.12, 1.15 + k * 0.12, 115, 0, MOTION.enter)}%)`, fontSize: headSize, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.045em', textTransform: 'uppercase', color: k === head.length - 1 && head.length > 1 ? c.accent : c.ink, whiteSpace: 'nowrap' }}>{h}</div>
              </div>
            ))}
          </div>
        </div>
        <MarketChip {...chipProps} style={{ left: W / 2 - 210 * CS, top: I.chipTop + chipBob, transform: `translate(${210 * CS * (1 - chipP)}px, ${100 * CS * (1 - chipP)}px) scale(${CS * chipP})` }} />
        <div style={abs({ left: 0, width: W, top: I.infoTop, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: I.infoGap, opacity: infoIn, transform: `translateY(${(1 - infoIn) * 40}px)` })}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, height: I.pillH, padding: '0 40px 0 32px', borderRadius: 999, border: `3px solid ${rgba(c.ink, 0.18)}`, boxSizing: 'border-box' }}>
            <img src={urls.asset('icons/calendar.svg')} alt="" style={{ width: I.cal, height: I.cal, display: 'block' }} />
            <span style={{ fontSize: I.pillFont, fontWeight: 800, letterSpacing: '-0.01em', color: c.ink, whiteSpace: 'nowrap' }}>{dates}</span>
          </div>
          <div style={{ fontSize: introAddrSize, fontWeight: 600, color: c.ink2, textAlign: 'center' }}>
            {story.market.addresses.map((a, i) => <div key={i}>{a}</div>)}
          </div>
          {story.market.instagram && <div style={{ fontSize: I.insta, fontWeight: 800, color: c.accent }}>@{story.market.instagram}</div>}
        </div>
      </Shot>

      {pages.map((offers, i) => {
        const theme = themes[i % themes.length];
        const s = cues[`S${i + 1}`];
        const e = nextCue(i);
        const p = tw(T, s - 0.45, s + 0.45, 0, 1, MOTION.swipe);
        const hd = tw(T, s - 0.1, s + 0.6, 1, 0, MOTION.enter);
        const P = Lay.page;
        return (
          <div key={i} style={abs({ inset: 0, background: theme.bg, ...reveal(look, p, i % 2 ? 200 : 880, P.revealY, i % 2 === 1) })}>
            <Backdrop look={look} T={T} urls={urls} mode={theme.mode} />
            <Shot T={T} from={s - 0.5} to={e + 0.6}>
              <div style={abs({ left: 90, top: P.lockTop, transform: `translateY(${hd * -40}px)${P.lockScale === 1 ? '' : ` scale(${P.lockScale})`}`, transformOrigin: '0 0' })}><Lockup dark={theme.dark} white={theme.white} h={64} urls={urls} /></div>
              <MarketChip {...chipProps} style={{ left: 90, top: P.chipTop, transform: `translateX(${hd * -600}px) scale(${P.chipScale})`, border: theme.dark ? undefined : 'none' }} />
              <MarketInfo theme={theme} dates={dates} story={story} lang={lang} hd={hd} urls={urls} look={look} />
              {offers.map((o, k) => <OfferRow key={k} o={o} k={k} n={offers.length} s={s} T={T} lang={lang} theme={theme} urls={urls} look={look} />)}
            </Shot>
          </div>
        );
      })}

      <div style={abs({ inset: 0, background: c.paper, ...reveal(look, pCta, W / 2, Cta.revealY, false) })}>
        <Backdrop look={look} T={T} urls={urls} />
        <Shot T={T} from={cC - 0.5} to={cC + 10}>
          <div style={abs({ left: 0, width: W, top: Cta.lockTop, display: 'flex', justifyContent: 'center', opacity: lockCta })}><Lockup h={64} urls={urls} /></div>
          <div style={abs({ left: 0, width: W, top: Cta.headTop, display: 'flex', flexDirection: 'column', alignItems: 'center' })}>
            {L.cta.map((h, k) => (
              <div key={k} style={{ overflow: 'hidden', paddingTop: 22, marginTop: -10, paddingBottom: 8 }}>
                <div style={{ transform: `translateY(${ctaLine(k * 0.12)}%)`, fontSize: Cta.size, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.045em', textTransform: 'up' in h ? 'uppercase' : 'none', color: 'red' in h ? c.accent : c.ink, whiteSpace: 'nowrap' }}>{h.t}</div>
              </div>
            ))}
          </div>
          <div style={abs({ left: (W - Cta.btnW) / 2, top: btnTop, width: Cta.btnW, height: Cta.btnH, transform: `scale(${btnPop * pulse})`, transformOrigin: '50% 50%', borderRadius: 999, background: c.accent, boxShadow: `0 12px 28px ${rgba(c.accent, 0.32)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22 })}>
            <span style={{ fontSize: Cta.btnFont, fontWeight: 800, letterSpacing: '.12em', color: btnTx, textTransform: 'uppercase' }}>{L.btn}</span>
            <img src={urls.asset('icons/arrow_right-white.svg')} alt="" style={{ width: 48, height: 48, display: 'block', ...(btnTx === '#ffffff' ? {} : { filter: 'invert(1)' }) }} />
          </div>
          <div style={abs({ left: 0, width: W, top: badgesTop, display: 'flex', justifyContent: 'center', gap: 24, opacity: ctaFade(0.6) })}>
            <div style={{ height: 96, width: 300, borderRadius: 20, background: '#fff', border: '2px solid rgba(41,32,25,.10)', display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px', boxSizing: 'border-box', color: '#000' }}>
              <img src={urls.asset('icons/apple.svg')} alt="" style={{ width: 46, height: 46, display: 'block' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 18, fontWeight: 500, lineHeight: 1 }}>Download on the</span>
                <span style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em' }}>App Store</span>
              </div>
            </div>
            <div style={{ height: 96, width: 330, borderRadius: 20, background: '#fff', border: '2px solid rgba(41,32,25,.10)', display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px', boxSizing: 'border-box', color: '#000' }}>
              <svg viewBox="0 0 24 26" style={{ width: 40, height: 44, display: 'block' }}><polygon points="1,1 14,13 1,25" fill="#00A0FF" /><polygon points="1,1 14,13 18.5,8.5" fill="#00F076" /><polygon points="1,25 14,13 18.5,17.5" fill="#FF3A44" /><polygon points="14,13 18.5,8.5 23,11 23,15 18.5,17.5" fill="#FFD500" /></svg>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 18, fontWeight: 500, lineHeight: 1 }}>GET IT ON</span>
                <span style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em' }}>Google Play</span>
              </div>
            </div>
          </div>
          <div style={abs({ left: (W - 580) / 2, top: Cta.phoneTop, width: 580, height: 1260, transform: `translateY(${phoneY}px)`, borderRadius: 84, background: c.ink, padding: 16, boxSizing: 'border-box', boxShadow: '0 30px 60px rgba(41,32,25,.25)' })}>
            <div style={{ width: '100%', height: '100%', borderRadius: 70, overflow: 'hidden', background: c.paper }}>
              {story.appScreenshot ? (
                <img src={urls.job(story.appScreenshot)} alt="" style={{ width: '100%', display: 'block' }} />
              ) : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 140, gap: 40 }}>
                  <Lockup h={56} urls={urls} />
                  <MarketChip {...chipProps} style={{ position: 'relative' }} />
                </div>
              )}
            </div>
          </div>
        </Shot>
      </div>
    </div>
  );
}

/**
 * Einzelnes Angebot als Bild (Feed-Beitrag 4:5 oder Quadrat): große Produktkarte,
 * Preis, Markt und Gültigkeit. Statisch, ohne Animation.
 */
export function OfferPost({ story, lang, index, logoSize, urls, format = 'feed' }: Omit<StoryProps, 'T' | 'cues'> & { index: number }) {
  const d = resolveDesign(story.design);
  const c = d.colors;
  const Lay = LAYOUTS[format];
  const look: Look = { d, c, L: { ...Lay, page: { ...Lay.page, tagScale: 1 } } };
  const { W, H } = Lay;
  const o = story.offers[index] ?? story.offers[0];
  const themes = pageThemes(story, c);
  const theme = themes[index % themes.length];
  const light = theme.mode !== 'light';
  const dates = formatDateRange(story.dates.from, story.dates.to);
  const name = o.name[lang];
  const note = o.note ? o.note[lang] : joinName(o.name[lang === 'tr' ? 'de' : 'tr']);
  const square = format === 'quadrat';
  const cardTop = square ? 150 : 170;
  const cardBottom = square ? 190 : 230;
  const cardH = H - cardTop - cardBottom;
  const fs = fitSize(name, 860, { weight: 900, size: square ? 72 : 84, tracking: -0.035, upper: true, lang });
  const textH = name.length * fs * 1.02 + 44 + 40;
  const addr = story.market.addresses[0];
  return (
    <div lang={lang} style={{ position: 'absolute', inset: 0, width: W, height: H, overflow: 'hidden', background: theme.bg, fontFamily: 'Archivo, system-ui, sans-serif' }}>
      <Backdrop look={look} T={0} urls={urls} mode={theme.mode} />
      <div style={abs({ left: 70, top: square ? 52 : 62 })}><Lockup dark={theme.dark} white={theme.white} h={square ? 56 : 64} urls={urls} /></div>
      <div style={abs({ right: 70, top: square ? 44 : 56 })}><Pill light={light} white={theme.white} value={dates} urls={urls} c={c} /></div>
      <div style={abs({ left: 70, right: 70, top: cardTop, height: cardH, background: '#fff', borderRadius: 48, boxShadow: theme.shadow, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 28, boxSizing: 'border-box' })}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          <img src={urls.job(o.img)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', mixBlendMode: 'multiply', transform: `scale(${o.imgZoom})` }} />
        </div>
        <div style={{ height: textH, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 12px 8px' }}>
          {name.map((l, j) => <div key={j} style={{ fontSize: fs, fontWeight: 900, lineHeight: 1.02, letterSpacing: '-0.035em', textTransform: 'uppercase', color: c.ink, whiteSpace: 'nowrap' }}>{l}</div>)}
          <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.3, color: c.ink2, marginTop: 6 }}>{note}</div>
        </div>
      </div>
      <div style={abs(d.price === 'kreis' ? { right: 40, top: cardTop + cardH - textH - 230 } : { right: 56, top: cardTop + cardH - textH - 150, transform: 'scale(1.3)', transformOrigin: '100% 50%' })}>
        {d.price === 'kreis' ? <PriceCircle o={o} lang={lang} theme={theme} p={1} size={250} /> : <PriceTag o={o} lang={lang} theme={theme} p={1} look={look} />}
      </div>
      <div style={abs({ left: 70, right: 70, bottom: square ? 30 : 44, height: square ? 130 : 150, display: 'flex', alignItems: 'center', gap: 28 })}>
        <MarketChip story={story} logoSize={logoSize} urls={urls} style={{ position: 'relative', flexShrink: 0, transform: `scale(${square ? 0.6 : 0.7})`, transformOrigin: '0 50%', marginRight: square ? -168 : -126, border: theme.dark ? undefined : 'none' }} />
        <div style={{ flex: 1, minWidth: 0, textAlign: 'right', color: light ? '#FAF6F1' : c.ink2 }}>
          <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.25 }}>{addr}</div>
          {story.market.instagram && <div style={{ fontSize: 30, fontWeight: 800, marginTop: 6, color: light ? (theme.white ? '#fff' : c.accent2) : c.accent }}>@{story.market.instagram}</div>}
        </div>
      </div>
    </div>
  );
}
