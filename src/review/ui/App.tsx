import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Story as StorySchema } from '../../core/schema';
import { formatDateRange } from '../../core/format';
import type { ExtractedOffer, Extraction } from '../../extract/schema';
import { type ExportOptions, type JobClient, type RenderState, type State, type StoryOffer } from './api';
import { DesignPanel, ExportPanel, Preview, type View } from './studio';
import type { Story } from '../../core/schema';

const TR_MAX = 14;

/** API und URL-Basis des geöffneten Jobs (z. B. "/jobs/<id>/") */
const JobCtx = createContext<{ api: JobClient; base: string }>(null!);
type Busy = Record<string, string | undefined>;

export function ReviewPage({ api, title, onBack }: { api: JobClient; title?: string; onBack?: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [story, setStory] = useState<Story | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Busy>({});
  const [imgV, setImgV] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [dialog, setDialog] = useState<string | null>(null);
  const [render, setRender] = useState<RenderState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<'angebote' | 'design' | 'export'>('angebote');
  const [view, setView] = useState<View>('story');

  useEffect(() => {
    api.state().then((s) => {
      setState(s);
      setStory(s.story);
      if (s.render.running || s.render.result) setRender(s.render);
    }, (e) => setLoadError(e.message));
  }, [api]);

  // Fortschritt beim Rendern abfragen
  useEffect(() => {
    if (!render?.running) return;
    const h = setInterval(async () => {
      try {
        const r = await api.renderState();
        setRender(r);
        if (r.error) say(r.error, true);
      } catch {
        /* nächster Versuch */
      }
    }, 1000);
    return () => clearInterval(h);
  }, [render?.running, api]);

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

  const doExport = async (opts: ExportOptions) => {
    if (dirty && !(await save())) return;
    try {
      setRender(await api.startRender(opts));
    } catch (e) {
      say((e as Error).message, true);
    }
  };

  if (loadError) return <div className="empty">Fehler: {loadError}</div>;
  if (!state || !story) return <div className="empty">Lade …</div>;

  const inStory = new Set(story.offers.map((o) => o.id));
  const others = (extraction?.offers ?? []).filter((o) => !inStory.has(o.id) && o.price);

  const rendering = !!render?.running;
  return (
    <JobCtx.Provider value={{ api, base: state.urlBase }}>
    <div className="app">
      <header>
        {onBack && <button className="ghost back" onClick={onBack}>← Übersicht</button>}
        <div className="brand">
          <span className="dot" /> {title ?? `Prüfen · ${story.market.name}`}
        </div>
        <div className="spacer" />
        {dirty && <span className="hint">ungespeichert</span>}
        <button onClick={save} disabled={!!validation || rendering || !dirty}>{dirty ? 'Speichern' : '✓ Gespeichert'}</button>
        {tab !== 'export' && (
          <button className="primary" onClick={() => setTab('export')} disabled={!!validation}>
            {rendering ? `Export läuft … ${Math.round((render?.fraction ?? 0) * 100)} %` : 'Weiter zum Export →'}
          </button>
        )}
      </header>
      {rendering && <div className="progressbar"><div style={{ width: `${(render!.fraction * 100).toFixed(1)}%` }} /></div>}

      <main>
        <section className="edit">
          <div className="tabs">
            <button className={tab === 'angebote' ? 'on' : ''} onClick={() => setTab('angebote')}><i>1</i> Angebote</button>
            <button className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}><i>2</i> Design</button>
            <button className={tab === 'export' ? 'on' : ''} onClick={() => setTab('export')}><i>3</i> Export</button>
          </div>
          {validation && (
            <div className="errors">
              {validation.map((v) => (
                <div key={v}>⚠ {v}</div>
              ))}
            </div>
          )}
          {tab === 'design' && <DesignPanel story={story} update={update} api={api} say={say} onStory={(s) => { setStory(s); setDirty(false); }} />}
          {tab === 'export' && <ExportPanel story={story} api={api} render={render} start={doExport} dirty={dirty} disabled={!!validation} />}
          {tab === 'angebote' && <>
          <StoryHeader story={story} update={update} />
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
          <div className="next"><button className="primary" onClick={() => setTab('design')}>Weiter zum Design →</button></div>
          </>}
        </section>
        <aside>
          <Preview story={previewStory} base={state.urlBase} view={view} setView={setView} />
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
    </JobCtx.Provider>
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
  const { base } = useContext(JobCtx);
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
              <img src={`${base}${o.img}${o.id && p.imgV[o.id] ? `?v=${p.imgV[o.id]}` : ''}`} style={{ transform: `scale(${o.imgZoom})` }} />
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

function ImageDialog(p: {
  offer: ExtractedOffer;
  search: State['search'];
  busy?: string;
  onClose: () => void;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  onImage: (o: ExtractedOffer, warnings?: string[]) => void;
  onOffer: (o: ExtractedOffer) => void;
}) {
  const { api, base } = useContext(JobCtx);
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
                    if (!r.offer.imgAlternatives?.length) throw new Error(r.errors.length ? `Suche fehlgeschlagen: ${r.errors.join('; ')}` : `Keine Treffer für „${r.query}“`);
                  })
                }
              >
                Suchen
              </button>
            </div>
            {!p.search.brave && <p className="muted">Ohne Brave-Key wird nur bei Open Food Facts gesucht – dort gibt es viele türkische Marken nicht. Für Bilder aus dem ganzen Netz den Brave-Key unter <a href="#/einstellungen">Einstellungen</a> eintragen.</p>}
            <div className="grid">
              {(o.imgAlternatives ?? []).map((a, i) => (
                <div key={a.url} className={`cand ${a.match ? 'match' : ''}`}>
                  {a.file ? <img src={`${base}${a.file}`} /> : <div className="noimg">nicht geladen</div>}
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
            onCrop={(sel) =>
              p.run(sel.removeBackground ? 'Wird freigestellt …' : 'Wird ausgeschnitten …', async () => {
                const r = await api.crop(o.id, sel);
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

type CropSel = { bbox: number[]; polygon?: number[][]; removeBackground?: boolean };

/**
 * Seite anzeigen und das Produkt auswählen: Rechteck ziehen oder mit dem Pen umranden
 * (klicken setzt Punkte, ziehen zeichnet frei). Koordinaten in Pixeln des Seitenbilds.
 * Der Ausschnitt bleibt wie gewählt; der Hintergrund wird nur auf Wunsch entfernt.
 */
function CropTool({ offer, busy, onCrop }: { offer: ExtractedOffer; busy: boolean; onCrop: (sel: CropSel) => void }) {
  const { base } = useContext(JobCtx);
  const img = useRef<HTMLImageElement>(null);
  const [tool, setTool] = useState<'rect' | 'pen'>('rect');
  const [box, setBox] = useState<number[]>(offer.bbox);
  const [pts, setPts] = useState<number[][]>([]);
  const [closed, setClosed] = useState(false);
  const [removeBg, setRemoveBg] = useState(false);
  const [scale, setScale] = useState(1);
  const drag = useRef<{ start: [number, number]; moved: boolean } | null>(null);
  const pos = (e: React.PointerEvent) => {
    const r = img.current!.getBoundingClientRect();
    const k = r.width / img.current!.naturalWidth;
    if (k !== scale) setScale(k);
    const W = img.current!.naturalWidth;
    const H = img.current!.naturalHeight;
    return [Math.min(W, Math.max(0, (e.clientX - r.left) / k)), Math.min(H, Math.max(0, (e.clientY - r.top) / k))] as [number, number];
  };
  const near = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * scale, (a[1] - b[1]) * scale) < 12;
  const resetPen = () => {
    setPts([]);
    setClosed(false);
  };

  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pos(e);
    drag.current = { start: p, moved: false };
    if (tool === 'rect') return setBox([...p, ...p]);
    if (closed) {
      setPts([p]);
      setClosed(false);
    } else if (pts.length >= 3 && near(p, pts[0])) {
      setClosed(true);
      drag.current = null;
    } else setPts((x) => [...x, p]);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = pos(e);
    if (tool === 'rect') {
      const [a, b] = drag.current.start;
      return setBox([Math.min(a, p[0]), Math.min(b, p[1]), Math.max(a, p[0]), Math.max(b, p[1])]);
    }
    // Freihand: Punkte im Abstand von ein paar Bildschirmpixeln mitnehmen
    setPts((x) => (x.length && Math.hypot((x[x.length - 1][0] - p[0]) * scale, (x[x.length - 1][1] - p[1]) * scale) < 5 ? x : [...x, p]));
    drag.current.moved = true;
  };
  const up = () => {
    if (tool === 'pen' && drag.current?.moved && pts.length >= 8) setClosed(true);
    drag.current = null;
  };

  const [x0, y0, x1, y1] = box;
  const tag = offer.priceTagBbox;
  const penReady = closed && pts.length >= 3;
  const rectReady = x1 - x0 >= 20 && y1 - y0 >= 20;
  const ready = tool === 'rect' ? rectReady : penReady;
  return (
    <div>
      <div className="row">
        <div className="seg small">
          <button className={tool === 'rect' ? 'on' : ''} onClick={() => setTool('rect')}>▭ Rechteck</button>
          <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')}>✎ Pen (umranden)</button>
        </div>
        <label className="check">
          <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} /> Hintergrund zusätzlich entfernen
        </label>
      </div>
      <p className="muted">
        {tool === 'rect'
          ? 'Rechteck um das Produkt ziehen. Der Ausschnitt wird genau so übernommen.'
          : penReady
            ? 'Form geschlossen. Mit „Ausschneiden“ übernehmen oder neu zeichnen.'
            : 'Punkte um das Produkt setzen oder mit gedrückter Maustaste frei umranden. Zum Schließen auf den ersten Punkt klicken.'}
      </p>
      <div className="cropwrap" onPointerDown={down} onPointerMove={move} onPointerUp={up} onDoubleClick={() => tool === 'pen' && pts.length >= 3 && setClosed(true)}>
        <img ref={img} src={`${base}${offer.pageFile}`} draggable={false} onLoad={(e) => setScale(e.currentTarget.clientWidth / e.currentTarget.naturalWidth)} />
        {tool === 'rect' && <div className="sel" style={{ left: x0 * scale, top: y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale }} />}
        {tool === 'pen' && pts.length > 0 && (
          <svg className="pen">
            {penReady && <path d={`M${pts.map((p) => `${p[0] * scale},${p[1] * scale}`).join('L')}Z`} className="shade" fillRule="evenodd" />}
            <polyline points={pts.map((p) => `${p[0] * scale},${p[1] * scale}`).join(' ') + (penReady ? ` ${pts[0][0] * scale},${pts[0][1] * scale}` : '')} />
            {!penReady && pts.length < 60 && pts.map((p, i) => <circle key={i} cx={p[0] * scale} cy={p[1] * scale} r={i === 0 ? 7 : 4} className={i === 0 ? 'first' : ''} />)}
          </svg>
        )}
        {removeBg && tag && <div className="tag" style={{ left: tag[0] * scale, top: tag[1] * scale, width: (tag[2] - tag[0]) * scale, height: (tag[3] - tag[1]) * scale }} />}
      </div>
      <div className="row">
        {tool === 'rect' ? (
          <button className="ghost" onClick={() => setBox(offer.bbox)}>Zurücksetzen</button>
        ) : (
          <>
            <button className="ghost" disabled={!pts.length} onClick={() => (closed ? setClosed(false) : setPts((x) => x.slice(0, -1)))}>Letzten Punkt weg</button>
            <button className="ghost" disabled={!pts.length} onClick={resetPen}>Neu zeichnen</button>
            {!closed && pts.length >= 3 && <button className="ghost" onClick={() => setClosed(true)}>Form schließen</button>}
          </>
        )}
        <div className="spacer" />
        <button
          className="primary"
          disabled={busy || !ready}
          onClick={() =>
            onCrop(
              tool === 'rect'
                ? { bbox: box.map(Math.round), removeBackground: removeBg }
                : { bbox: [], polygon: pts.map((p) => p.map(Math.round)), removeBackground: removeBg },
            )
          }
        >
          Ausschneiden
        </button>
      </div>
    </div>
  );
}

export type { Extraction };
