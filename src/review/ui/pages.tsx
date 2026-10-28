import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateRange } from '../../core/format';
import { call, jobClient } from './api';
import { ReviewPage } from './App';

// ---------- Typen der App-API ----------
interface Run { running: boolean; auto?: boolean; progress: { step: string; message: string; fraction: number }; error?: string; notes?: string[] }
interface Job {
  id: string; title: string; createdAt: string; settings: { market: string; topic?: string | null; count?: number; recorded?: string; catalog?: unknown };
  inputs: number; hasStory: boolean; offers: number; videos: string[]; poster: string | null; dates: { from: string; to: string } | null;
  files?: string[]; run?: Run | null;
}
type KeyName = 'ANTHROPIC_API_KEY' | 'GEMINI_API_KEY' | 'BRAVE_API_KEY' | 'REMOVEBG_API_KEY';
type Settings = Record<KeyName, boolean> & { ai: 'claude' | 'gemini' | null };

export const go = (hash: string) => (location.hash = hash);

const TOPICS: [string, string][] = [
  ['', 'Alles gemischt'],
  ['fleisch', 'Fleisch & Wurst'],
  ['snacks', 'Snacks & Süßes'],
  ['vorrat', 'Vorrat (Reis, Nudeln, Konserven)'],
  ['getraenke', 'Getränke'],
  ['frische', 'Obst, Gemüse & Frische'],
  ['milch', 'Milch & Käse'],
  ['haushalt', 'Haushalt & Drogerie'],
];

export function Shell({ children, active }: { children: React.ReactNode; active?: string }) {
  return (
    <div className="app">
      <header>
        <div className="brand" onClick={() => go('#/')} style={{ cursor: 'pointer' }}>
          <span className="dot" /> sincapp Story-Generator
        </div>
        <div className="spacer" />
        <nav>
          <a className={active === 'home' ? 'on' : ''} href="#/">Übersicht</a>
          <a className={active === 'lib' ? 'on' : ''} href="#/bibliothek">Produkt-Katalog</a>
          <a className={active === 'set' ? 'on' : ''} href="#/einstellungen">Einstellungen</a>
        </nav>
      </header>
      <div className="page">{children}</div>
    </div>
  );
}

// ---------- Übersicht ----------
export function Home() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [err, setErr] = useState('');
  const load = () => call<Job[]>('GET', '/api/jobs').then(setJobs, (e) => setErr(e.message));
  useEffect(() => {
    load();
    call<Settings>('GET', '/api/settings').then(setSettings);
  }, []);
  const demo = async () => {
    const j = await call<Job>('POST', '/api/jobs/demo');
    await call('POST', `/api/jobs/${j.id}/process`);
    go(`#/job/${j.id}`);
  };
  return (
    <Shell active="home">
      {settings && !settings.ai && (
        <div className="notice">
          Zum Auslesen eigener Prospekte fehlt noch ein KI-Key (Anthropic oder Google Gemini). <a href="#/einstellungen">Jetzt eintragen</a> – oder erst mal die Demo mit dem Saray-Beispiel ausprobieren.
        </div>
      )}
      <div className="hero">
        <div>
          <h1>Prospekt rein, Story raus.</h1>
          <p className="muted">Prospektseiten hochladen, Angebote prüfen, fertiges Instagram-Video (DE + TR) herunterladen.</p>
        </div>
        <div className="row">
          <button className="ghost" onClick={() => demo().catch((e) => setErr(e.message))}>Demo mit Saray-Beispiel</button>
          <button className="primary big" onClick={() => go('#/neu')}>+ Neues Video</button>
        </div>
      </div>
      {err && <div className="errors">{err}</div>}
      <h2>Bisherige Videos</h2>
      {jobs && !jobs.length && <p className="muted">Noch keine – leg mit „Neues Video“ los.</p>}
      <div className="jobs">
        {jobs?.map((j) => (
          <div key={j.id} className="card job" onClick={() => go(`#/job/${j.id}`)}>
            <div className="poster">{j.poster ? <img src={`${j.poster}?v=${j.createdAt}`} /> : <span>{j.hasStory ? 'noch kein Video' : 'in Arbeit'}</span>}</div>
            <div className="meta">
              <b>{j.title}</b>
              <span className="muted">
                {j.dates ? formatDateRange(j.dates.from, j.dates.to) : new Date(j.createdAt).toLocaleDateString('de-DE')}
                {j.offers ? ` · ${j.offers} Angebote` : ''}
              </span>
              <span className={j.videos.length ? 'ok' : 'muted'}>{j.videos.length ? `✓ Video ${j.videos.map((v) => v.toUpperCase()).join(' + ')}` : j.hasStory ? 'bereit zum Prüfen' : `${j.inputs} Seite(n) hochgeladen`}</span>
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ---------- Neues Video: Markt und Prospekt aus Firestore (oder Upload), Einstellungen ----------
interface FsMarket { id: string; name: string; address: string | null; logoUrl: string | null; current: number }
const fsImg = (u: string) => `/api/firestore/image?url=${encodeURIComponent(u)}`;
interface FsProspect { id: string; title: string; validFrom: string; validUntil: string; pages: number; thumb: string; current: boolean }

export function NewJob() {
  const [fsMarkets, setFsMarkets] = useState<FsMarket[] | null>(null);
  const [fsError, setFsError] = useState('');
  const [q, setQ] = useState('');
  const [marketId, setMarketId] = useState('');
  const [prospects, setProspects] = useState<FsProspect[] | null>(null);
  const [prospectIds, setProspectIds] = useState<string[]>([]);
  const [upload, setUpload] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    call<FsMarket[]>('GET', '/api/firestore/markets').then(setFsMarkets, (e) => {
      setFsError(e.message);
      setUpload(true);
    });
    call<Settings>('GET', '/api/settings').then(setSettings);
  }, []);

  useEffect(() => {
    setProspects(null);
    setProspectIds([]);
    if (!marketId) return;
    call<FsProspect[]>('GET', `/api/firestore/markets/${encodeURIComponent(marketId)}/prospects`).then((list) => {
      setProspects(list);
      // alle aktuellen Prospekte vorauswählen – die besten Angebote aus allen kommen ins Video
      setProspectIds(list.filter((x) => x.current).map((x) => x.id));
      if (!list.length) setUpload(true);
    }, (e) => setErr(e.message));
  }, [marketId]);

  const add = (list: FileList | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => /\.(pdf|png|jpe?g|webp)$/i.test(f.name));
    if (ok.length < list.length) setErr('Nur PDF, JPG, PNG oder WEBP – andere Dateien wurden ignoriert.');
    setFiles((f) => [...f, ...ok].sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })));
  };

  const market = fsMarkets?.find((m) => m.id === marketId);
  const shown = (fsMarkets ?? [])
    .filter((m) => `${m.name} ${m.address ?? ''}`.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr')))
    .sort((a, b) => Number(b.current > 0) - Number(a.current > 0) || a.name.localeCompare(b.name, 'de'));

  const start = async (auto = false) => {
    setErr('');
    try {
      setBusy(upload ? 'Job wird angelegt …' : 'Prospektseiten werden aus Firestore geladen …');
      const job = await call<Job>('POST', '/api/jobs/from-firestore', { marketId, prospectIds: upload ? [] : prospectIds, topic: topic || null, count });
      if (upload) {
        for (const [i, f] of files.entries()) {
          setBusy(`Lade hoch: ${i + 1} von ${files.length} (${f.name})`);
          await call('POST', `/api/jobs/${job.id}/files?name=${encodeURIComponent(f.name)}`, undefined, f);
        }
      }
      setBusy(auto ? '✨ Es wird gezaubert …' : 'Auslesen startet …');
      await call('POST', `/api/jobs/${job.id}/process`, { auto });
      go(`#/job/${job.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy('');
    }
  };

  const noKey = settings && !settings.ai;
  const ready = !!marketId && (upload ? files.length > 0 : prospectIds.length > 0);
  const toggle = (id: string) => setProspectIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const pagesChosen = (prospects ?? []).filter((x) => prospectIds.includes(x.id)).reduce((a, x) => a + x.pages, 0);
  return (
    <Shell>
      <Steps current={0} />
      <div className="wizard">
        <section className="card">
          <div className="row">
            <h3 className="grow">1. Markt</h3>
            {fsMarkets && <input placeholder="Markt suchen …" value={q} onChange={(e) => setQ(e.target.value)} />}
            {fsMarkets && (
              <button className="ghost" title="Märkte und Prospekte neu aus Firestore laden (sonst alle 15 Minuten)" onClick={() => call<FsMarket[]>('GET', '/api/firestore/markets?fresh').then((m) => { setFsMarkets(m); const id = marketId; setMarketId(''); setTimeout(() => setMarketId(id), 0); }, (e) => setErr(e.message))}>
                ↻
              </button>
            )}
          </div>
          {fsError && <div className="errors">Firestore ist gerade nicht erreichbar ({fsError}).</div>}
          {!fsMarkets && !fsError && <p className="muted">Lade Märkte aus Firestore …</p>}
          <div className="markets">
            {shown.map((m) => (
              <button key={m.id} className={`market ${marketId === m.id ? 'on' : ''}`} onClick={() => setMarketId(m.id)}>
                {m.logoUrl ? <img src={fsImg(m.logoUrl)} loading="lazy" /> : <div className="nologo">{m.name.slice(0, 1)}</div>}
                <span>{m.name}</span>
                <small className="muted">{m.address}</small>
                {m.current > 0 && <small className="badge">{m.current} aktuell</small>}
              </button>
            ))}
          </div>
        </section>

        {marketId && (
          <section className="card">
            <div className="row">
              <h3 className="grow">2. Prospekte von {market?.name}</h3>
              <button className="ghost" onClick={() => setUpload(!upload)}>{upload ? 'Prospekt aus Firestore nehmen' : 'Eigene Dateien hochladen'}</button>
            </div>
            {!upload && (
              <>
                {!prospects && <p className="muted">Lade Prospekte …</p>}
                {prospects && !prospects.length && <p className="muted">Für diesen Markt ist kein Prospekt in Firestore.</p>}
                <div className="prospects">
                  {prospects?.map((x) => (
                    <button key={x.id} className={`prospect ${prospectIds.includes(x.id) ? 'on' : ''} ${x.current ? '' : 'old'}`} onClick={() => toggle(x.id)}>
                      <span className="tick">{prospectIds.includes(x.id) ? '✓' : ''}</span>
                      <img src={fsImg(x.thumb)} loading="lazy" />
                      <b>{x.title}</b>
                      <small>{formatDateRange(x.validFrom, x.validUntil)} · {x.pages} Seite{x.pages === 1 ? '' : 'n'}</small>
                      {!x.current && <small className="warn">abgelaufen</small>}
                    </button>
                  ))}
                </div>
                {prospects && prospects.length > 1 && (
                  <p className="muted small">
                    Du kannst mehrere Prospekte wählen – die App nimmt automatisch die besten Angebote aus allen (große Angebote im Prospekt und deine Firestore-Produkte zuerst).
                    {prospectIds.length > 0 && ` Ausgewählt: ${prospectIds.length} Prospekt${prospectIds.length === 1 ? '' : 'e'}, bis zu ${pagesChosen} Seiten; Seiten ohne Produkte und schon gelesene Seiten kosten nichts.`}
                  </p>
                )}
              </>
            )}
            {upload && (
              <>
                <div
                  className="drop"
                  onClick={() => input.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    add(e.dataTransfer.files);
                  }}
                >
                  Prospektseiten hierher ziehen oder klicken
                  <small>PDF, JPG, PNG oder WEBP – auch mehrere auf einmal</small>
                  <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={(e) => add(e.target.files)} />
                </div>
                {files.length > 0 && (
                  <div className="files">
                    {files.map((f, i) => (
                      <div key={f.name + i} className="file">
                        {f.type.startsWith('image/') ? <Thumb file={f} /> : <div className="pdf">PDF</div>}
                        <small>{f.name}</small>
                        <button className="ghost danger" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {marketId && (
          <section className="card">
            <h3>3. Einstellungen</h3>
            <div className="row">
              <label className="grow">
                Thema
                <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                  {TOPICS.map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </select>
              </label>
              <label>
                Angebote im Video: <b>{count}</b>
                <input type="range" min={2} max={12} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              </label>
            </div>
            <p className="muted small">Empfohlen sind 5–8 Angebote (ca. 20–25 Sekunden). Pro Seite im Video stehen 3 oder 2 Angebote. Beim Prüfen kannst du alles noch ändern.</p>
            <p className="muted small"><b>✨ Zaubern</b> erledigt alles in einem Rutsch: Prospekt lesen, beste Angebote wählen, Produktbilder freistellen und das komplette Paket erstellen (Story- und Feed-Video, 7-Tage-Plan mit Reels, Bildern und Texten, „Letzte Chance“-Videos). Es nutzt dein gespeichertes Design für den Markt. Danach kannst du trotzdem noch alles ändern und neu exportieren.</p>
          </section>
        )}

        {noKey && (
          <div className="notice">
            Zum Auslesen fehlt ein KI-Key (Anthropic oder Google Gemini). <a href="#/einstellungen">Unter Einstellungen eintragen</a>.
          </div>
        )}
        {err && <div className="errors">{err}</div>}
        <div className="row end">
          <button className="ghost" onClick={() => go('#/')}>Abbrechen</button>
          <button className="ghost big" disabled={!ready || !!busy || !!noKey} onClick={() => start(false)} title="Erst die Angebote prüfen, dann Design und Export wählen">
            Angebote erst prüfen →
          </button>
          <button className="primary big magic" disabled={!ready || !!busy || !!noKey} onClick={() => start(true)} title="Liest den Prospekt, wählt die besten Angebote und erstellt das komplette Wochenpaket – ohne Zwischenschritte">
            {busy || '✨ Zaubern: alles automatisch'}
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Thumb({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} />;
}

export function Steps({ current }: { current: number }) {
  const steps = ['Prospekt & Einstellungen', 'Auslesen', 'Prüfen', 'Video'];
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <div key={s} className={i < current ? 'done' : i === current ? 'on' : ''}>
          <span>{i < current ? '✓' : i + 1}</span> {s}
        </div>
      ))}
    </div>
  );
}

// ---------- Job: Auslesen (Fortschritt) → Prüfen ----------
export function JobPage({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState('');
  const api = useMemo(() => jobClient(`/api/jobs/${id}`), [id]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const j = await call<Job>('GET', `/api/jobs/${id}`);
        if (stop) return;
        setJob(j);
        if (j.run?.running) setTimeout(tick, 800);
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    tick();
    return () => {
      stop = true;
    };
  }, [id]);

  const retry = async () => {
    setErr('');
    try {
      await call('POST', `/api/jobs/${id}/process`);
      setJob(await call<Job>('GET', `/api/jobs/${id}`));
      location.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm('Diesen Job mit allen Dateien löschen?')) return;
    await call('DELETE', `/api/jobs/${id}`);
    go('#/');
  };

  if (err && !job) return <Shell><div className="errors">{err}</div></Shell>;
  if (!job) return <Shell><p>Lade …</p></Shell>;

  const run = job.run;
  if (run?.running || (!job.hasStory && !run?.error)) {
    const f = run?.progress.fraction ?? 0;
    return (
      <Shell>
        <Steps current={1} />
        <div className="card working">
          <h3>{job.title}</h3>
          {run?.running ? (
            <>
              <div className="progressbar big"><div style={{ width: `${(f * 100).toFixed(1)}%` }} /></div>
              <p>{run.progress.message}</p>
              <p className="muted small">
                {job.settings.catalog
                  ? 'Kampagne aus dem Katalog: Bilder und Preise stehen schon fest, es läuft keine KI. Videos, Reels, Bilder und Texte entstehen in etwa 5 Minuten.'
                  : run.auto
                  ? '✨ Zauberknopf: Die KI liest die Seiten und prüft jeden Preis doppelt, dann entstehen Videos, Reels, Bilder und Texte. Das dauert etwa 10–20 Minuten – hol dir einen Kaffee, das Fenster kann offen bleiben.'
                  : 'Die KI liest die Seiten, prüft jeden Preis doppelt und sucht für jedes Produkt ein sauberes Bild. Das dauert je nach Umfang ein paar Minuten – du kannst das Fenster offen lassen.'}
              </p>
            </>
          ) : (
            <>
              <p>Für diesen Job wurde das Auslesen noch nicht gestartet ({job.inputs} Seite(n) hochgeladen).</p>
              <button className="primary" onClick={retry} disabled={!job.inputs}>Jetzt auslesen</button>
            </>
          )}
          {err && <div className="errors">{err}</div>}
        </div>
      </Shell>
    );
  }
  if (run?.error && !job.hasStory) {
    return (
      <Shell>
        <Steps current={1} />
        <div className="card working">
          <h3>{job.title}</h3>
          <div className="errors">Das hat nicht geklappt: {run.error}</div>
          <p className="muted">Details stehen im Bericht (<a href={`/jobs/${id}/report.md`} target="_blank">report.md</a>).</p>
          <div className="row">
            <button className="ghost danger" onClick={remove}>Job löschen</button>
            <button className="primary" onClick={retry}>Noch mal versuchen</button>
          </div>
        </div>
      </Shell>
    );
  }
  return (
    <>
      {run?.notes && run.notes.length > 0 && <Notes notes={run.notes} />}
      <ReviewPage api={api} title={job.title} onBack={() => go('#/')} initialTab={run?.auto && !run.error ? 'export' : 'angebote'} />
    </>
  );
}

function Notes({ notes }: { notes: string[] }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="notes">
      <b>Hinweise vom Auslesen</b>
      <ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
      <button className="ghost" onClick={() => setOpen(false)}>Ausblenden</button>
    </div>
  );
}

// ---------- Einstellungen ----------
export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const empty: Record<KeyName, string> = { ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', BRAVE_API_KEY: '', REMOVEBG_API_KEY: '' };
  const [vals, setVals] = useState(empty);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    call<Settings>('GET', '/api/settings').then(setS);
  }, []);
  const save = async () => {
    const body = Object.fromEntries(Object.entries(vals).filter(([, v]) => v.trim()));
    setS(await call<Settings>('PUT', '/api/settings', body));
    setVals(empty);
    setMsg('Gespeichert. Die Keys liegen nur auf diesem Rechner (Datei .env).');
  };
  const rows: [KeyName, string, string][] = [
    ['GEMINI_API_KEY', 'Google Gemini (empfohlen, am günstigsten)', 'Liest die Prospekte mit dem Flash-Modell und vergleicht Internet-Bilder mit dem Prospekt. Key unter aistudio.google.com anlegen.'],
    ['ANTHROPIC_API_KEY', 'Anthropic Claude', 'Alternative zu Gemini – es reicht einer der beiden. Key unter console.anthropic.com anlegen.'],
    ['BRAVE_API_KEY', 'Brave Search (optional)', 'Bildersuche im Internet für saubere Produktfotos. Jede Suche wird 30 Tage gemerkt, gleiche Produkte kosten nichts mehr. Key unter api-dashboard.search.brave.com anlegen.'],
    ['REMOVEBG_API_KEY', 'remove.bg (optional)', 'Nur als Ausweichlösung, wenn das lokale Freistellen nicht sauber klappt.'],
  ];
  return (
    <Shell active="set">
      <h1>Einstellungen</h1>
      {s && <p className="muted">KI zum Auslesen: <b>{s.ai === 'claude' ? 'Anthropic Claude' : s.ai === 'gemini' ? 'Google Gemini' : 'noch keine – einen der beiden Keys eintragen'}</b>{s.ANTHROPIC_API_KEY && s.GEMINI_API_KEY ? ' (beide Keys da – Gemini wird genommen, weil es günstiger ist)' : ''}</p>}
      <div className="card settings">
        {rows.map(([k, label, help]) => (
          <div key={k} className="setting">
            <div>
              <b>{label}</b> {s && (s[k] ? <span className="ok">✓ eingetragen</span> : <span className="warn">fehlt</span>)}
              <p className="muted small">{help}</p>
            </div>
            <input type="password" placeholder={s?.[k] ? 'neuen Key eintragen, um ihn zu ersetzen' : 'Key einfügen'} value={vals[k]} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />
          </div>
        ))}
        <div className="row end">
          {msg && <span className="ok">{msg}</span>}
          <button className="primary" onClick={save} disabled={!Object.values(vals).some((v) => v.trim())}>Speichern</button>
        </div>
      </div>
      <Usage />
    </Shell>
  );
}

interface UsageSum { month: string; calls: number; cachedCalls: number; input: number; output: number; thinking: number; byModel: Record<string, { calls: number; input: number; output: number; thinking: number }>; byTask: Record<string, number>; models: { read: string; check: string } | null }
const TASK_LABEL: Record<string, string> = { seite: 'Seiten gelesen', preise: 'Preise gegengecheckt', bilder: 'Fotos verglichen' };
const fmt = (n: number) => n.toLocaleString('de-DE');

/** KI-Verbrauch dieses Monats – damit man sieht, was das Tool kostet. */
function Usage() {
  const [u, setU] = useState<UsageSum | null>(null);
  useEffect(() => {
    call<UsageSum>('GET', '/api/usage').then(setU, () => {});
  }, []);
  if (!u) return null;
  const [y, m] = u.month.split('-');
  return (
    <>
      <h2>KI-Verbrauch im {new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</h2>
      <div className="card settings">
        {u.models && <p className="muted small">Modelle: <b>{u.models.read}</b> liest die Seiten, <b>{u.models.check}</b> prüft Preise und Fotos (das günstigste).</p>}
        <p>
          <b>{fmt(u.calls)}</b> bezahlte KI-Aufrufe ({Object.entries(u.byTask).map(([k, n]) => `${fmt(n)} ${TASK_LABEL[k] ?? k}`).join(', ') || 'noch keine'}) ·{' '}
          <b>{fmt(u.cachedCalls)}</b> aus dem Speicher (gratis)
        </p>
        <p className="muted small">Tokens: {fmt(u.input)} Eingabe · {fmt(u.output + u.thinking)} Ausgabe{u.thinking ? ` (davon ${fmt(u.thinking)} Nachdenken)` : ''}. Den genauen Betrag in Euro zeigt die Abrechnung bei Google bzw. Anthropic.</p>
        {Object.keys(u.byModel).length > 1 && (
          <ul className="small muted">{Object.entries(u.byModel).map(([k, v]) => <li key={k}>{k}: {fmt(v.calls)} Aufrufe, {fmt(v.input)} / {fmt(v.output + v.thinking)} Tokens</li>)}</ul>
        )}
        <p className="muted small">So bleibt es günstig: Jede Seite wird nur einmal bezahlt, Seiten ohne Produkte werden übersprungen, der Export (Videos, Bilder, Texte) kostet keine KI.</p>
      </div>
    </>
  );
}

