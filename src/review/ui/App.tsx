import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Story as StorySchema } from '../../core/schema';
import { formatDateRange } from '../../core/format';
import type { ExtractedOffer, Extraction } from '../../extract/schema';
import { api, type State, type StoryOffer } from './api';
import type { Story } from '../../core/schema';

const TR_MAX = 14;
type Busy = Record<string, string | undefined>;

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Busy>({});
  const [imgV, setImgV] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [dialog, setDialog] = useState<string | null>(null);
  const [render, setRender] = useState<Awaited<ReturnType<typeof api.render>> | 'running' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.state().then((s) => {
      setState(s);
      setStory(s.story);
    }, (e) => setLoadError(e.message));
  }, []);

  const say = (text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), error ? 8000 : 3500);
  };

  const update = (fn: (s: Story) => Story) => {
    setStory((s) => (s ? fn(structuredClone(s)) : s));
    setDirty(true);
  };
  const setOffer = (i: number, fn: (o: StoryOffer) => void) =>
    update((s) => {
      fn(s.offers[i]);
      return s;
    });

  const extraction = state?.extraction ?? null;
  const exById = useMemo(() => new Map((extraction?.offers ?? []).map((o) => [o.id, o])), [extraction]);
  const replaceExOffer = (o: ExtractedOffer) =>
    setState((s) => (s && s.extraction ? { ...s, extraction: { ...s.extraction, offers: s.extraction.offers.map((x) => (x.id === o.id ? o : x)) } } : s));

  const validation = useMemo(() => {
    if (!story) return null;
    const r = StorySchema.safeParse(story);
    if (r.success) return null;
    return r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  }, [story]);

  // Vorschau-Daten: Bilder mit Cache-Buster, damit neue Freisteller sofort erscheinen
  const previewStory = useMemo(() => {
    if (!story || validation) return null;
    return { ...story, offers: story.offers.map((o) => ({ ...o, img: o.id && imgV[o.id] ? `${o.img}?v=${imgV[o.id]}` : o.img })) };
  }, [story, validation, imgV]);

  const run = async (id: string, label: string, fn: () => Promise<void>) => {
    setBusy((b) => ({ ...b, [id]: label }));
    try {
      await fn();
    } catch (e) {
      say((e as Error).message, true);
    } finally {
      setBusy((b) => ({ ...b, [id]: undefined }));
    }
  };

  const imageChanged = (o: ExtractedOffer, warnings: string[] = []) => {
    replaceExOffer(o);
    setImgV((v) => ({ ...v, [o.id]: Date.now() }));
    update((s) => {
      for (const x of s.offers) if (x.id === o.id) x.img = o.img ?? x.img;
      return s;
    });
    say(warnings.length ? `Bild übernommen – Hinweis: ${warnings.join('; ')}` : 'Bild übernommen und in der Bibliothek gespeichert');
  };

  const addOffer = (id: string) =>
    run(id, 'Bild wird gesucht …', async () => {
      const r = await api.auto(id);
      replaceExOffer(r.offer);
      setImgV((v) => ({ ...v, [id]: Date.now() }));
      update((s) => {
        s.offers.push(r.story as StoryOffer);
        return s;
      });
      if (r.notes.length) say(r.notes.join(' '));
    });

  const save = async () => {
    if (!story) return;
    try {
      const r = await api.saveStory(story);
      setStory(r.story);
      setDirty(false);
      say('Gespeichert');
      return true;
    } catch (e) {
      say((e as Error).message, true);
      return false;
    }
  };

  const doRender = async () => {
    if (!(await save())) return;
    setRender('running');
    try {
      setRender(await api.render());
    } catch (e) {
      setRender(null);
      say((e as Error).message, true);
    }
  };

  if (loadError) return <div className="empty">Fehler: {loadError}</div>;
  if (!state || !story) return <div className="empty">Lade …</div>;

  const inStory = new Set(story.offers.map((o) => o.id));
  const others = (extraction?.offers ?? []).filter((o) => !inStory.has(o.id) && o.price);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="dot" /> Review · {story.market.name}
        </div>
        <div className="spacer" />
        {dirty && <span className="hint">ungespeichert</span>}
        <button onClick={save} disabled={!!validation}>Speichern</button>
        <button className="primary" onClick={doRender} disabled={!!validation || render === 'running'}>
          {render === 'running' ? 'Rendert … (1–3 Min.)' : 'Video rendern'}
        </button>
      </header>

      <main>
        <section className="edit">
          <StoryHeader story={story} update={update} />
          {validation && (
            <div className="errors">
              {validation.map((v) => (
                <div key={v}>⚠ {v}</div>
              ))}
            </div>
          )}
          <OfferCount n={story.offers.length} />
          <OfferList
            story={story}
            exById={exById}
            busy={busy}
            imgV={imgV}
            setOffer={setOffer}
            update={update}
            openImage={(id) => setDialog(id)}
          />
          <h2>Weitere Angebote aus dem Prospekt</h2>
          {!others.length && <p className="muted">Alle erkannten Angebote sind in der Story.</p>}
          <div className="others">
            {others.map((o) => (
              <div key={o.id} className="other">
                <div>
                  <b>{o.price} €</b> {o.brand} {o.name.de} {o.unit && <span className="muted">· {o.unit}</span>}
                  {o.priceConfidence < 0.9 && <span className="warn"> · Preis prüfen</span>}
                </div>
                <button disabled={!!busy[o.id] || story.offers.length >= 15} onClick={() => addOffer(o.id)}>
                  {busy[o.id] ?? 'Hinzufügen'}
                </button>
              </div>
            ))}
          </div>
        </section>
        <aside>
          <Preview story={previewStory} />
          {render && render !== 'running' && <RenderResult r={render} />}
        </aside>
      </main>

      {dialog && exById.get(dialog) && (
        <ImageDialog
          offer={exById.get(dialog)!}
          search={state.search}
          busy={busy[dialog]}
          onClose={() => setDialog(null)}
          run={(label, fn) => run(dialog, label, fn)}
          onImage={imageChanged}
          onOffer={replaceExOffer}
        />
      )}
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.text}</div>}
    </div>
  );
}

function OfferCount({ n }: { n: number }) {
  const pages = n < 2 ? 0 : n % 3 === 1 ? Math.floor(n / 3) + 1 : Math.ceil(n / 3);
  return (
    <h2>
      In der Story: {n} Angebote · {pages} Seiten {(n < 5 || n > 8) && <span className="warn">(empfohlen 5–8)</span>}
    </h2>
  );
}

function StoryHeader({ story, update }: { story: Story; update: (fn: (s: Story) => Story) => void }) {
  const lines = (lang: 'de' | 'tr') => (
    <LineInputs
      lines={story.headline[lang]}
      max={lang === 'tr' ? TR_MAX : undefined}
      onChange={(l) =>
        update((s) => {
          s.headline[lang] = l;
          return s;
        })
      }
    />
  );
  return (
    <div className="card head">
      <div className="row">
        <label>
          Gültig von
          <input type="date" value={story.dates.from} onChange={(e) => update((s) => ((s.dates.from = e.target.value), s))} />
        </label>
        <label>
          bis
          <input type="date" value={story.dates.to} onChange={(e) => update((s) => ((s.dates.to = e.target.value), s))} />
        </label>
        <span className="muted">{story.dates.from <= story.dates.to ? formatDateRange(story.dates.from, story.dates.to) : ''}</span>
      </div>
      <div className="row">
        <div className="field">
          <span>Überschrift DE</span>
          {lines('de')}
        </div>
        <div className="field">
          <span>Überschrift TR</span>
          {lines('tr')}
        </div>
      </div>
      <div className="row">
        <label className="grow">
          Zeile über der Überschrift DE
          <input value={story.eyebrow?.de ?? ''} onChange={(e) => update((s) => ((s.eyebrow = { de: e.target.value, tr: s.eyebrow?.tr ?? '' }), s))} />
        </label>
        <label className="grow">
          TR
          <input value={story.eyebrow?.tr ?? ''} onChange={(e) => update((s) => ((s.eyebrow = { de: s.eyebrow?.de ?? '', tr: e.target.value }), s))} />
        </label>
      </div>
    </div>
  );
}

function LineInputs({ lines, onChange, max }: { lines: string[]; onChange: (l: string[]) => void; max?: number }) {
  const set = (i: number, v: string) => {
    const next = [lines[0] ?? '', lines[1] ?? ''];
    next[i] = v;
    onChange(next.filter((x, j) => j === 0 || x.trim() !== ''));
  };
  return (
    <div className="lines">
      {[0, 1].map((i) => {
        const v = lines[i] ?? '';
        const over = max !== undefined && v.length > max;
        return (
          <div key={i} className="line">
            <input value={v} placeholder={i === 0 ? 'Zeile 1' : 'Zeile 2 (optional)'} onChange={(e) => set(i, e.target.value)} className={over ? 'over' : ''} />
            {max !== undefined && <small className={over ? 'warn' : 'muted'}>{v.length}/{max}</small>}
          </div>
        );
      })}
    </div>
  );
}

function OfferList(p: {
  story: Story;
  exById: Map<string, ExtractedOffer>;
  busy: Busy;
  imgV: Record<string, number>;
  setOffer: (i: number, fn: (o: StoryOffer) => void) => void;
  update: (fn: (s: Story) => Story) => void;
  openImage: (id: string) => void;
}) {
  const drag = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = (from: number, to: number) =>
    p.update((s) => {
      const [o] = s.offers.splice(from, 1);
      s.offers.splice(to, 0, o);
      return s;
    });

  return (
    <div className="offers">
      {p.story.offers.map((o, i) => {
        const ex = o.id ? p.exById.get(o.id) : undefined;
        const imgWarn = ex?.warnings.filter((w) => w.startsWith('Bild:')) ?? [];
        const priceWarn = ex && ex.price === o.price && ex.priceConfidence < 0.9;
        const unit = typeof o.unit === 'string' ? o.unit : o.unit?.de ?? '';
        return (
          <div
            key={o.id ?? i}
            className={`card offer ${over === i ? 'dropzone' : ''}`}
            draggable
            onDragStart={() => (drag.current = i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(i);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={() => {
              if (drag.current !== null && drag.current !== i) move(drag.current, i);
              drag.current = null;
              setOver(null);
            }}
          >
            <div className="handle" title="Ziehen zum Sortieren">⋮⋮</div>
            <div className="thumb" onClick={() => o.id && p.openImage(o.id)} title="Bild ändern">
              <img src={`/job/${o.img}${o.id && p.imgV[o.id] ? `?v=${p.imgV[o.id]}` : ''}`} style={{ transform: `scale(${o.imgZoom})` }} />
              <span className="src">{p.busy[o.id ?? ''] ?? sourceLabel(ex?.imgSource)}</span>
            </div>
            <div className="fields">
              <div className="row">
                <label>
                  Preis €
                  <input className={/^\d{1,4},\d{2}$/.test(o.price) ? '' : 'over'} value={o.price} onChange={(e) => p.setOffer(i, (x) => (x.price = e.target.value.replace('.', ',')))} />
                </label>
                <label>
                  Menge
                  <input value={unit} onChange={(e) => p.setOffer(i, (x) => (x.unit = e.target.value || undefined))} />
                </label>
                <label>
                  Zoom
                  <input type="range" min={0.6} max={1.8} step={0.05} value={o.imgZoom} onChange={(e) => p.setOffer(i, (x) => (x.imgZoom = Number(e.target.value)))} />
                </label>
                <div className="spacer" />
                <button className="ghost" onClick={() => o.id && p.openImage(o.id)}>Bild ändern</button>
                <button
                  className="ghost danger"
                  disabled={p.story.offers.length <= 2}
                  onClick={() =>
                    p.update((s) => {
                      s.offers.splice(i, 1);
                      return s;
                    })
                  }
                >
                  Entfernen
                </button>
              </div>
              <div className="row">
                <div className="field">
                  <span>Name DE</span>
                  <LineInputs lines={o.name.de} onChange={(l) => p.setOffer(i, (x) => (x.name.de = l))} />
                </div>
                <div className="field">
                  <span>Name TR</span>
                  <LineInputs lines={o.name.tr} max={TR_MAX} onChange={(l) => p.setOffer(i, (x) => (x.name.tr = l))} />
                </div>
              </div>
              <div className="row">
                <label className="grow">
                  Zusatz DE
                  <input value={o.note?.de ?? ''} onChange={(e) => p.setOffer(i, (x) => (x.note = e.target.value || x.note?.tr ? { de: e.target.value, tr: x.note?.tr ?? '' } : undefined))} />
                </label>
                <label className="grow">
                  Zusatz TR
                  <input value={o.note?.tr ?? ''} onChange={(e) => p.setOffer(i, (x) => (x.note = e.target.value || x.note?.de ? { de: x.note?.de ?? '', tr: e.target.value } : undefined))} />
                </label>
              </div>
              {(priceWarn || imgWarn.length > 0) && (
                <div className="warnings">
                  {priceWarn && <div>⚠ Preis bitte mit dem Prospekt vergleichen (Lesungen stimmten nicht überein).</div>}
                  {imgWarn.map((w) => (
                    <div key={w}>⚠ {w.replace(/^Bild: /, '')}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function sourceLabel(s?: string) {
  return s === 'library' ? 'Bibliothek' : s === 'web' ? 'Internet' : s === 'manual' ? 'eigenes Bild' : s === 'removebg' ? 'remove.bg' : 'Prospekt';
}

function Preview({ story }: { story: unknown }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [lang, setLang] = useState<'de' | 'tr'>('de');
  const [duration, setDuration] = useState(0);
  const [t, setT] = useState(4.5);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const win = () => frame.current?.contentWindow as (Window & { sincapp?: Window['sincapp'] }) | null;

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
  }, [lang]);

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
      <div className="row">
        <div className="seg">
          {(['de', 'tr'] as const).map((l) => (
            <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <button className="ghost" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Abspielen'}</button>
        <span className="muted">
          {t.toFixed(1)} / {duration.toFixed(1)} s
        </span>
      </div>
      <div className="phone">
        <iframe ref={frame} key={lang} src={`/index.html?lang=${lang}`} onLoad={onLoad} title="Vorschau" />
      </div>
      <input type="range" min={0} max={duration || 1} step={0.033} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} />
    </div>
  );
}

function RenderResult({ r }: { r: Awaited<ReturnType<typeof api.render>> }) {
  return (
    <div className="card render">
      <b>Fertig in {r.seconds.toFixed(0)} s</b>
      {Object.entries(r.videos).map(([lang, url]) => {
        const c = r.checks.find((x) => url.endsWith(x.file));
        return (
          <div key={lang}>
            <a href={url} download>story-{lang}.mp4</a> {c && <span className={c.ok ? 'ok' : 'warn'}>{c.ok ? `✓ ${c.sizeMB.toFixed(1)} MB, ${c.duration.toFixed(1)} s` : `⚠ ${c.problems.join('; ')}`}</span>}
          </div>
        );
      })}
      {r.poster && <a href={r.poster} download>preview.png</a>}
    </div>
  );
}

function ImageDialog(p: {
  offer: ExtractedOffer;
  search: State['search'];
  busy?: string;
  onClose: () => void;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  onImage: (o: ExtractedOffer, warnings?: string[]) => void;
  onOffer: (o: ExtractedOffer) => void;
}) {
  const o = p.offer;
  const [tab, setTab] = useState<'web' | 'crop' | 'upload'>(o.imgAlternatives?.length ? 'web' : 'crop');
  const [query, setQuery] = useState([o.brand, o.name.de, o.unit].filter(Boolean).join(' '));
  return (
    <div className="modal" onClick={p.onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>
            Bild: {o.brand} {o.name.de} <span className="muted">{o.unit}</span>
          </h3>
          <div className="spacer" />
          <button className="ghost" onClick={p.onClose}>Schließen</button>
        </div>
        <div className="seg">
          <button className={tab === 'web' ? 'on' : ''} onClick={() => setTab('web')}>Internet</button>
          <button className={tab === 'crop' ? 'on' : ''} onClick={() => setTab('crop')}>Aus dem Prospekt</button>
          <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>Eigenes Bild</button>
          {p.busy && <span className="muted"> {p.busy}</span>}
        </div>

        {tab === 'web' && (
          <div>
            <div className="row">
              <input className="grow" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && document.getElementById('searchbtn')?.click()} />
              <button
                id="searchbtn"
                disabled={!!p.busy}
                onClick={() =>
                  p.run('Suche …', async () => {
                    const r = await api.search(o.id, query);
                    p.onOffer(r.offer);
                  })
                }
              >
                Suchen
              </button>
            </div>
            {!p.search.brave && <p className="muted">Gesucht wird nur bei Open Food Facts. Für Bilder aus dem ganzen Netz <code>BRAVE_API_KEY</code> in die .env eintragen.</p>}
            <div className="grid">
              {(o.imgAlternatives ?? []).map((a, i) => (
                <div key={a.url} className={`cand ${a.match ? 'match' : ''}`}>
                  {a.file ? <img src={`/job/${a.file}`} /> : <div className="noimg">nicht geladen</div>}
                  <small title={a.title}>{a.title || a.source}</small>
                  {a.verdict && <small className={a.match ? 'ok' : 'muted'}>{a.match ? '✓ ' : ''}{a.verdict}</small>}
                  <button
                    disabled={!a.file || !!p.busy}
                    onClick={() =>
                      p.run('Wird freigestellt …', async () => {
                        const r = await api.alternative(o.id, i);
                        p.onImage(r.offer, r.warnings);
                        p.onClose();
                      })
                    }
                  >
                    Nehmen
                  </button>
                </div>
              ))}
              {!o.imgAlternatives?.length && <p className="muted">Noch keine Treffer – oben suchen.</p>}
            </div>
          </div>
        )}

        {tab === 'crop' && (
          <CropTool
            offer={o}
            busy={!!p.busy}
            onCrop={(bbox) =>
              p.run('Wird freigestellt …', async () => {
                const r = await api.crop(o.id, bbox);
                p.onImage(r.offer, r.warnings);
                p.onClose();
              })
            }
          />
        )}

        {tab === 'upload' && (
          <label
            className="drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f)
                void p.run('Wird freigestellt …', async () => {
                  const r = await api.upload(o.id, f);
                  p.onImage(r.offer, r.warnings);
                  p.onClose();
                });
            }}
          >
            Produktfoto hierher ziehen oder klicken (JPG, PNG, WEBP)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void p.run('Wird freigestellt …', async () => {
                    const r = await api.upload(o.id, f);
                    p.onImage(r.offer, r.warnings);
                    p.onClose();
                  });
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}

/** Seite anzeigen, Rechteck ziehen, ausschneiden. Koordinaten in Pixeln des Seitenbilds. */
function CropTool({ offer, busy, onCrop }: { offer: ExtractedOffer; busy: boolean; onCrop: (bbox: number[]) => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<number[]>(offer.bbox);
  const [scale, setScale] = useState(1);
  const start = useRef<[number, number] | null>(null);
  const pos = (e: React.MouseEvent) => {
    const r = img.current!.getBoundingClientRect();
    const k = r.width / img.current!.naturalWidth;
    if (k !== scale) setScale(k);
    return [Math.max(0, (e.clientX - r.left) / k), Math.max(0, (e.clientY - r.top) / k)] as [number, number];
  };
  const [x0, y0, x1, y1] = box;
  const tag = offer.priceTagBbox;
  return (
    <div>
      <p className="muted">Rechteck um das Produkt ziehen – ohne Preisschild und ohne Text. Das Preisschild (gestrichelt) wird automatisch entfernt.</p>
      <div className="cropwrap">
        <img
          ref={img}
          src={`/job/${offer.pageFile}`}
          draggable={false}
          onLoad={(e) => setScale(e.currentTarget.clientWidth / e.currentTarget.naturalWidth)}
          onMouseDown={(e) => {
            start.current = pos(e);
            setBox([...start.current, ...start.current]);
          }}
          onMouseMove={(e) => {
            if (!start.current) return;
            const [a, b] = start.current;
            const [c, d] = pos(e);
            setBox([Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]);
          }}
          onMouseUp={() => (start.current = null)}
        />
        <div className="sel" style={{ left: x0 * scale, top: y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale }} />
        {tag && <div className="tag" style={{ left: tag[0] * scale, top: tag[1] * scale, width: (tag[2] - tag[0]) * scale, height: (tag[3] - tag[1]) * scale }} />}
      </div>
      <div className="row">
        <button className="ghost" onClick={() => setBox(offer.bbox)}>Zurücksetzen</button>
        <div className="spacer" />
        <button className="primary" disabled={busy || x1 - x0 < 20 || y1 - y0 < 20} onClick={() => onCrop(box.map(Math.round))}>
          Ausschneiden
        </button>
      </div>
    </div>
  );
}

export type { Extraction };
