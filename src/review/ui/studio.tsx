// Studio-Bausteine: Vorschau in allen Formaten, Design-Panel und Export.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Story } from '../../core/schema';
import {
  BACKGROUNDS, ENTERS, PRESET_DEFS, PRESETS, PRICE_STYLES, QR_TARGETS, SPEEDS, TRANSITIONS, resolveDesign,
  type DesignInput, type Palette,
} from '../../core/design';
import { FORMATS, LAYOUTS, type Format } from '../../core/layout';
import { caption } from '../../core/captions';
import { bannerSuggestions } from '../../core/badges';
import type { ExportOptions, JobClient, RenderState } from './api';
import { PACKS, type PackOptions } from '../../core/packs';
import { countdownDays, weekPlan, weekday, shortDate } from '../../core/magic';

export type View = Format | 'angebot' | 'reel' | 'countdown';
const VIEW_LABEL: Record<View, string> = { story: 'Story 9:16', feed: 'Feed 4:5', quadrat: 'Quadrat 1:1', angebot: 'Einzelbild', reel: 'Top-Reel', countdown: 'Letzte Chance' };

// ---------- Vorschau ----------

export function Preview({ story, base, view, setView }: { story: unknown; base: string; view: View; setView: (v: View) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [lang, setLang] = useState<'de' | 'tr'>('de');
  const [duration, setDuration] = useState(0);
  const [t, setT] = useState(4.5);
  const [offer, setOffer] = useState(0);
  const [days, setDays] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const win = () => frame.current?.contentWindow as (Window & { sincapp?: Window['sincapp'] }) | null;
  const format: Format = view === 'angebot' ? 'feed' : view === 'reel' || view === 'countdown' ? 'story' : view;
  const { W, H } = LAYOUTS[format];
  const scale = 360 / W;
  const offers = (story as Story | null)?.offers.length ?? 0;
  const src = `/index.html?lang=${lang}${format === 'story' ? '' : `&format=${format}`}${view === 'angebot' || view === 'reel' ? `&view=${view === 'reel' ? 'reel' : 'offer'}&offer=${Math.min(offer, Math.max(0, offers - 1))}` : ''}${view === 'countdown' ? `&view=countdown&days=${days}` : ''}&story=${encodeURIComponent(`${base}story.json`)}`;

  const onLoad = useCallback(async () => {
    setReady(false);
    const s = win()?.sincapp;
    if (!s) return;
    try {
      let r = await s.ready;
      if (story) r = await s.setStory(story);
      setDuration(r.duration);
      s.seek(t);
      setReady(true);
    } catch (e) {
      console.error('Vorschau:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Live-Daten übernehmen (leicht verzögert, damit Tippen flüssig bleibt)
  useEffect(() => {
    if (!story || !ready) return;
    const h = setTimeout(async () => {
      const s = win()?.sincapp;
      if (!s) return;
      const r = await s.setStory(story).catch(() => null);
      if (r) setDuration(r.duration);
      s.seek(t);
    }, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, ready]);

  useEffect(() => {
    win()?.sincapp?.seek(t);
  }, [t]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setT((x) => {
        const n = x + (now - last) / 1000;
        return n >= duration ? 0 : n;
      });
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  return (
    <div className="preview">
      <div className="seg views">
        {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{VIEW_LABEL[v]}</button>
        ))}
      </div>
      <div className="row">
        <div className="seg">
          {(['de', 'tr'] as const).map((l) => (
            <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
        {(view === 'angebot' || view === 'reel') && (
          <div className="row tight">
            <button className="ghost" disabled={offer <= 0} onClick={() => setOffer((i) => i - 1)}>‹</button>
            <span className="muted">Angebot {Math.min(offer, offers - 1) + 1} / {offers}</span>
            <button className="ghost" disabled={offer >= offers - 1} onClick={() => setOffer((i) => i + 1)}>›</button>
          </div>
        )}
        {view === 'countdown' && (
          <div className="seg">
            {[2, 1, 0].map((n) => <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n === 0 ? 'Heute' : n === 1 ? 'Morgen' : `${n} Tage`}</button>)}
          </div>
        )}
        {view !== 'angebot' && (
          <>
            <button className="ghost" onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚ Pause' : '▶ Abspielen'}</button>
            <span className="muted">{Math.min(t, duration).toFixed(1)} / {duration.toFixed(1)} s</span>
          </>
        )}
      </div>
      <div className="phone" style={{ width: 360, height: Math.round(H * scale) }}>
        <iframe ref={frame} key={src} src={src} onLoad={onLoad} title="Vorschau" style={{ width: W, height: H, transform: `scale(${scale})` }} />
      </div>
      {view !== 'angebot' && <input type="range" min={0} max={duration || 1} step={0.033} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} />}
    </div>
  );
}

// ---------- Design ----------

const QR_LABEL: Record<(typeof QR_TARGETS)[number], string> = { aus: 'Kein QR-Code', route: '📍 Route zum Markt', instagram: '📷 Instagram', link: '🔗 Eigener Link' };
const BG_LABEL: Record<(typeof BACKGROUNDS)[number], string> = { logo: 'Logo-Wasserzeichen', punkte: 'Punkte', verlauf: 'Verlauf (nicht im Design System)', sterne: 'Sterne & Mond', streifen: 'Streifen', ohne: 'Schlicht' };
const PRICE_LABEL: Record<(typeof PRICE_STYLES)[number], string> = { etikett: 'Etikett (schräg)', kreis: 'Kreis-Sticker', flach: 'Flach' };
const ENTER_LABEL: Record<(typeof ENTERS)[number], string> = { wischen: 'Reinwischen', hoch: 'Von unten', blende: 'Einblenden', pop: 'Aufploppen' };
const TRANS_LABEL: Record<(typeof TRANSITIONS)[number], string> = { kreis: 'Kreis', schieben: 'Schieben', blende: 'Überblenden' };
const SPEED_LABEL: Record<(typeof SPEEDS)[number], string> = { ruhig: 'Ruhig', normal: 'Normal', schnell: 'Schnell' };

function Chips<T extends string>({ value, options, labels, onChange }: { value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>{labels[o]}</button>
      ))}
    </div>
  );
}

function Swatches({ c }: { c: Palette }) {
  return (
    <div className="swatches">
      {[c.paper, ...c.pages.slice(0, 2), c.accent, c.accent2].map((x, i) => <span key={i} style={{ background: x }} />)}
    </div>
  );
}

/** Kräftigste Farben aus dem Markt-Logo (für "Farben aus dem Logo"). */
async function logoColors(url: string): Promise<string[]> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const cv = document.createElement('canvas');
  const k = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight));
  cv.width = Math.max(1, Math.round(img.naturalWidth * k));
  cv.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 60 || max < 60) continue; // grau/weiß/schwarz auslassen
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const x = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    buckets.set(key, { n: x.n + 1, r: x.r + r, g: x.g + g, b: x.b + b });
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((x) => `#${hex(x.r / x.n)}${hex(x.g / x.n)}${hex(x.b / x.n)}`.toUpperCase());
}

const darken = (hex: string, f: number) =>
  '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('').toUpperCase();

export function DesignPanel(p: {
  story: Story;
  update: (fn: (s: Story) => Story) => void;
  api: JobClient;
  say: (t: string, error?: boolean) => void;
  onStory: (s: Story) => void;
}) {
  const design = (p.story.design ?? { preset: 'klassik' }) as DesignInput;
  const r = resolveDesign(design);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    p.api.marketDesign().then((x) => setSaved(x.design ? JSON.stringify(x.design) : null), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isSaved = saved === JSON.stringify(p.story.design ?? null);
  const set = (fn: (d: DesignInput) => DesignInput) =>
    p.update((s) => {
      s.design = fn({ ...(s.design ?? { preset: 'klassik' }) }) as Story['design'];
      return s;
    });
  const setColor = (k: keyof Palette, v: string, idx?: number) =>
    set((d) => {
      const colors = { ...(d.colors ?? {}) };
      if (k === 'pages') {
        const pages = [...(colors.pages ?? r.colors.pages)];
        pages[idx ?? 0] = v.toUpperCase();
        colors.pages = pages;
      } else (colors as Record<string, string>)[k] = v.toUpperCase();
      return { ...d, colors };
    });

  const fromLogo = async () => {
    try {
      const cols = await logoColors(`/markets/${p.story.market.logo}`);
      if (!cols.length) throw new Error('Im Logo wurden keine kräftigen Farben gefunden');
      const main = cols[0];
      set((d) => ({ ...d, colors: { ...(d.colors ?? {}), accent: main, pages: [main, darken(main, 0.3)], ...(cols[1] ? { accent2: cols[1] } : {}) } }));
      p.say('Farben aus dem Logo übernommen');
    } catch (e) {
      p.say((e as Error).message, true);
    }
  };

  const colorRow = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="color">
      <input type="color" value={value.toLowerCase()} onChange={(e) => onChange(e.target.value)} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="design">
      <h2>Vorlage</h2>
      <div className="presets">
        {PRESETS.map((k) => (
          <button key={k} className={`preset ${r.preset === k ? 'on' : ''}`} onClick={() => p.update((s) => ((s.design = { preset: k, qr: s.design?.qr, qrLink: s.design?.qrLink } as Story['design']), s))}>
            <Swatches c={PRESET_DEFS[k].colors} />
            <b>{PRESET_DEFS[k].label}</b>
            <small>{PRESET_DEFS[k].hint}</small>
          </button>
        ))}
      </div>

      <h2>Farben</h2>
      <div className="card colors">
        {colorRow('Seite 1', r.colors.pages[0], (v) => setColor('pages', v, 0))}
        {colorRow('Seite 2', r.colors.pages[1] ?? r.colors.pages[0], (v) => setColor('pages', v, 1))}
        {colorRow('Akzent (Überschrift, Button, Preis)', r.colors.accent, (v) => setColor('accent', v))}
        {colorRow('Preis auf dunklen Seiten', r.colors.accent2, (v) => setColor('accent2', v))}
        {colorRow('Hintergrund Anfang & Schluss', r.colors.paper, (v) => setColor('paper', v))}
        {colorRow('Schrift', r.colors.ink, (v) => setColor('ink', v))}
        <div className="row">
          <button className="ghost" onClick={fromLogo}>🎨 Farben aus dem Markt-Logo</button>
          <button className="ghost" disabled={!design.colors} onClick={() => set((d) => ({ ...d, colors: undefined }))}>Farben zurücksetzen</button>
        </div>
      </div>

      <h2>Hintergrund</h2>
      <Chips value={r.background} options={BACKGROUNDS} labels={BG_LABEL} onChange={(v) => set((d) => ({ ...d, background: v }))} />
      <h2>Preis</h2>
      <Chips value={r.price} options={PRICE_STYLES} labels={PRICE_LABEL} onChange={(v) => set((d) => ({ ...d, price: v }))} />
      <h2>Effekte</h2>
      <div className="effects">
        <div className="field"><span>Angebote erscheinen</span><Chips value={r.enter} options={ENTERS} labels={ENTER_LABEL} onChange={(v) => set((d) => ({ ...d, enter: v }))} /></div>
        <div className="field"><span>Seitenwechsel</span><Chips value={r.transition} options={TRANSITIONS} labels={TRANS_LABEL} onChange={(v) => set((d) => ({ ...d, transition: v }))} /></div>
        <div className="field"><span>Tempo</span><Chips value={r.speed} options={SPEEDS} labels={SPEED_LABEL} onChange={(v) => set((d) => ({ ...d, speed: v }))} /></div>
        <label className="check">
          <input type="checkbox" checked={r.wobble} onChange={(e) => set((d) => ({ ...d, wobble: e.target.checked }))} /> Karten wippen leicht (lebendiger)
        </label>
      </div>

      <h2>Laufband auf den Angebotsseiten</h2>
      <div className="card banner-edit">
        <div className="chips">
          <button className={!p.story.banner ? 'on' : ''} onClick={() => p.update((s) => ((s.banner = undefined), s))}>Kein Laufband</button>
          {bannerSuggestions(p.story.dates.to).map((b) => (
            <button key={b.de} className={p.story.banner?.de === b.de ? 'on' : ''} onClick={() => p.update((s) => ((s.banner = b), s))}>{b.de}</button>
          ))}
        </div>
        <div className="row">
          <label className="grow">
            Eigener Text DE
            <input value={p.story.banner?.de ?? ''} maxLength={60} onChange={(e) => p.update((s) => ((s.banner = e.target.value || s.banner?.tr ? { de: e.target.value, tr: s.banner?.tr ?? '' } : undefined), s))} />
          </label>
          <label className="grow">
            TR
            <input value={p.story.banner?.tr ?? ''} maxLength={60} onChange={(e) => p.update((s) => ((s.banner = e.target.value || s.banner?.de ? { de: s.banner?.de ?? '', tr: e.target.value } : undefined), s))} />
          </label>
        </div>
        <small className="muted">Sticker wie „Knaller!“ oder „Halal“ setzt du pro Angebot im Schritt Angebote.</small>
      </div>

      <h2>QR-Code am Schluss</h2>
      <div className="card banner-edit">
        <Chips value={r.qr} options={QR_TARGETS} labels={QR_LABEL} onChange={(v) => set((d) => ({ ...d, qr: v }))} />
        {r.qr === 'link' && (
          <label>
            Link (z. B. eure Website oder WhatsApp)
            <input value={design.qrLink ?? ''} placeholder="https://…" onChange={(e) => set((d) => ({ ...d, qrLink: /^https?:\/\/\S+\.\S+/.test(e.target.value) ? e.target.value.trim() : undefined }))} />
          </label>
        )}
        {r.qr === 'instagram' && !p.story.market.instagram && <small className="warn">Für diesen Markt ist kein Instagram-Name eingetragen.</small>}
        <small className="muted">Gut für den Bildschirm im Laden, das Schaufenster oder ausgedruckte Bilder: Kunden scannen und landen direkt bei der Route oder auf Instagram.</small>
      </div>

      <h2>{p.story.market.name}</h2>
      <div className="card row">
        <button
          className={isSaved ? 'ghost' : ''}
          disabled={isSaved}
          onClick={async () => {
            try {
              const r2 = await p.api.saveMarketDesign(p.story.design ?? { preset: 'klassik' });
              setSaved(JSON.stringify(r2.design));
              p.say(`Gespeichert – neue Videos für ${p.story.market.name} starten mit diesem Design`);
            } catch (e) {
              p.say((e as Error).message, true);
            }
          }}
        >
          {isSaved ? `✓ Standard für ${p.story.market.name}` : `Als Standard für ${p.story.market.name} speichern`}
        </button>
        <label className="ghostbtn">
          Eigenes Logo hochladen
          <input
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const r2 = await p.api.uploadLogo(f);
                p.onStory(r2.story);
                p.say('Logo übernommen – gilt ab jetzt für alle Videos dieses Markts');
              } catch (err) {
                p.say((err as Error).message, true);
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}

// ---------- Export ----------

type ExportChoice = PackOptions & { langs: ('de' | 'tr')[] };
const STORE = 'sincapp.export';

function load(): ExportChoice {
  try {
    const x = JSON.parse(localStorage.getItem(STORE) ?? '');
    if (x && Array.isArray(x.videos)) return { reels: 0, countdown: false, plan: false, ...x };
  } catch {
    /* Standard */
  }
  return { ...PACKS[0].opts, langs: ['de', 'tr'] };
}

export function ExportPanel(p: { story: Story; base: string; api: JobClient; render: RenderState | null; start: (o: ExportOptions) => void; dirty: boolean; disabled: boolean }) {
  const [c, setC] = useState<ExportChoice>(load);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(c));
    } catch {
      /* egal */
    }
  }, [c]);
  const toggle = (k: 'videos' | 'pageImages' | 'offerImages', f: Format) =>
    setC((x) => ({ ...x, [k]: x[k].includes(f) ? x[k].filter((y) => y !== f) : [...x[k], f] }));
  const toggleLang = (l: 'de' | 'tr') => setC((x) => ({ ...x, langs: x.langs.includes(l) ? x.langs.filter((y) => y !== l) : [...x.langs, l] }));
  const nOffers = p.story.offers.length;
  const plan = useMemo(() => (c.plan ? weekPlan(p.story, c.countdown) : []), [c.plan, c.countdown, p.story]);
  const count = useMemo(() => {
    const L = c.langs.length;
    const pages = (f: Format) => (f === 'quadrat' ? Math.ceil(nOffers / 2) : nOffers < 2 ? 0 : nOffers % 3 === 1 ? Math.floor(nOffers / 3) + 1 : Math.ceil(nOffers / 3)) + 2;
    const reels = Math.min(nOffers, Math.max(c.reels, ...plan.map((d) => d.offer + 1)));
    const cds = c.countdown ? countdownDays(p.story).length : 0;
    const videos = (c.videos.length + reels + cds) * L;
    const images = (c.pageImages.reduce((a, f) => a + pages(f), 0) + c.offerImages.length * nOffers + plan.length) * L;
    const minutes = Math.max(1, Math.round(c.videos.length * L * 1.2 + (reels + cds) * L * 0.4 + images * 0.05));
    return { videos, images, minutes };
  }, [c, nOffers, plan, p.story]);
  const key = (x: PackOptions) => JSON.stringify([x.videos, x.reels, x.pageImages, x.offerImages, x.captions, x.countdown, x.plan]);
  const active = PACKS.find((x) => key(x.opts) === key(c));
  const running = !!p.render?.running;
  const nothing = !c.langs.length || (!c.videos.length && !c.reels && !c.pageImages.length && !c.offerImages.length && !c.captions && !c.countdown && !c.plan);
  const box = (k: 'videos' | 'pageImages' | 'offerImages', f: Format, label = VIEW_LABEL[f]) => (
    <label className="check" key={k + f}>
      <input type="checkbox" checked={c[k].includes(f)} onChange={() => toggle(k, f)} /> {label}
    </label>
  );
  return (
    <div className="export">
      <h2>Was brauchst du?</h2>
      <div className="packs">
        {PACKS.map((x) => (
          <button key={x.key} className={`preset ${active?.key === x.key ? 'on' : ''}`} onClick={() => setC((y) => ({ ...x.opts, langs: y.langs }))}>
            <b>{x.label}</b>
            <small>{x.hint}</small>
          </button>
        ))}
      </div>
      <div className="card exportopts">
        <div className="field"><span>Videos</span><div className="checks">{FORMATS.map((f) => box('videos', f))}</div></div>
        <div className="field"><span>Kurz-Reels (7 s) für die Top-Angebote – Reihenfolge wie im Schritt Angebote</span>
          <div className="chips">{[0, 1, 3, 5].map((n) => <button key={n} className={c.reels === n ? 'on' : ''} onClick={() => setC((x) => ({ ...x, reels: n }))}>{n === 0 ? 'keine' : `${n} Reel${n === 1 ? '' : 's'}`}</button>)}</div>
        </div>
        <div className="field"><span>Zauber-Extras</span><div className="checks col">
          <label className="check"><input type="checkbox" checked={c.plan} onChange={(e) => setC((x) => ({ ...x, plan: e.target.checked }))} /> 📅 7-Tage-Plan: jeden Tag ein Top-Angebot als Reel, Bild und Text, nach Tagen sortiert</label>
          <label className="check"><input type="checkbox" checked={c.countdown} onChange={(e) => setC((x) => ({ ...x, countdown: e.target.checked }))} /> ⏰ „Letzte Chance“-Videos ({countdownDays(p.story).map((n) => (n === 0 ? '„Nur noch heute!“' : `„Noch ${n} Tage!“`)).join(' und ')})</label>
        </div></div>
        {plan.length > 0 && (
          <div className="plan">
            {plan.map((d) => (
              <div key={d.date} className="planday">
                <b>{weekday(d.date, 'de').slice(0, 2)} {shortDate(d.date)}</b>
                <img src={`${p.base}${p.story.offers[d.offer].img}`} loading="lazy" />
                <small>{p.story.offers[d.offer].name.de.join(' ').replace(/- /g, '')}</small>
                {d.countdown != null && <small className="cd">⏰ {d.countdown === 0 ? 'heute' : `noch ${d.countdown}`}</small>}
              </div>
            ))}
          </div>
        )}
        <div className="field"><span>Seiten als Bilder (Karussell)</span><div className="checks">{FORMATS.map((f) => box('pageImages', f))}</div></div>
        <div className="field"><span>Jedes Angebot einzeln als Bild</span><div className="checks">{box('offerImages', 'feed')}{box('offerImages', 'quadrat')}</div></div>
        <div className="field"><span>Sprachen</span><div className="checks">
          {(['de', 'tr'] as const).map((l) => <label className="check" key={l}><input type="checkbox" checked={c.langs.includes(l)} onChange={() => toggleLang(l)} /> {l === 'de' ? 'Deutsch' : 'Türkisch'}</label>)}
        </div></div>
        <label className="check"><input type="checkbox" checked={c.captions} onChange={(e) => setC((x) => ({ ...x, captions: e.target.checked }))} /> Instagram-Texte mit Hashtags</label>
      </div>
      <div className="row">
        <span className="muted">{count.videos} Videos · {count.images} Bilder · ca. {count.minutes} Min. · kostet keine KI-Tokens</span>
        <div className="spacer" />
        <button className="primary big" disabled={running || nothing || p.disabled} onClick={() => p.start(c)}>
          {running ? `${Math.round((p.render?.fraction ?? 0) * 100)} % · ${p.render?.message ?? ''}` : p.dirty ? 'Speichern & exportieren' : 'Export starten'}
        </button>
      </div>
      {running && <div className="progressbar inline"><div style={{ width: `${((p.render?.fraction ?? 0) * 100).toFixed(1)}%` }} /></div>}
      {p.render?.result && !running && <ExportResult r={p.render.result} />}
      {c.captions && <Captions story={p.story} langs={c.langs} />}
    </div>
  );
}

function ExportResult({ r }: { r: NonNullable<RenderState['result']> }) {
  const url = (path: string) => `${r.urlBase}${path}`;
  const videos = r.files.filter((f) => f.kind === 'video' && !f.day);
  const images = r.files.filter((f) => f.kind === 'image' && !f.day);
  const days = [...new Set(r.files.filter((f) => f.day).map((f) => f.day!))];
  const overview = r.files.find((f) => f.path.endsWith('wochenplan.txt'));
  return (
    <div className="card render">
      <div className="row">
        <b>Fertig in {Math.round(r.seconds)} s</b>
        <div className="spacer" />
        {r.zip && <a className="download big" href={url(r.zip)} download>⬇ Alles als ZIP</a>}
      </div>
      {videos.map((f) => {
        const c = r.checks.find((x) => x.rel === f.path);
        return (
          <div key={f.path}>
            <a className="download" href={url(f.path)} download>⬇ {f.label}</a>{' '}
            {c && <span className={c.ok ? 'ok' : 'warn'}>{c.ok ? `✓ ${c.info.sizeMB.toFixed(1)} MB, ${c.info.duration.toFixed(1)} s` : `⚠ ${c.problems.join('; ')}`}</span>}
          </div>
        );
      })}
      {days.length > 0 && (
        <>
          <h3>📅 7-Tage-Plan {overview && <a className="small" href={url(overview.path)} target="_blank">Übersicht</a>}</h3>
          <div className="plan result">
            {days.map((day) => {
              const fs = r.files.filter((f) => f.day === day);
              const img = fs.find((f) => f.kind === 'image');
              return (
                <div key={day} className="planday">
                  <b>{day}</b>
                  {img && <a href={url(img.path)} download><img src={url(img.path)} loading="lazy" /></a>}
                  {fs.filter((f) => f.kind !== 'image').map((f) => <a key={f.path} className="small" href={url(f.path)} download>⬇ {f.label}</a>)}
                </div>
              );
            })}
          </div>
        </>
      )}
      {images.length > 0 && (
        <div className="thumbs">
          {images.map((f) => (
            <a key={f.path} href={url(f.path)} download title={f.label}>
              <img src={url(f.path)} loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Captions({ story, langs }: { story: Story; langs: ('de' | 'tr')[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <>
      <h2>Instagram-Text</h2>
      <div className="captions">
        {langs.map((l) => {
          const text = caption(story, l);
          return (
            <div key={l} className="card caption">
              <div className="row">
                <b>{l === 'de' ? 'Deutsch' : 'Türkisch'}</b>
                <div className="spacer" />
                <button
                  className="ghost"
                  onClick={() =>
                    navigator.clipboard.writeText(text).then(() => {
                      setCopied(l);
                      setTimeout(() => setCopied(null), 1500);
                    })
                  }
                >
                  {copied === l ? '✓ Kopiert' : 'Kopieren'}
                </button>
              </div>
              <pre>{text}</pre>
            </div>
          );
        })}
      </div>
    </>
  );
}
