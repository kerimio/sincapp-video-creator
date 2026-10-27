// sincapp Instagram Story — Saray Market (1080×1920)
const W = 1080, H = 1920;
const C = { red: '#C24A18', nut: '#292019', paper: '#FAF6F1', amber: '#E9A02A', ink2: '#5C4E42' };
const A = 'assets/wochenangebote/';

const MOTION = {
  enter: Easing.easeOutQuart,
  pop: Easing.easeOutBack,
  swipe: Easing.easeInOutCubic,
};
const tw = (T, a, b, from, to, ease) => animate({ from, to, start: a, end: b, ease })(T);

const COPY = {
  tr: {
    eyebrow: 'Şimdi Saray Market’te',
    head: [{ t: 'Et' }, { t: 'fırsatları', red: true }],
    valid: 'Geçerli', dates: '28.10. – 30.10.2026',
    cta: [{ t: 'Ve çok daha', up: true }, { t: 'fazla fırsat', up: true }, { t: 'sincapp’ta', red: true }],
    sub: 'Bu sadece bir seçkiydi – tüm kampanyalar tek uygulamada.',
    btn: 'Şimdi indir',
  },
  de: {
    eyebrow: 'Jetzt bei Saray Market',
    head: [{ t: 'Fleisch-' }, { t: 'angebote', red: true }],
    valid: 'Gültig', dates: '28.10. – 30.10.2026',
    cta: [{ t: 'Viele weitere', up: true }, { t: 'Angebote', up: true }, { t: 'bei sincapp', red: true }],
    sub: 'Das war nur ein Auszug – alle Prospekte in einer App.',
    btn: 'Jetzt laden',
  },
};

const OFFERS = [
  { page: 'p1', img: 'saray-rindermett.png', imgZoom: 1.05, price: '10,99',
    tr: { name: ['Dana', 'kıyma'], unit: '1 kg' }, de: { name: ['Rinder-', 'mett'], unit: '1 kg' } },
  { page: 'p1', img: 'saray-mett-gemischt.png', imgZoom: 1.0, price: '10,99',
    tr: { name: ['Karışık', 'kıyma'], unit: '1 kg' }, de: { name: ['Gemischtes', 'Mett'], unit: '1 kg' },
    note: { tr: 'Kuzu & dana', de: 'Lamm & Rind' } },
  { page: 'p1', img: 'saray-haehnchen.png', imgZoom: 1.15, price: '29,95',
    tr: { name: ['Tavuk', 'göğsü'], unit: '5 kg' }, de: { name: ['Hähnchen-', 'brust'], unit: '5 kg' } },
  { page: 'p2', img: 'saray-rinderhals.png', imgZoom: 1.05, price: '12,99',
    tr: { name: ['Dana boyun', 'kemiksiz'], unit: '1 kg' }, de: { name: ['Rinderhals', 'ohne Knochen'], unit: '1 kg' } },
  { page: 'p2', img: 'saray-rippen.png', imgZoom: 1.0, price: '10,99',
    tr: { name: ['Dana kaburga', 'kemiksiz'], unit: '1 kg' }, de: { name: ['Rinderrippen', 'ohne Knochen'], unit: '1 kg' } },
];

const PAGES = [
  { id: 'p1', cue: 'S1', th: 'saray', bg: C.red, white: true },
  { id: 'p2', cue: 'S2', th: 'sarayDark', bg: C.nut, dark: true },
];
const MK = { ig: 'saraymarket', dates: '28.10. – 30.10.2026', addr: 'Lange Laube 3, 30159 Hannover' };

const THEME = {
  saray: { tagBg: C.red, tagTx: '#fff', fg: '#fff', accent: C.paper, alt: '#FBE1D4', label: 'Saray Market', shadow: '0 24px 60px rgba(80,20,0,.35)', tagShadow: '0 14px 30px rgba(80,20,0,.35)' },
  sarayDark: { tagBg: C.amber, tagTx: C.nut, fg: C.paper, accent: C.amber, tagFg: C.nut, alt: '#D8CCBF', label: 'Saray Market', shadow: '0 24px 60px rgba(0,0,0,.35)', tagShadow: '0 14px 30px rgba(0,0,0,.35)' },
};

const abs = (s) => Object.assign({ position: 'absolute' }, s);

function SarayLogo() {
  return <img src={A + 'saray-logo.jpg'} alt="Saray Market" style={{ width: 380, height: 175, display: 'block', flexShrink: 0 }} />;
}
function MarketChip({ market, style }) {
  return (
    <div style={Object.assign({
      position: 'absolute', width: 420, height: 200, boxSizing: 'border-box', background: '#fff', overflow: 'hidden',
      borderRadius: 40, border: '2px solid rgba(41,32,25,.08)', boxShadow: '0 10px 30px rgba(41,32,25,.10)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', transformOrigin: '0 0',
    }, style)}>
      <SarayLogo />
    </div>
  );
}

function Lockup({ dark, white, h = 64 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: h * 0.16 }}>
      <img src={white ? 'assets/logo/marke-white.svg' : 'assets/logo/marke-red.svg'} alt="" style={{ height: h, width: 'auto', display: 'block' }} />
      <img src={dark || white ? 'assets/logo/wortmarke-weiss.svg' : 'assets/logo/wortmarke-dunkel-rot.svg'} alt="sincapp" style={{ height: h * 0.74, width: 'auto', display: 'block' }} />
    </div>
  );
}

function Pill({ dark, icon, label, value, style, border, iconStyle, labelColor }) {
  return (
    <div style={Object.assign({
      position: 'absolute', height: 76, padding: '0 30px 0 24px', borderRadius: 999, boxSizing: 'border-box',
      border: border || dark ? (border || '2px solid rgba(250,246,241,.28)') : '2px solid rgba(41,32,25,.18)',
      display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap',
    }, style)}>
      <img src={icon} alt="" style={Object.assign({ width: 32, height: 32, display: 'block' }, iconStyle)} />
      {label && <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: labelColor || (dark ? C.amber : C.red) }}>{label}</span>}
      <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.01em', color: dark ? C.paper : C.nut }}>{value}</span>
    </div>
  );
}

function MarketInfo({ mk, L, hd }) {
  const light = mk.dark || mk.white;
  return (
    <div style={{ position: 'absolute', right: 90, top: 262, width: 600, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, transform: `translateX(${hd * 760}px)` }}>
      <Pill dark={light} border={mk.white ? '2px solid rgba(255,255,255,.45)' : undefined} icon="assets/icons/calendar.svg" iconStyle={light ? { filter: 'invert(1) brightness(2)' } : undefined} value={mk.dates} style={{ position: 'relative' }} />
      <div style={{ maxWidth: 560, textAlign: 'right', fontSize: 24, fontWeight: 600, lineHeight: 1.25, color: light ? C.paper : C.ink2, textWrap: 'balance' }}>{mk.addr}</div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.01em', color: light ? (mk.white ? '#fff' : C.amber) : C.red }}>@{mk.ig}</div>
    </div>
  );
}
const ROW_H = 380, ROW_GAP = 28, ROW_TOP = 500;

function PriceTag({ o, t, th, lang, p, T, ph }) {
  const box = { display: 'flex', alignItems: 'flex-end', gap: 6, lineHeight: 0.9 };
  return (
    <div style={{ alignSelf: 'flex-start', marginTop: 10, display: 'flex', alignItems: 'stretch', gap: 18, padding: '12px 24px 10px', borderRadius: 24, background: th.tagBg, color: th.tagTx, transform: `scale(${p}) rotate(-3deg)`, transformOrigin: '0 50%', boxShadow: '0 8px 18px rgba(41,32,25,.18)' }}>
      {o.prices ? o.prices.map((q, k) => (
        <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: k ? 18 : 0, borderLeft: k ? '3px solid rgba(255,255,255,.35)' : 'none' }}>
          <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>{q.l[lang]}</span>
          <div style={box}><span style={{ fontSize: 58, fontWeight: 900, letterSpacing: '-0.05em' }}>{q.p}</span><span style={{ fontSize: 30, fontWeight: 900, marginBottom: 4 }}>€</span></div>
        </div>
      )).concat(t.unit ? [<span key="u" style={{ alignSelf: 'flex-end', fontSize: 26, fontWeight: 800, marginBottom: 6, whiteSpace: 'nowrap' }}>{t.unit}</span>] : []) : (
        <div style={box}>
          <span style={{ fontSize: 80, fontWeight: 900, letterSpacing: '-0.05em' }}>{o.price}</span>
          <span style={{ fontSize: 40, fontWeight: 900, marginBottom: 4 }}>€</span>
          {t.unit && <span style={{ fontSize: 28, fontWeight: 800, marginLeft: 8, marginBottom: 8, whiteSpace: 'nowrap' }}>{t.unit}</span>}
        </div>
      )}
    </div>
  );
}

function OfferRow({ o, k, s, T, lang, n }) {
  const big = n === 2, rh = big ? 600 : ROW_H;
  const th = THEME[o.market], t = o[lang];
  const alt = o[lang === 'tr' ? 'de' : 'tr'].name.join(' ').replace('- ', '');
  const d = s + 0.35 + k * 0.22;
  const flip = false;
  const x = tw(T, d, d + 0.85, flip ? -1150 : 1150, 0, MOTION.enter);
  const rot = tw(T, d, d + 0.85, flip ? -7 : 7, 0, MOTION.enter);
  const tagP = tw(T, d + 0.5, d + 1.0, 0, 1, MOTION.pop);
  const kb = tw(T, d, d + 6.5, 1, 1.07, Easing.linear);
  const live = tw(T, d + 0.6, d + 1.2, 0, 1, Easing.easeInOutSine);
  const ph = k * 2.1 + (o.market.length * 0.7);
  const wob = Math.sin(T * 1.3 + ph) * 0.8 * live;
  const bob = Math.sin(T * 1.1 + ph * 1.3) * 5 * live;
  const maxLen = Math.max(...t.name.map((l) => l.length));
  const fs = Math.min(big ? 64 : 56, Math.round((big ? 380 : 480) / (maxLen * 0.72)));
  const imgBase = { objectFit: 'contain', mixBlendMode: 'multiply', display: 'block' };
  return (
    <div style={abs({ left: 90, top: ROW_TOP + k * (rh + ROW_GAP), width: 900, height: rh, transform: `translate(${x}px, ${bob}px) rotate(${rot + wob}deg)`, transformOrigin: '50% 50%' })}>
      {big ? (<div style={{ position: 'absolute', inset: 0, background: '#fff', borderRadius: 40, border: '2px solid rgba(41,32,25,.08)', boxShadow: th.shadow, display: 'flex', flexDirection: 'column', padding: 20, gap: 14, boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', borderRadius: 28 }}>
          <img src={A + o.img} alt="" style={Object.assign({ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: `scale(${kb * (o.imgZoom || 1) * 1.3})` }, imgBase)} />
        </div>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6, padding: '0 20px 14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {t.name.map((l, j) => <div key={j} style={{ fontSize: 66, fontWeight: 900, lineHeight: 1.0, letterSpacing: '-0.035em', textTransform: 'uppercase', color: C.nut, whiteSpace: 'nowrap' }}>{l}</div>)}
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.25, color: C.ink2 }}>{o.note ? o.note[lang] : alt}</div>
          <div style={{ position: 'absolute', right: 10, top: -120 }}><PriceTag o={o} t={t} th={th} lang={lang} p={tagP} T={T} ph={ph} /></div>
        </div>
      </div>) : (<div style={{ position: 'absolute', inset: 0, background: '#fff', borderRadius: 40, border: '2px solid rgba(41,32,25,.08)', boxShadow: th.shadow, display: 'grid', gridTemplateColumns: big ? '440px minmax(0,1fr)' : '340px minmax(0,1fr)', gap: 24, padding: flip ? '20px 20px 20px 40px' : '20px 36px 20px 20px', boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 28, order: flip ? 2 : 1 }}>
          {Array.isArray(o.img)
            ? <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: o.imgDir === 'col' ? 'column' : 'row', transform: `scale(${kb})` }}>
                {o.img.map((src, j) => { const off = j - (o.img.length - 1) / 2; return <img key={j} src={A + src} alt="" style={Object.assign({ flex: 1, minWidth: 0, minHeight: 0, width: o.imgDir === 'col' ? '100%' : undefined, height: o.imgDir === 'col' ? undefined : '100%', transform: o.imgDir === 'col' ? `translateY(${-off * 30}px) scale(${o.imgScale[j]})` : `translate(${-off * 0.9 * (o.imgPull ?? 40)}px, ${off * 12}px) rotate(${off * 8}deg) scale(${o.imgScale ? o.imgScale[j] : (j ? 1.35 : 1.75)})` }, imgBase)} />; })}
              </div>
            : <img src={A + o.img} alt="" style={Object.assign({ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: `scale(${kb * (o.imgZoom || 1)})` }, imgBase)} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, minWidth: 0, order: flip ? 1 : 2 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {t.name.map((l, j) => <div key={j} style={{ fontSize: fs, fontWeight: 900, lineHeight: 1.04, letterSpacing: '-0.035em', textTransform: 'uppercase', color: C.nut, whiteSpace: 'nowrap' }}>{l}</div>)}
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.25, color: C.ink2 }}>{o.note ? o.note[lang] : alt}</div>
          <PriceTag o={o} t={t} th={th} lang={lang} p={tagP} T={T} ph={ph} />
        </div>
      </div>)}
    </div>
  );
}

function PageRows({ pg, s, T, lang }) {
  const list = OFFERS.filter((o) => o.page === pg.id);
  return list.map((o, k) => <OfferRow key={k} o={Object.assign({}, o, { market: pg.th })} k={k} s={s} T={T} lang={lang} n={list.length} />);
}

function Watermark({ dark, T, op }) {
  const d = Math.sin(T * 0.25) * 14;
  return <img src={dark ? 'assets/logo/marke-white.svg' : 'assets/logo/marke-dark.svg'} alt="" style={{ position: 'absolute', left: -300, bottom: -260, width: 1150, height: 'auto', opacity: op || (dark ? 0.06 : 0.05), transform: `translate(${d}px, ${-d}px) rotate(-8deg)`, display: 'block', pointerEvents: 'none' }} />;
}

function Piece({ lang }) {
  const { T, CUES } = useComposition();
  const L = COPY[lang] || COPY.tr;
  const c1 = CUES.S1, cC = CUES.CTA;
  const lockIn = tw(T, 0.1, 0.8, 0, 1, MOTION.enter);
  const headDrift = tw(T, 0, c1, 1, 1.04, Easing.linear);
  const eyeIn = tw(T, 0.35, 0.95, 40, 0, MOTION.enter), eyeOp = tw(T, 0.35, 0.95, 0, 1, MOTION.enter);
  const chipP = tw(T, 1.0, 1.6, 0, 1, MOTION.pop);
  const CS = 1.35;
  const infoIn = tw(T, 1.5, 2.1, 0, 1, MOTION.enter);
  const chipBob = Math.sin(T * 1.2) * 8 * tw(T, 1.6, 2.2, 0, 1, Easing.easeInOutSine);

  const ctaLine = (d) => tw(T, cC + 0.15 + d, cC + 0.8 + d, 115, 0, MOTION.enter);
  const ctaFade = (d) => tw(T, cC + 0.3 + d, cC + 0.9 + d, 0, 1, MOTION.enter);
  const btnPop = tw(T, cC + 0.7, cC + 1.2, 0, 1, MOTION.pop);
  const pulse = 1 + Math.max(0, Math.sin((T - cC - 1.4) * 4.2)) * 0.035 * (T > cC + 1.4 ? 1 : 0);
  const phoneY = tw(T, cC + 0.3, cC + 2.0, 1000, -20, Easing.easeInOutCubic) + Math.sin(Math.max(0, T - cC - 2.0) * 1.2) * 10;
  const lockCta = tw(T, cC + 0.1, cC + 0.6, 0, 1, MOTION.enter);
  const rCta = tw(T, cC - 0.45, cC + 0.45, 0, 2400, MOTION.swipe);
  const nextCue = (i) => CUES[i < PAGES.length - 1 ? PAGES[i + 1].cue : 'CTA'];

  return (
    <div lang={lang} style={{ position: 'absolute', inset: 0, width: W, height: H, overflow: 'hidden', background: C.paper, fontFamily: 'Archivo, system-ui, sans-serif' }}>
      <Watermark T={T} />
      <Shot from={0} to={c1 + 0.6}>
        <div style={abs({ left: 540, top: 250, transform: 'translateX(-50%) scale(1.7)', transformOrigin: '50% 0', opacity: lockIn })}><Lockup h={64} /></div>
        <div style={abs({ left: 0, width: W, top: 470, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 })}>
          <div style={{ opacity: eyeOp, transform: `translateY(${eyeIn}px)`, fontSize: 30, fontWeight: 800, letterSpacing: '.2em', textTransform: 'uppercase', color: C.ink2 }}>{L.eyebrow}</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${headDrift})` }}>
            {L.head.map((h, k) => (
              <div key={k} style={{ overflow: 'hidden', paddingTop: 22, marginTop: -10, paddingBottom: 6 }}>
                <div style={{ transform: `translateY(${tw(T, 0.45 + k * 0.12, 1.15 + k * 0.12, 115, 0, MOTION.enter)}%)`, fontSize: 110, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.045em', textTransform: 'uppercase', color: h.red ? C.red : C.nut, whiteSpace: 'nowrap' }}>{h.t}</div>
              </div>
            ))}
          </div>
        </div>
        <MarketChip market="saray" style={{ left: 540 - 210 * CS, top: 900 + chipBob, transform: `translate(${210 * CS * (1 - chipP)}px, ${100 * CS * (1 - chipP)}px) scale(${CS * chipP})` }} />
        <div style={abs({ left: 0, width: W, top: 1230, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, opacity: infoIn, transform: `translateY(${(1 - infoIn) * 40}px)` })}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, height: 100, padding: '0 40px 0 32px', borderRadius: 999, border: '3px solid rgba(41,32,25,.18)', boxSizing: 'border-box' }}>
            <img src="assets/icons/calendar.svg" alt="" style={{ width: 44, height: 44, display: 'block' }} />
            <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.01em', color: C.nut, whiteSpace: 'nowrap' }}>{MK.dates}</span>
          </div>
          <div style={{ fontSize: 40, fontWeight: 600, color: C.ink2 }}>{MK.addr}</div>
          <div style={{ fontSize: 44, fontWeight: 800, color: C.red }}>@{MK.ig}</div>
        </div>
      </Shot>

      {PAGES.map((pg, i) => {
        const s = CUES[pg.cue], e = nextCue(i);
        const r = tw(T, s - 0.45, s + 0.45, 0, 2400, MOTION.swipe);
        const hd = tw(T, s - 0.1, s + 0.6, 1, 0, MOTION.enter);
        const mk = Object.assign({}, MK, { id: pg.th, dark: pg.dark, white: pg.white });
        return (
          <div key={pg.id} style={abs({ inset: 0, background: pg.bg, clipPath: `circle(${r}px at ${i % 2 ? 200 : 880}px 560px)` })}>
            <Watermark dark={pg.dark || pg.white} T={T} op={pg.white ? 0.08 : undefined} />
            <Shot from={s - 0.5} to={e + 0.6}>
              <div style={abs({ left: 90, top: 150, transform: `translateY(${hd * -40}px)` })}><Lockup dark={pg.dark} white={pg.white} h={64} /></div>
              <MarketChip market="saray" style={{ left: 90, top: 280, transform: `translateX(${hd * -600}px) scale(.62)`, border: pg.dark ? undefined : 'none' }} />
              <MarketInfo mk={mk} L={L} hd={hd} />
              <PageRows pg={pg} s={s} T={T} lang={lang} />
            </Shot>
          </div>
        );
      })}

      {/* Layer 5 — Papier: CTA */}
      <div style={abs({ inset: 0, background: C.paper, clipPath: `circle(${rCta}px at 540px 1500px)` })}>
        <Watermark T={T} />
        <Shot from={cC - 0.5} to={cC + 10}>
          <div style={abs({ left: 0, width: W, top: 150, display: 'flex', justifyContent: 'center', opacity: lockCta })}><Lockup h={64} /></div>
          <div style={abs({ left: 0, width: W, top: 280, display: 'flex', flexDirection: 'column', alignItems: 'center' })}>
            {L.cta.map((h, k) => (
              <div key={k} style={{ overflow: 'hidden', paddingTop: 22, marginTop: -10, paddingBottom: 8 }}>
                <div style={{ transform: `translateY(${ctaLine(k * 0.12)}%)`, fontSize: 96, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.045em', textTransform: h.up ? 'uppercase' : 'none', color: h.red ? C.red : C.nut, whiteSpace: 'nowrap' }}>{h.t}</div>
              </div>
            ))}
          </div>
          <div style={abs({ left: 190, top: 680, width: 700, height: 124, transform: `scale(${btnPop * pulse})`, transformOrigin: '50% 50%', borderRadius: 999, background: C.red, boxShadow: '0 12px 28px rgba(194,74,24,.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22 })}>
            <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: '.12em', color: '#fff', textTransform: 'uppercase' }}>{L.btn}</span>
            <img src="assets/icons/arrow_right-white.svg" alt="" style={{ width: 48, height: 48, display: 'block' }} />
          </div>
          <div style={abs({ left: 0, width: W, top: 856, display: 'flex', justifyContent: 'center', gap: 24, opacity: ctaFade(0.6) })}>
            <div style={{ height: 96, width: 300, borderRadius: 20, background: '#fff', border: '2px solid rgba(41,32,25,.10)', display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px', boxSizing: 'border-box', color: '#000' }}>
              <img src="https://cdn.jsdelivr.net/npm/simple-icons@v16/icons/apple.svg" alt="" style={{ width: 46, height: 46, display: 'block' }} />
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
              <img src="assets/wochenangebote/app-screen-saray.png" alt="" style={{ width: '100%', display: 'block' }} />
            </div>
          </div>
        </Shot>
      </div>
    </div>
  );
}

function SarayStory(props) {
  const lang = props.lang === 'tr' ? 'tr' : 'de';
  return (
    <CompositionStage width={W} height={H} bg={C.paper} scenes={window.OM_SCENES} playback={window.OM_PLAYBACK}>
      <Piece lang={lang} />
    </CompositionStage>
  );
}
window.SarayStory = SarayStory;
