// Produkt-Katalog: alle freigestellten Produkte mit Marke, Menge, Sorte und Warengruppe,
// geordnet, durchsuchbar und von Hand zu pflegen. Füllt sich beim Prüfen von selbst.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_LABEL, parseSize, unitPrice, type Category, type Size } from '../../core/catalog';
import { formatDateRange } from '../../core/format';
import { call } from './api';
import { Shell } from './pages';

interface Sighting { market: string; price: string | null; from: string | null; to: string | null; job?: string }
interface Entry {
  key: string; brand: string | null; name: { de: string; tr: string }; unit: string | null; img: string; url: string;
  source: { type: string; url?: string }; verified: boolean; uses: number; addedAt: string; usedAt: string;
  category?: Category; variant?: { de: string; tr: string } | null; ean?: string | null; seen?: Sighting[];
}
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
  const load = () => call<Entry[]>('GET', '/api/library').then(setEntries, (e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);
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
        </div>

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
                {list.map((r) => <ProductCard key={r.img} r={r} onOpen={() => setOpen(r.img)} />)}
              </div>
            </section>
          ))
        ) : (
          sorted.length > 0 && <ProductTable rows={sorted} onOpen={setOpen} />
        )}
      </div>
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

function ProductCard({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const up = unitPrice(r.last?.price, r.size);
  return (
    <button className="product" onClick={onOpen} title="Bearbeiten">
      <div className="pimg">
        <img src={r.url} loading="lazy" alt="" />
        {!r.verified && <span className="flag">ungeprüft</span>}
      </div>
      <div className="pbody">
        <span className="pbrand">{r.brand ?? 'Ohne Marke'}</span>
        <b className="pname">{r.name.de}</b>
        <span className="ptr">{r.name.tr}</span>
        <div className="ptags">
          {r.size ? <span className="tag">{r.size.label}</span> : <span className="tag missing">Menge fehlt</span>}
          {r.variant && (r.variant.de || r.variant.tr) && <span className="tag">{r.variant.de || r.variant.tr}</span>}
        </div>
        {r.last?.price && (
          <div className="pprice">
            <b>{r.last.price} €</b>
            {up && <small> · {up}</small>}
            <small className="muted"> · {r.last.market}</small>
          </div>
        )}
      </div>
    </button>
  );
}

function ProductTable({ rows, onOpen }: { rows: Row[]; onOpen: (img: string) => void }) {
  return (
    <div className="card cat-table-wrap">
      <table className="cat-table">
        <thead>
          <tr>
            <th />
            <th>Marke</th>
            <th>Produkt</th>
            <th>Türkisch</th>
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
            <tr key={r.img} onClick={() => onOpen(r.img)}>
              <td><img src={r.url} loading="lazy" alt="" /></td>
              <td>{r.brand ?? <span className="muted">–</span>}</td>
              <td><b>{r.name.de}</b>{!r.verified && <span className="flag inline">ungeprüft</span>}</td>
              <td className="muted">{r.name.tr}</td>
              <td>{r.variant?.de || r.variant?.tr || <span className="muted">–</span>}</td>
              <td>{r.size?.label ?? (r.unit || <span className="warn">fehlt</span>)}</td>
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
          <button className="ghost" onClick={() => file.current?.click()} disabled={!!busy}>Bild ersetzen</button>
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
