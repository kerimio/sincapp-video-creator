// sincapp Instagram-Story (1080×1920), portiert aus reference/story-saray.jsx.
// Maße, Farben, Timing und Animationen sind aus der Referenz übernommen;
// alle Inhalte kommen aus story.json.
import type { CSSProperties, ReactNode } from 'react';
import type { Lang, Offer, Story } from '../core/schema';
import { paginate } from '../core/pages';
import { formatDateRange, defaultEyebrow } from '../core/format';
import { Easing, MOTION, tw } from './motion';
import { fitSize, textWidth } from './fit';

export const W = 1080;
export const H = 1920;
export const C = { red: '#C24A18', nut: '#292019', paper: '#FAF6F1', amber: '#E9A02A', ink2: '#5C4E42' };

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

type PageVariant = 'red' | 'nut';
interface PageTheme {
  bg: string;
  white?: boolean;
  dark?: boolean;
  tagBg: string;
  tagTx: string;
  shadow: string;
  /** Phasenversatz fürs Wippen; entspricht in der Referenz der Länge des Theme-Namens ("saray"/"sarayDark"). */
  phase: number;
}
const PAGE_THEMES: Record<PageVariant, PageTheme> = {
  red: { bg: C.red, white: true, tagBg: C.red, tagTx: '#fff', shadow: '0 24px 60px rgba(80,20,0,.35)', phase: 5 * 0.7 },
  nut: { bg: C.nut, dark: true, tagBg: C.amber, tagTx: C.nut, shadow: '0 24px 60px rgba(0,0,0,.35)', phase: 9 * 0.7 },
};

export interface Urls {
  job: (p: string) => string;
  market: (p: string) => string;
  asset: (p: string) => string;
}

export interface StoryProps {
  story: Story;
  lang: Lang;
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

function Pill({ light, white, value, urls }: { light: boolean; white?: boolean; value: string; urls: Urls }) {
  return (
    <div
      style={{
        position: 'relative', height: 76, padding: '0 30px 0 24px', borderRadius: 999, boxSizing: 'border-box',
        border: white ? '2px solid rgba(255,255,255,.45)' : light ? '2px solid rgba(250,246,241,.28)' : '2px solid rgba(41,32,25,.18)',
        display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap',
      }}
    >
      <img src={urls.asset('icons/calendar.svg')} alt="" style={{ width: 32, height: 32, display: 'block', ...(light ? { filter: 'invert(1) brightness(2)' } : {}) }} />
      <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.01em', color: light ? C.paper : C.nut }}>{value}</span>
    </div>
  );
}

// Header rechts: Datum, Adresse(n), @handle. Muss oberhalb der Karten (y 500) enden.
const INFO_TOP = 262;
const INFO_BOTTOM = 488;
function addressSize(addresses: string[], lang: Lang): number {
  for (let size = 24; size > 16; size--) {
    const lines = addresses.reduce((n, a) => n + Math.ceil(textWidth(a, { weight: 600, size, lang }) / 560), 0);
    const height = 76 + 10 + lines * size * 1.25 + 10 + 26 * 1.2;
    if (INFO_TOP + height <= INFO_BOTTOM) return size;
  }
  return 16;
}

function MarketInfo({ theme, dates, story, lang, hd, urls }: { theme: PageTheme; dates: string; story: Story; lang: Lang; hd: number; urls: Urls }) {
  const light = !!(theme.dark || theme.white);
  const size = addressSize(story.market.addresses, lang);
  return (
    <div style={{ position: 'absolute', right: 90, top: INFO_TOP, width: 600, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, transform: `translateX(${hd * 760}px)` }}>
      <Pill light={light} white={theme.white} value={dates} urls={urls} />
      <div style={{ maxWidth: 560, textAlign: 'right', fontSize: size, fontWeight: 600, lineHeight: 1.25, color: light ? C.paper : C.ink2, textWrap: 'balance' } as CSSProperties}>
        {story.market.addresses.map((a, i) => <div key={i}>{a}</div>)}
      </div>
      {story.market.instagram && <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em', color: light ? (theme.white ? '#fff' : C.amber) : C.red }}>@{story.market.instagram}</div>}
    </div>
  );
}

const ROW_H = 380;
const ROW_GAP = 28;
const ROW_TOP = 500;

function PriceTag({ o, lang, theme, p }: { o: Offer; lang: Lang; theme: PageTheme; p: number }) {
  const unit = unitOf(o, lang);
  return (
    <div style={{ alignSelf: 'flex-start', marginTop: 10, display: 'flex', alignItems: 'stretch', gap: 18, padding: '12px 24px 10px', borderRadius: 24, background: theme.tagBg, color: theme.tagTx, transform: `scale(${p}) rotate(-3deg)`, transformOrigin: '0 50%', boxShadow: '0 8px 18px rgba(41,32,25,.18)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, lineHeight: 0.9 }}>
        <span style={{ fontSize: 80, fontWeight: 900, letterSpacing: '-0.05em' }}>{o.price}</span>
        <span style={{ fontSize: 40, fontWeight: 900, marginBottom: 4 }}>€</span>
        {unit && <span style={{ fontSize: 28, fontWeight: 800, marginLeft: 8, marginBottom: 8, whiteSpace: 'nowrap' }}>{unit}</span>}
      </div>
    </div>
  );
}

function OfferRow({ o, k, n, s, T, lang, theme, urls }: { o: Offer; k: number; n: number; s: number; T: number; lang: Lang; theme: PageTheme; urls: Urls }) {
  const big = n === 2;
  const rh = big ? 600 : ROW_H;
  const name = o.name[lang];
  const other = o.name[lang === 'tr' ? 'de' : 'tr'];
  const alt = joinName(other);
  const d = s + 0.35 + k * 0.22;
  const x = tw(T, d, d + 0.85, 1150, 0, MOTION.enter);
  const rot = tw(T, d, d + 0.85, 7, 0, MOTION.enter);
  const tagP = tw(T, d + 0.5, d + 1.0, 0, 1, MOTION.pop);
  const kb = tw(T, d, d + 6.5, 1, 1.07, Easing.linear);
  const live = tw(T, d + 0.6, d + 1.2, 0, 1, Easing.easeInOutSine);
  const ph = k * 2.1 + theme.phase;
  const wob = Math.sin(T * 1.3 + ph) * 0.8 * live;
  const bob = Math.sin(T * 1.1 + ph * 1.3) * 5 * live;
  const nameStyle = { weight: 900, tracking: -0.035, upper: true, lang };
  // Referenz-Formel; zusätzlich gemessen, damit nichts überläuft.
  const maxLen = Math.max(...name.map((l) => l.length));
  const fs = big
    ? fitSize(name, 820, { ...nameStyle, size: 66 })
    : fitSize(name, 480, { ...nameStyle, size: Math.min(56, Math.round(480 / (maxLen * 0.72))) });
  const imgBase: CSSProperties = { objectFit: 'contain', mixBlendMode: 'multiply', display: 'block' };
  const note = o.note ? o.note[lang] : alt;
  const card: CSSProperties = { position: 'absolute', inset: 0, background: '#fff', borderRadius: 40, border: '2px solid rgba(41,32,25,.08)', boxShadow: theme.shadow, boxSizing: 'border-box', overflow: 'hidden' };
  const nameLines = (lh: number) => (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {name.map((l, j) => <div key={j} style={{ fontSize: fs, fontWeight: 900, lineHeight: lh, letterSpacing: '-0.035em', textTransform: 'uppercase', color: C.nut, whiteSpace: 'nowrap' }}>{l}</div>)}
    </div>
  );
  return (
    <div style={abs({ left: 90, top: ROW_TOP + k * (rh + ROW_GAP), width: 900, height: rh, transform: `translate(${x}px, ${bob}px) rotate(${rot + wob}deg)`, transformOrigin: '50% 50%' })}>
      {big ? (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', padding: 20, gap: 14 }}>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', borderRadius: 28 }}>
            <img src={urls.job(o.img)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: `scale(${kb * o.imgZoom * 1.3})`, ...imgBase }} />
          </div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6, padding: '0 20px 14px' }}>
            {nameLines(1.0)}
            <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.25, color: C.ink2 }}>{note}</div>
            <div style={{ position: 'absolute', right: 10, top: -120 }}><PriceTag o={o} lang={lang} theme={theme} p={tagP} /></div>
          </div>
        </div>
      ) : (
        <div style={{ ...card, display: 'grid', gridTemplateColumns: '340px minmax(0,1fr)', gap: 24, padding: '20px 36px 20px 20px' }}>
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 28 }}>
            <img src={urls.job(o.img)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: `scale(${kb * o.imgZoom})`, ...imgBase }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, minWidth: 0 }}>
            {nameLines(1.04)}
            <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.25, color: C.ink2 }}>{note}</div>
            <PriceTag o={o} lang={lang} theme={theme} p={tagP} />
          </div>
        </div>
      )}
    </div>
  );
}

function Watermark({ dark, T, op, urls }: { dark?: boolean; T: number; op?: number; urls: Urls }) {
  const d = Math.sin(T * 0.25) * 14;
  return <img src={urls.asset(dark ? 'logo/marke-white.svg' : 'logo/marke-dark.svg')} alt="" style={{ position: 'absolute', left: -300, bottom: -260, width: 1150, height: 'auto', opacity: op || (dark ? 0.06 : 0.05), transform: `translate(${d}px, ${-d}px) rotate(-8deg)`, display: 'block', pointerEvents: 'none' }} />;
}

/** Sichtbar, solange from ≤ T < to; Kinder bleiben gemountet (Bilder bleiben geladen). */
function Shot({ T, from, to, children }: { T: number; from: number; to: number; children: ReactNode }) {
  return <div style={{ position: 'absolute', inset: 0, visibility: T >= from && T < to ? 'visible' : 'hidden' }}>{children}</div>;
}

export function StoryView({ story, lang, T, cues, logoSize, urls }: StoryProps) {
  const L = COPY[lang];
  const eyebrow = (story.eyebrow ?? defaultEyebrow(story.market.name))[lang];
  const head = story.headline[lang];
  const dates = formatDateRange(story.dates.from, story.dates.to);
  const pages = paginate(story.offers, story.pages);
  const variants = story.market.theme?.pages ?? ['red', 'nut'];
  const chipProps = { story, logoSize, urls };

  const c1 = cues.S1;
  const cC = cues.CTA;
  const lockIn = tw(T, 0.1, 0.8, 0, 1, MOTION.enter);
  const headDrift = tw(T, 0, c1, 1, 1.04, Easing.linear);
  const eyeIn = tw(T, 0.35, 0.95, 40, 0, MOTION.enter);
  const eyeOp = tw(T, 0.35, 0.95, 0, 1, MOTION.enter);
  const chipP = tw(T, 1.0, 1.6, 0, 1, MOTION.pop);
  const CS = 1.35;
  const infoIn = tw(T, 1.5, 2.1, 0, 1, MOTION.enter);
  const chipBob = Math.sin(T * 1.2) * 8 * tw(T, 1.6, 2.2, 0, 1, Easing.easeInOutSine);

  const ctaLine = (d: number) => tw(T, cC + 0.15 + d, cC + 0.8 + d, 115, 0, MOTION.enter);
  const ctaFade = (d: number) => tw(T, cC + 0.3 + d, cC + 0.9 + d, 0, 1, MOTION.enter);
  const btnPop = tw(T, cC + 0.7, cC + 1.2, 0, 1, MOTION.pop);
  const pulse = 1 + Math.max(0, Math.sin((T - cC - 1.4) * 4.2)) * 0.035 * (T > cC + 1.4 ? 1 : 0);
  const phoneY = tw(T, cC + 0.3, cC + 2.0, 1000, -20, Easing.easeInOutCubic) + Math.sin(Math.max(0, T - cC - 2.0) * 1.2) * 10;
  const lockCta = tw(T, cC + 0.1, cC + 0.6, 0, 1, MOTION.enter);
  const rCta = tw(T, cC - 0.45, cC + 0.45, 0, 2400, MOTION.swipe);
  const nextCue = (i: number) => cues[i < pages.length - 1 ? `S${i + 2}` : 'CTA'];

  // Intro: Adressen untereinander, bei Bedarf kleiner, damit sie in die Breite passen.
  const introAddrSize = fitSize(story.market.addresses, 1000, { weight: 600, size: 40, lang });
  // Eyebrow und Headline verkleinern sich nur, wenn sie sonst überlaufen würden.
  const eyebrowSize = fitSize([eyebrow], 980, { weight: 800, size: 30, tracking: 0.2, upper: true, lang });
  const headSize = fitSize(head, 1000 / 1.04, { weight: 900, size: 110, tracking: -0.045, upper: true, lang });

  // CTA: Headline → Button = Button → Badges (aus den Zeilenhöhen berechnet).
  const ctaLineH = 22 - 10 + 96 + 8;
  const ctaHeadBottom = 280 + ctaLineH * L.cta.length;
  const CTA_GAP = 52;
  const btnTop = ctaHeadBottom + CTA_GAP;
  const badgesTop = btnTop + 124 + CTA_GAP;

  return (
    <div lang={lang} style={{ position: 'absolute', inset: 0, width: W, height: H, overflow: 'hidden', background: C.paper, fontFamily: 'Archivo, system-ui, sans-serif' }}>
      <Watermark T={T} urls={urls} />
      <Shot T={T} from={0} to={c1 + 0.6}>
        <div style={abs({ left: 540, top: 250, transform: 'translateX(-50%) scale(1.7)', transformOrigin: '50% 0', opacity: lockIn })}><Lockup h={64} urls={urls} /></div>
        <div style={abs({ left: 0, width: W, top: 470, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 })}>
          <div style={{ opacity: eyeOp, transform: `translateY(${eyeIn}px)`, fontSize: eyebrowSize, fontWeight: 800, letterSpacing: '.2em', textTransform: 'uppercase', color: C.ink2 }}>{eyebrow}</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${headDrift})` }}>
            {head.map((h, k) => (
              <div key={k} style={{ overflow: 'hidden', paddingTop: 22, marginTop: -10, paddingBottom: 6 }}>
                <div style={{ transform: `translateY(${tw(T, 0.45 + k * 0.12, 1.15 + k * 0.12, 115, 0, MOTION.enter)}%)`, fontSize: headSize, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.045em', textTransform: 'uppercase', color: k === head.length - 1 && head.length > 1 ? C.red : C.nut, whiteSpace: 'nowrap' }}>{h}</div>
              </div>
            ))}
          </div>
        </div>
        <MarketChip {...chipProps} style={{ left: 540 - 210 * CS, top: 900 + chipBob, transform: `translate(${210 * CS * (1 - chipP)}px, ${100 * CS * (1 - chipP)}px) scale(${CS * chipP})` }} />
        <div style={abs({ left: 0, width: W, top: 1230, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, opacity: infoIn, transform: `translateY(${(1 - infoIn) * 40}px)` })}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, height: 100, padding: '0 40px 0 32px', borderRadius: 999, border: '3px solid rgba(41,32,25,.18)', boxSizing: 'border-box' }}>
            <img src={urls.asset('icons/calendar.svg')} alt="" style={{ width: 44, height: 44, display: 'block' }} />
            <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.01em', color: C.nut, whiteSpace: 'nowrap' }}>{dates}</span>
          </div>
          <div style={{ fontSize: introAddrSize, fontWeight: 600, color: C.ink2, textAlign: 'center' }}>
            {story.market.addresses.map((a, i) => <div key={i}>{a}</div>)}
          </div>
          {story.market.instagram && <div style={{ fontSize: 44, fontWeight: 800, color: C.red }}>@{story.market.instagram}</div>}
        </div>
      </Shot>

      {pages.map((offers, i) => {
        const theme = PAGE_THEMES[variants[i % variants.length]];
        const s = cues[`S${i + 1}`];
        const e = nextCue(i);
        const r = tw(T, s - 0.45, s + 0.45, 0, 2400, MOTION.swipe);
        const hd = tw(T, s - 0.1, s + 0.6, 1, 0, MOTION.enter);
        return (
          <div key={i} style={abs({ inset: 0, background: theme.bg, clipPath: `circle(${r}px at ${i % 2 ? 200 : 880}px 560px)` })}>
            <Watermark dark T={T} op={theme.white ? 0.08 : undefined} urls={urls} />
            <Shot T={T} from={s - 0.5} to={e + 0.6}>
              <div style={abs({ left: 90, top: 150, transform: `translateY(${hd * -40}px)` })}><Lockup dark={theme.dark} white={theme.white} h={64} urls={urls} /></div>
              <MarketChip {...chipProps} style={{ left: 90, top: 280, transform: `translateX(${hd * -600}px) scale(.62)`, border: theme.dark ? undefined : 'none' }} />
              <MarketInfo theme={theme} dates={dates} story={story} lang={lang} hd={hd} urls={urls} />
              {offers.map((o, k) => <OfferRow key={k} o={o} k={k} n={offers.length} s={s} T={T} lang={lang} theme={theme} urls={urls} />)}
            </Shot>
          </div>
        );
      })}

      <div style={abs({ inset: 0, background: C.paper, clipPath: `circle(${rCta}px at 540px 1500px)` })}>
        <Watermark T={T} urls={urls} />
        <Shot T={T} from={cC - 0.5} to={cC + 10}>
          <div style={abs({ left: 0, width: W, top: 150, display: 'flex', justifyContent: 'center', opacity: lockCta })}><Lockup h={64} urls={urls} /></div>
          <div style={abs({ left: 0, width: W, top: 280, display: 'flex', flexDirection: 'column', alignItems: 'center' })}>
            {L.cta.map((h, k) => (
              <div key={k} style={{ overflow: 'hidden', paddingTop: 22, marginTop: -10, paddingBottom: 8 }}>
                <div style={{ transform: `translateY(${ctaLine(k * 0.12)}%)`, fontSize: 96, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.045em', textTransform: 'up' in h ? 'uppercase' : 'none', color: 'red' in h ? C.red : C.nut, whiteSpace: 'nowrap' }}>{h.t}</div>
              </div>
            ))}
          </div>
          <div style={abs({ left: 190, top: btnTop, width: 700, height: 124, transform: `scale(${btnPop * pulse})`, transformOrigin: '50% 50%', borderRadius: 999, background: C.red, boxShadow: '0 12px 28px rgba(194,74,24,.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22 })}>
            <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: '.12em', color: '#fff', textTransform: 'uppercase' }}>{L.btn}</span>
            <img src={urls.asset('icons/arrow_right-white.svg')} alt="" style={{ width: 48, height: 48, display: 'block' }} />
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
          <div style={abs({ left: 250, top: 1030, width: 580, height: 1260, transform: `translateY(${phoneY}px)`, borderRadius: 84, background: C.nut, padding: 16, boxSizing: 'border-box', boxShadow: '0 30px 60px rgba(41,32,25,.25)' })}>
            <div style={{ width: '100%', height: '100%', borderRadius: 70, overflow: 'hidden', background: C.paper }}>
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
