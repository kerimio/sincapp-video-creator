// Produkt-Katalog: alle freigestellten Produkte mit Marke, Menge, Sorte und Warengruppe,
// geordnet, durchsuchbar und von Hand zu pflegen. Füllt sich beim Prüfen von selbst.
import { useEffect, useMemo, useRef, useState } from 'react';
import { bestPriceWeeks, CATEGORIES, CATEGORY_LABEL, parseSize, unitPrice, type Category, type Size } from '../../core/catalog';
import { formatDateRange } from '../../core/format';
import { call } from './api';
import { go, Shell } from './pages';

interface Sighting { market: string; price: string | null; from: string | null; to: string | null; job?: string }
interface Entry {
  key: string; brand: string | null; name: { de: string; tr: string }; unit: string | null; img: string; url: string;
  source: { type: string; url?: string }; verified: boolean; uses: number; addedAt: string; usedAt: string;
  category?: Category; variant?: { de: string; tr: string } | null; ean?: string | null; seen?: Sighting[];
  webTried?: string; single?: boolean;
}
interface ImproveRun { running: boolean; done: number; total: number; internet: number; bereinigt: number; current: string }
type Row = Entry & { size: Size | null; cat: Category; last: Sighting | null };

const SORTS = {
  gruppe: 'Warengruppe',
  marke: 'Marke A–Z',
  name: 'Produkt A–Z',
  menge: 'Menge',
  preis: 'Letzter Preis',
  neu: 'Zuletzt hinzugefügt',
  oft: 'Am häufigsten benutzt',
} as const;
type Sort = keyof typeof SORTS;
const SOURCE: Record<string, string> = { web: 'Internet', openfoodfacts: 'Open Food Facts', prospekt: 'Prospekt-Ausschnitt', manual: 'eigenes Bild' };
const STORE = 'sincapp.katalog';
const coll = new Intl.Collator('de', { sensitivity: 'base' });
const priceNum = (p: string | null | undefined) => (p ? Number(p.replace(',', '.')) : NaN);
const fullName = (e: Entry) => `${e.brand ? `${e.brand} ` : ''}${e.name.de}`;

function loadPrefs(): { sort: Sort; view: 'raster' | 'liste' } {
  try {
    const x = JSON.parse(localStorage.getItem(STORE) ?? '');
    if (x && x.sort in SORTS) return x;
  } catch {
    /* Standard */
  }
  return { sort: 'gruppe', view: 'raster' };
}

export function CatalogPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'alle'>('alle');
  const [brand, setBrand] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [open, setOpen] = useState<string | null>(null);
  const [improve, setImprove] = useState<ImproveRun | null>(null);
  const [ai, setAi] = useState(false);
  // Kampagne: gewählte Produkte (Reihenfolge = Reihenfolge im Video); null = normaler Katalog
  const [pick, setPick] = useState<string[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const toggle = (img: string) => setPick((p) => (p ? (p.includes(img) ? p.filter((x) => x !== img) : p.length >= 15 ? p : [...p, img]) : p));
  const openOrPick = (img: string) => (pick ? toggle(img) : setOpen(img));
  const load = () => call<Entry[]>('GET', '/api/library').then(setEntries, (e) => setErr(e.message));
  useEffect(() => {
    load();
    call<ImproveRun>('GET', '/api/library/verbessern').then(setImprove, () => {});
    call<{ ai: string | null }>('GET', '/api/settings').then((x) => setAi(!!x.ai), () => {});
  }, []);
  // Fortschritt beim Verbessern abfragen, am Ende Katalog neu laden
  useEffect(() => {
    if (!improve?.running) return;
    const t = setTimeout(async () => {
      const r = await call<ImproveRun>('GET', '/api/library/verbessern').catch(() => null);
      if (r && !r.running) load();
      setImprove(r);
    }, 2000);
    return () => clearTimeout(t);
  }, [improve]);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(prefs));
    } catch {
      /* egal */
    }
  }, [prefs]);

  const rows: Row[] = useMemo(
    () => (entries ?? []).map((e) => ({ ...e, size: parseSize(e.unit), cat: e.category ?? 'sonstiges', last: e.seen?.[0] ?? null })),
    [entries],
  );
  const brands = useMemo(() => [...new Set(rows.map((r) => r.brand).filter((b): b is string => !!b))].sort(coll.compare), [rows]);
  const needle = q.trim().toLocaleLowerCase('tr');
  const filtered = rows.filter(
    (r) =>
      (cat === 'alle' || r.cat === cat) &&
      (!brand || r.brand === brand) &&
      (!onlyOpen || !r.category || !r.unit || !r.verified) &&
      (!needle || `${r.brand ?? ''} ${r.name.de} ${r.name.tr} ${r.variant?.de ?? ''} ${r.variant?.tr ?? ''} ${r.unit ?? ''} ${r.ean ?? ''}`.toLocaleLowerCase('tr').includes(needle)),
  );
  const byName = (a: Row, b: Row) => coll.compare(a.name.de, b.name.de) || (a.size?.total ?? 0) - (b.size?.total ?? 0);
  const sorted = [...filtered].sort((a, b) => {
    switch (prefs.sort) {
      case 'marke': return coll.compare(a.brand ?? '~', b.brand ?? '~') || byName(a, b);
      case 'name': return byName(a, b);
      case 'menge': return (a.size?.base ?? 'z').localeCompare(b.size?.base ?? 'z') || (a.size?.total ?? Infinity) - (b.size?.total ?? Infinity);
      case 'preis': return (priceNum(a.last?.price) || Infinity) - (priceNum(b.last?.price) || Infinity);
      case 'neu': return b.addedAt.localeCompare(a.addedAt);
      case 'oft': return b.uses - a.uses;
      default: return CATEGORIES.indexOf(a.cat) - CATEGORIES.indexOf(b.cat) || coll.compare(a.brand ?? '~', b.brand ?? '~') || byName(a, b);
    }
  });
  // Raster nach Warengruppe (oder Marke) in Abschnitte teilen
  const groupOf = (r: Row) => (prefs.sort === 'marke' ? r.brand ?? 'Ohne Marke' : prefs.sort === 'gruppe' ? CATEGORY_LABEL[r.cat].de : '');
  const groups: [string, Row[]][] = [];
  for (const r of sorted) {
    const g = groupOf(r);
    if (groups.at(-1)?.[0] === g) groups.at(-1)![1].push(r);
    else groups.push([g, [r]]);
  }
  const counts = useMemo(() => {
    const c = new Map<Category, number>();
    for (const r of rows) c.set(r.cat, (c.get(r.cat) ?? 0) + 1);
    return c;
  }, [rows]);
  const incomplete = rows.filter((r) => !r.category || !r.unit || !r.verified).length;
  // Prospekt-Bilder, die noch verbessert werden können (Internet noch nicht versucht oder nicht bereinigt)
  const improvable = rows.filter((r) => r.source.type === 'prospekt' && (!r.single || (ai && !r.webTried))).length;
  const current = rows.find((r) => r.img === open) ?? null;

  return (
    <Shell active="lib">
      <div className="catalog">
        <div className="row cat-head">
          <div className="grow">
            <h1>Produkt-Katalog</h1>
            {entries && (
              <p className="muted">
                {rows.length} Produkte · {brands.length} Marken · {counts.size} Warengruppen
                {incomplete > 0 && <> · <button className="link" onClick={() => setOnlyOpen(!onlyOpen)}>{incomplete} unvollständig</button></>}
              </p>
            )}
          </div>
          <input className="search" placeholder="Marke, Produkt, Sorte, Menge oder EAN …" value={q} onChange={(e) => setQ(e.target.value)} />
          {!pick && rows.length >= 2 && <button className="primary" onClick={() => setPick([])}>Kampagne erstellen</button>}
        </div>
        {pick && (
          <div className="card cat-improve cat-pickhint">
            <div className="grow">
              <b>Kampagne aus dem Katalog</b>
              <span className="muted small">Produkte antippen (2 bis 15, in der Reihenfolge fürs Video). Danach Preise und Zeitraum eintragen – ohne Prospekt und ohne KI.</span>
            </div>
          </div>
        )}

        {improve?.running ? (
          <div className="card cat-improve">
            <b>Bilder werden verbessert … {improve.done}/{improve.total}</b>
            <span className="muted small">{improve.current && `${improve.current} · `}{improve.internet} aus dem Internet, {improve.bereinigt} zugeschnitten</span>
            <progress max={improve.total || 1} value={improve.done} />
          </div>
        ) : improvable > 0 ? (
          <div className="card cat-improve">
            <div className="grow">
              <b>{improvable} {improvable === 1 ? 'Bild stammt' : 'Bilder stammen'} aus dem Prospekt</b>
              <span className="muted small">Zuerst wird ein sauberes Foto im Internet gesucht (je Produkt eine kurze KI-Prüfung, nur einmal). Gibt es keins, wird der Ausschnitt auf eine Packung zugeschnitten.</span>
            </div>
            <button className="primary" onClick={() => call<ImproveRun>('POST', '/api/library/verbessern').then(setImprove, (e) => setErr(e.message))}>Bilder verbessern</button>
          </div>
        ) : improve && improve.total > 0 && improve.done === improve.total ? (
          <p className="muted small">Fertig: {improve.internet} Bilder aus dem Internet, {improve.bereinigt} auf eine Packung zugeschnitten.</p>
        ) : null}

        <div className="chips cat-chips">
          <button className={cat === 'alle' ? 'on' : ''} onClick={() => setCat('alle')}>Alle <small>{rows.length}</small></button>
          {CATEGORIES.filter((c) => counts.get(c)).map((c) => (
            <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{CATEGORY_LABEL[c].de} <small>{counts.get(c)}</small></button>
          ))}
        </div>

        <div className="row cat-tools">
          <label>
            Marke
            <select value={brand} onChange={(e) => setBrand(e.target.value)}>
              <option value="">Alle Marken</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label>
            Sortieren
            <select value={prefs.sort} onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value as Sort }))}>
              {Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Nur unvollständige</label>
          <div className="spacer" />
          <div className="seg">
            <button className={prefs.view === 'raster' ? 'on' : ''} onClick={() => setPrefs((p) => ({ ...p, view: 'raster' }))}>Raster</button>
            <button className={prefs.view === 'liste' ? 'on' : ''} onClick={() => setPrefs((p) => ({ ...p, view: 'liste' }))}>Liste</button>
          </div>
        </div>

        {err && <div className="errors">{err}</div>}
        {!entries && !err && <p className="muted">Lade Katalog …</p>}
        {entries && !rows.length && (
          <div className="card empty">
            <b>Der Katalog ist noch leer.</b>
            <p className="muted">Er füllt sich von selbst: Jedes Produktbild, das du beim Prüfen ausschneidest oder auswählst, landet hier – mit Marke, Menge, Sorte und Warengruppe aus dem Prospekt. Beim nächsten Prospekt wird es automatisch wiederverwendet (kostet keine KI).</p>
          </div>
        )}
        {entries && rows.length > 0 && !sorted.length && <p className="muted">Nichts gefunden.</p>}

        {prefs.view === 'raster' ? (
          groups.map(([g, list]) => (
            <section key={g || 'alle'}>
              {g && <h2 className="cat-group">{g} <small className="muted">{list.length}</small></h2>}
              <div className="cat-grid">
                {list.map((r) => <ProductCard key={r.img} r={r} pickNo={pick ? pick.indexOf(r.img) + 1 : undefined} onOpen={() => openOrPick(r.img)} />)}
              </div>
            </section>
          ))
        ) : (
          sorted.length > 0 && <ProductTable rows={sorted} pick={pick} onOpen={openOrPick} />
        )}
      </div>
      {pick && (
        <div className="pickbar">
          <b>{pick.length} {pick.length === 1 ? 'Produkt' : 'Produkte'} gewählt</b>
          <span className="grow" />
          <button className="ghost" onClick={() => setPick(null)}>Abbrechen</button>
          <button className="primary" disabled={pick.length < 2} onClick={() => setPlanning(true)}>Weiter</button>
        </div>
      )}
      {pick && planning && (
        <CampaignDialog rows={pick.map((img) => rows.find((r) => r.img === img)!).filter(Boolean)} onClose={() => setPlanning(false)} />
      )}
      {current && (
        <ProductEditor
          r={current}
          onClose={() => setOpen(null)}
          onSaved={(e) => setEntries((xs) => xs && xs.map((x) => (x.img === e.img ? e : x)))}
          onRemoved={() => {
            setOpen(null);
            setEntries((xs) => xs && xs.filter((x) => x.img !== current.img));
          }}
        />
      )}
    </Shell>
  );
}

function ProductCard({ r, onOpen, pickNo }: { r: Row; onOpen: () => void; pickNo?: number }) {
  const up = unitPrice(r.last?.price, r.size);
  return (
    <button className={`product${pickNo ? ' picked' : ''}`} onClick={onOpen} title={pickNo === undefined ? 'Bearbeiten' : 'Für die Kampagne wählen'}>
      <div className="pimg">
        {pickNo !== undefined && <span className="picknum">{pickNo || ''}</span>}
        <img src={r.url} loading="lazy" alt="" />
      </div>
      <div className="pbody">
        <span className="pbrand">
          {r.brand ?? 'Ohne Marke'}
          {!r.verified && <span className="flag inline">ungeprüft</span>}
        </span>
        <b className="pname">{r.name.de}</b>
        <span className="ptr">{r.name.tr}</span>
        <div className="ptags">
          {r.size ? <span className="ptag">{r.size.label}</span> : <span className="ptag missing">Menge fehlt</span>}
          {r.variant && (r.variant.de || r.variant.tr) && <span className="ptag">{r.variant.de || r.variant.tr}</span>}
        </div>
        {r.last?.price && (
          <div className="pprice">
            <b>{r.last.price} €</b>
            {up && <small>{up}</small>}
            <small className="muted">{r.last.market}</small>
          </div>
        )}
      </div>
    </button>
  );
}

function ProductTable({ rows, onOpen, pick }: { rows: Row[]; onOpen: (img: string) => void; pick: string[] | null }) {
  return (
    <div className="card cat-table-wrap">
      <table className="cat-table">
        <thead>
          <tr>
            <th />
            <th>Marke</th>
            <th>Produkt</th>
            <th className="opt">Türkisch</th>
            <th>Sorte</th>
            <th>Menge</th>
            <th>Warengruppe</th>
            <th className="num">Letzter Preis</th>
            <th className="num">Grundpreis</th>
            <th className="num">Benutzt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.img} className={pick?.includes(r.img) ? 'picked' : ''} onClick={() => onOpen(r.img)}>
              <td><img src={r.url} loading="lazy" alt="" /></td>
              <td>{r.brand ?? <span className="muted">–</span>}</td>
              <td><b>{r.name.de}</b>{!r.verified && <span className="flag inline">ungeprüft</span>}</td>
              <td className="muted opt">{r.name.tr}</td>
              <td>{r.variant?.de || r.variant?.tr || <span className="muted">–</span>}</td>
              <td className="qty">{r.size?.label ?? (r.unit || <span className="warn">fehlt</span>)}</td>
              <td>{CATEGORY_LABEL[r.cat].de}</td>
              <td className="num">{r.last?.price ? `${r.last.price} €` : '–'}</td>
              <td className="num muted">{unitPrice(r.last?.price, r.size) ?? '–'}</td>
              <td className="num">{r.uses}×</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductEditor({ r, onClose, onSaved, onRemoved }: { r: Row; onClose: () => void; onSaved: (e: Entry) => void; onRemoved: () => void }) {
  const [f, setF] = useState({
    brand: r.brand ?? '',
    de: r.name.de,
    tr: r.name.tr,
    unit: r.unit ?? '',
    vde: r.variant?.de ?? '',
    vtr: r.variant?.tr ?? '',
    category: r.cat,
    ean: r.ean ?? '',
    verified: r.verified,
  });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const size = parseSize(f.unit);
  const base = `/api/library/${encodeURIComponent(r.img)}`;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const save = async () => {
    setBusy('Speichert …');
    try {
      const e = await call<Entry>('PATCH', base, {
        brand: f.brand,
        name: { de: f.de, tr: f.tr },
        unit: f.unit,
        variant: { de: f.vde, tr: f.vtr },
        category: f.category,
        ean: f.ean,
        verified: f.verified,
      });
      onSaved(e);
      setMsg({ text: 'Gespeichert' });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
    setBusy('');
  };
  const replace = async (fl: File | undefined) => {
    if (!fl) return;
    setBusy('Lädt hoch …');
    try {
      onSaved(await call<Entry>('POST', `${base}/bild`, undefined, fl));
      setMsg({ text: 'Neues Bild übernommen' });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
    setBusy('');
  };
  const fromWeb = async () => {
    setBusy('Sucht im Internet …');
    try {
      const r = await call<{ result: string; note?: string; entry: Entry }>('POST', `${base}/internet`);
      onSaved(r.entry);
      setMsg({ text: r.result === 'internet' ? 'Sauberes Foto aus dem Internet übernommen' : r.result === 'bereinigt' ? `${r.note ? `${r.note}. ` : ''}Ausschnitt auf eine Packung zugeschnitten` : r.note ?? 'Nichts geändert', error: r.result === 'unverändert' });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
    setBusy('');
  };
  const remove = async () => {
    if (!confirm(`„${fullName(r)}“ aus dem Katalog entfernen? Beim nächsten Prospekt wird dafür wieder ein Bild gesucht.`)) return;
    await call('DELETE', base);
    onRemoved();
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">{fullName(r)}</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-img">
          <img src={r.url} alt="" />
        </div>
        <div className="row">
          <button className="ghost" onClick={() => file.current?.click()} disabled={!!busy}>Eigenes Bild</button>
          {r.source.type === 'prospekt' && <button className="ghost" onClick={fromWeb} disabled={!!busy}>Im Internet suchen</button>}
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => replace(e.target.files?.[0])} />
          <span className="muted small">Quelle: {SOURCE[r.source.type] ?? r.source.type}{r.source.url && <> · <a href={r.source.url} target="_blank" rel="noreferrer">Original</a></>}</span>
        </div>
        <div className="form">
          <label>Marke<input value={f.brand} onChange={set('brand')} placeholder="z. B. Egetürk" /></label>
          <label>Warengruppe
            <select value={f.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c].de}</option>)}
            </select>
          </label>
          <label>Produkt (Deutsch)<input value={f.de} onChange={set('de')} /></label>
          <label>Produkt (Türkisch)<input value={f.tr} onChange={set('tr')} /></label>
          <label>Sorte (Deutsch)<input value={f.vde} onChange={set('vde')} placeholder="z. B. scharf, Karamell" /></label>
          <label>Sorte (Türkisch)<input value={f.vtr} onChange={set('vtr')} placeholder="z. B. acılı, karamelli" /></label>
          <label>Menge / Gewicht
            <input value={f.unit} onChange={set('unit')} placeholder="z. B. 800 g, 5×140 g, 1,5 l" />
            <small className={f.unit && !size ? 'warn' : 'muted'}>{f.unit ? (size ? `= ${size.label}` : 'nicht erkannt – z. B. „800 g“ schreiben') : 'Gewicht oder Inhalt der Packung'}</small>
          </label>
          <label>EAN / Barcode<input value={f.ean} onChange={set('ean')} inputMode="numeric" placeholder="optional" /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.verified} onChange={(e) => setF((x) => ({ ...x, verified: e.target.checked }))} /> Geprüft: Bild zeigt genau dieses Produkt</label>
        <div className="row">
          <button className="ghost danger" onClick={remove}>Entfernen</button>
          <div className="spacer" />
          {msg && <span className={msg.error ? 'warn' : 'ok'}>{msg.text}</span>}
          <button className="primary" onClick={save} disabled={!!busy || !f.de.trim()}>{busy || 'Speichern'}</button>
        </div>

        <h3>In Prospekten</h3>
        {r.seen?.length ? (
          <table className="seen">
            <tbody>
              {r.seen.map((s, i) => (
                <tr key={i}>
                  <td>{s.market || '–'}</td>
                  <td className="muted">{s.from && s.to ? formatDateRange(s.from, s.to) : '–'}</td>
                  <td className="num"><b>{s.price ? `${s.price} €` : '–'}</b></td>
                  <td className="num muted">{unitPrice(s.price, size) ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">Noch in keinem gelesenen Prospekt gefunden.</p>
        )}
        <p className="muted small">{r.uses}× in Videos benutzt · im Katalog seit {new Date(r.addedAt).toLocaleDateString('de-DE')}</p>
      </div>
    </div>
  );
}

interface MarketOption { value: string; name: string; firestore: boolean }
const isoDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

/** Preise und Zeitraum für die gewählten Produkte, dann Zauberknopf oder erst prüfen. */
function CampaignDialog({ rows, onClose }: { rows: Row[]; onClose: () => void }) {
  const [markets, setMarkets] = useState<MarketOption[] | null>(null);
  const [market, setMarket] = useState('');
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState(() => isoDay(new Date()));
  const [to, setTo] = useState(() => isoDay(new Date(Date.now() + 6 * 86_400_000)));
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.img, r.last?.price?.replace('.', ',') ?? ''])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const local = () => call<{ slug: string; name: string }[]>('GET', '/api/markets').then((l) => l.map((m) => ({ value: m.slug, name: m.name, firestore: false })));
    call<{ id: string; name: string }[]>('GET', '/api/firestore/markets')
      .then((l) => l.map((m) => ({ value: m.id, name: m.name, firestore: true })), local)
      .then((l) => {
        l.sort((a, b) => coll.compare(a.name, b.name));
        setMarkets(l);
        // zuletzt gesehener Markt der Produkte vorwählen
        const seen = rows.map((r) => r.last?.market).find(Boolean);
        setMarket(l.find((m) => m.name === seen)?.value ?? l[0]?.value ?? '');
      }, (e) => setErr(e.message));
  }, [rows]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const missing = rows.filter((r) => !/^\d+([.,]\d{1,2})?$/.test((prices[r.img] ?? '').trim()));
  const start = async (auto: boolean) => {
    const m = markets?.find((x) => x.value === market);
    if (!m) return setErr('Bitte einen Markt wählen');
    setBusy(true);
    setErr('');
    try {
      const job = await call<{ id: string }>('POST', '/api/kampagne', {
        ...(m.firestore ? { marketId: m.value } : { market: m.value }),
        title: title.trim() || `${m.name}: Aktion ${from.slice(8, 10)}.${from.slice(5, 7)}.`,
        from,
        to,
        auto,
        items: rows.map((r) => ({ img: r.img, price: prices[r.img].trim() })),
      });
      go(`#/job/${job.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">Kampagne: {rows.length} Produkte</h2>
          <button className="ghost" onClick={onClose}>✕</button>
        </div>
        <div className="form">
          <label>Markt
            <select value={market} onChange={(e) => setMarket(e.target.value)} disabled={!markets}>
              {!markets && <option>lädt …</option>}
              {markets?.map((m) => <option key={m.value} value={m.value}>{m.name}</option>)}
            </select>
          </label>
          <label>Name (optional)<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Grill-Aktion" /></label>
          <label>Gültig ab<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Gültig bis<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <h3>Aktionspreise</h3>
        <div className="camp-items">
          {rows.map((r) => {
            const weeks = bestPriceWeeks(prices[r.img]?.replace(',', '.'), r.seen, from);
            return (
              <div key={r.img} className="camp-item">
                <img src={r.url} alt="" />
                <div className="grow">
                  <b>{fullName(r)}</b>
                  <span className="muted small">
                    {[r.size?.label ?? r.unit, r.last?.price && `zuletzt ${r.last.price.replace('.', ',')} €`].filter(Boolean).join(' · ')}
                  </span>
                  {weeks && <span className="best">Bester Preis seit {weeks} Wochen</span>}
                </div>
                <label className="price">
                  <input inputMode="decimal" value={prices[r.img] ?? ''} placeholder="0,00" onChange={(e) => setPrices((p) => ({ ...p, [r.img]: e.target.value }))} />
                  €
                </label>
              </div>
            );
          })}
        </div>
        {err && <p className="warn">{err}</p>}
        {missing.length > 0 && <p className="muted small">Noch ohne gültigen Preis: {missing.map(fullName).join(', ')}</p>}
        <div className="row">
          <button className="ghost" disabled={busy || missing.length > 0 || from > to} onClick={() => start(false)}>Erst prüfen</button>
          <span className="grow" />
          <button className="primary" disabled={busy || missing.length > 0 || from > to} onClick={() => start(true)}>{busy ? 'Startet …' : '🐿 Zauberknopf'}</button>
        </div>
        <p className="muted small">Zauberknopf: Story-Videos, Reels, Bilder, 7-Tage-Plan und Texte in DE und TR, alles in einem Rutsch.</p>
      </div>
    </div>
  );
}
