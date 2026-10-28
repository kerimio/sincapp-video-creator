// Schritt 4 „Teilen“: fertige Videos und Bilder auf Instagram teilen oder einplanen, Märkte markieren, Texte übernehmen.
import { useEffect, useMemo, useState } from 'react';
import type { Lang, Story } from '../../core/schema';
import { caption } from '../../core/captions';
import type { ExportFile } from '../../render/export';
import { choices, fileOffer, KIND_LABEL, marketHandles, weekDrafts, type PostKind } from '../../instagram/drafts';
import { offerCaption } from '../../core/magic';
import type { IgPost } from '../../instagram/post';
import { call, type RenderState } from './api';

interface IgStatus {
  configured: boolean;
  username: string | null;
  problem: string | null;
  quota: { used: number; total: number } | null;
}

const STATUS_LABEL: Record<IgPost['status'], string> = { geplant: 'Geplant', läuft: 'Wird geteilt …', veröffentlicht: 'Geteilt', fehler: 'Fehler', verpasst: 'Verpasst' };

/** "2026-10-31T18:00" in Ortszeit für ein datetime-local-Feld */
const localNow = (plusMin = 0) => {
  const d = new Date(Date.now() + plusMin * 60_000 - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const when = (iso: string) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function SharePanel(p: { jobId: string; story: Story; render: RenderState | null; toExport: () => void; say: (t: string, error?: boolean) => void }) {
  const [ig, setIg] = useState<IgStatus | null>(null);
  const [posts, setPosts] = useState<IgPost[]>([]);
  const base = `/api/jobs/${p.jobId}/instagram`;
  const load = () => call<IgPost[]>('GET', base).then(setPosts, () => {});
  useEffect(() => {
    call<IgStatus>('GET', '/api/instagram').then(setIg, (e) => setIg({ configured: false, username: null, problem: e.message, quota: null }));
    load();
  }, [p.jobId]);
  // Solange etwas läuft oder gleich fällig ist: Liste aktuell halten
  const active = posts.some((x) => x.status === 'läuft' || (x.status === 'geplant' && Date.parse(x.at) < Date.now() + 60_000));
  useEffect(() => {
    if (!active) return;
    const h = setInterval(load, 3000);
    return () => clearInterval(h);
  }, [active, p.jobId]);

  const r = p.render?.result;
  if (!ig) return <p className="muted">Lädt …</p>;
  if (!ig.configured)
    return (
      <div className="card share-setup">
        <h2>Instagram verbinden</h2>
        <p>Damit die App direkt auf Instagram teilen und Beiträge einplanen kann, braucht sie einmalig einen Zugang zu deinem Business-Konto.</p>
        <p>
          <a className="button primary" href="#/einstellungen">Zu den Einstellungen</a>
        </p>
      </div>
    );
  if (!r)
    return (
      <div className="card">
        <p>Zum Teilen braucht es zuerst die fertigen Videos und Bilder.</p>
        <button className="primary" onClick={p.toExport}>Zum Export</button>
      </div>
    );
  return (
    <div className="share">
      <p className="muted">
        {ig.username ? <>Geteilt wird als <b>@{ig.username}</b>.</> : <span className="warn">⚠ {ig.problem ?? 'Instagram antwortet nicht'}</span>}
        {ig.quota && <> Heute {ig.quota.used} von {ig.quota.total} möglichen Beiträgen genutzt.</>}
      </p>
      <Composer story={p.story} files={r.files} urlBase={r.urlBase} base={base} say={p.say} onDone={load} />
      <WeekPlan story={p.story} files={r.files} urlBase={r.urlBase} base={base} say={p.say} onDone={load} />
      <PostList posts={posts} urlBase={r.urlBase} base={base} say={p.say} reload={load} />
    </div>
  );
}

function Composer(p: { story: Story; files: ExportFile[]; urlBase: string; base: string; say: (t: string, e?: boolean) => void; onDone: () => void }) {
  const [kind, setKind] = useState<PostKind>('story');
  const [lang, setLang] = useState<Lang>(p.story.lang[0] ?? 'de');
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => choices(p.files, kind, lang), [p.files, kind, lang]);
  const multi = kind === 'beitrag';
  const offer = picked.length === 1 ? fileOffer(picked[0]) : undefined;
  const markets = marketHandles(p.story, offer);

  // Art oder Sprache gewechselt: Auswahl leeren, Markierung auf die Märkte setzen
  useEffect(() => {
    setPicked([]);
    setTags(marketHandles(p.story).map((m) => m.handle));
  }, [kind, lang]);
  // Ein einzelnes Angebot gewählt (Reel, Einzelbild): nur dessen Markt markieren
  useEffect(() => {
    if (offer != null) setTags(marketHandles(p.story, offer).map((m) => m.handle));
  }, [offer]);
  // Text vorschlagen: Tagesdatei aus dem Plan, Text zum Angebot, sonst der Wochentext – solange nicht selbst geändert
  useEffect(() => {
    if (edited) return;
    const day = picked.length === 1 && /\/plan\//.test(picked[0]) ? picked[0].slice(0, picked[0].lastIndexOf('/')) : null;
    if (day) fetch(`${p.urlBase}${day}/text-${lang}.txt`).then((r) => (r.ok ? r.text() : caption(p.story, lang))).then((t) => setText(t.trim()), () => {});
    else setText(offer != null && p.story.offers[offer] ? offerCaption(p.story, offer, lang) : caption(p.story, lang));
  }, [picked.join('|'), lang, edited]);

  const toggle = (f: string) => setPicked((s) => (s.includes(f) ? s.filter((x) => x !== f) : multi ? [...s, f].slice(0, 10) : [f]));
  const addExtra = () => {
    const h = extra.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) return p.say('Instagram-Name: nur Buchstaben, Zahlen, Punkt und Unterstrich', true);
    setTags((t) => [...new Set([...t, h])]);
    setExtra('');
  };
  const send = async (later: boolean) => {
    if (later && !at) return p.say('Bitte Datum und Uhrzeit wählen', true);
    setBusy(true);
    try {
      // mehrere Storys = mehrere Einträge (jede Story einzeln, nacheinander)
      const groups = kind === 'story' ? picked.map((f) => [f]) : [picked];
      for (const files of groups) {
        const label = `${KIND_LABEL[kind]}: ${files.map((f) => p.files.find((x) => x.path === f)?.label ?? f).join(', ')}`;
        await call('POST', p.base, { kind, files, caption: kind === 'story' ? '' : text, tags, at: later ? new Date(at).toISOString() : undefined, label });
      }
      p.say(later ? `Eingeplant für ${when(new Date(at).toISOString())}` : 'Wird jetzt geteilt …');
      setPicked([]);
      setEdited(false);
      p.onDone();
    } catch (e) {
      p.say((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card composer">
      <h2>Teilen</h2>
      <div className="row wrap">
        <div className="seg">
          {(['story', 'reel', 'beitrag'] as const).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        {p.story.lang.length > 1 && (
          <div className="seg">
            {p.story.lang.map((l) => (
              <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
        )}
      </div>
      <p className="muted small">
        {kind === 'story' ? 'Eine Story pro Datei; mehrere auswählen = mehrere Storys nacheinander. Storys haben keinen Text.' : kind === 'reel' ? 'Ein Video, erscheint auch im Feed.' : 'Ein Bild oder Video, oder bis zu 10 als Karussell (in Klick-Reihenfolge).'}
      </p>
      {!list.length && <p className="muted">Dafür gibt es im Export noch keine passenden Dateien.</p>}
      <div className="share-files">
        {list.map((f) => {
          const n = picked.indexOf(f.path);
          return (
            <button key={f.path} className={`share-file ${n >= 0 ? 'on' : ''}`} onClick={() => toggle(f.path)} title={f.label}>
              {f.kind === 'image' ? <img src={p.urlBase + f.path} loading="lazy" /> : <video src={`${p.urlBase}${f.path}#t=1.5`} muted preload="metadata" />}
              <span>{f.day ? `${f.day} · ` : ''}{f.label}</span>
              {n >= 0 && <i>{multi ? n + 1 : '✓'}</i>}
            </button>
          );
        })}
      </div>
      {kind !== 'story' && (
        <label className="grow">
          Text
          <textarea rows={8} value={text} onChange={(e) => (setText(e.target.value), setEdited(true))} />
          <span className="muted small">{text.length} / 2200 Zeichen{edited && <> · <button className="link" onClick={() => setEdited(false)}>Vorschlag wiederherstellen</button></>}</span>
        </label>
      )}
      <div className="field">
        <span>Markieren</span>
        <div className="row wrap">
          {[...new Set([...markets.map((m) => m.handle), ...tags])].map((h) => (
            <label key={h} className="check">
              <input type="checkbox" checked={tags.includes(h)} onChange={(e) => setTags((t) => (e.target.checked ? [...t, h] : t.filter((x) => x !== h)))} />@{h}
              {markets.find((m) => m.handle === h) && <span className="muted small"> {markets.find((m) => m.handle === h)!.name}</span>}
            </label>
          ))}
          <input placeholder="@weiteres_konto" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addExtra()} />
          <button className="ghost" onClick={addExtra} disabled={!extra.trim()}>+ Markieren</button>
        </div>
        {!markets.length && <span className="muted small">Für diese Märkte ist in sincapp kein Instagram-Name hinterlegt – oben von Hand eintragen.</span>}
      </div>
      <div className="row wrap share-actions">
        <button className="primary" disabled={busy || !picked.length} onClick={() => send(false)}>Jetzt teilen</button>
        <span className="muted">oder</span>
        <input type="datetime-local" value={at} min={localNow()} onChange={(e) => setAt(e.target.value)} />
        <button disabled={busy || !picked.length || !at} onClick={() => send(true)}>Einplanen</button>
      </div>
    </div>
  );
}

/** Der ganze 7-Tage-Plan auf einen Klick: jeden Tag zur gleichen Uhrzeit Reel und/oder Story. */
function WeekPlan(p: { story: Story; files: ExportFile[]; urlBase: string; base: string; say: (t: string, e?: boolean) => void; onDone: () => void }) {
  const [lang, setLang] = useState<Lang>(p.story.lang[0] ?? 'de');
  const [time, setTime] = useState('18:00');
  const [reel, setReel] = useState(true);
  const [asStory, setAsStory] = useState(true);
  const [busy, setBusy] = useState(false);
  const drafts = useMemo(() => weekDrafts(p.files, p.story, { lang, time, reel, story: asStory, nowLocal: localNow(5) }), [p.files, p.story, lang, time, reel, asStory]);
  if (!p.files.some((f) => f.day)) return null;
  const plan = async () => {
    setBusy(true);
    try {
      for (const d of drafts) {
        const text = d.text ? await fetch(p.urlBase + d.text).then((r) => (r.ok ? r.text() : '')) : '';
        const tags = marketHandles(p.story, d.offer).map((m) => m.handle);
        await call('POST', p.base, { kind: d.kind, files: [d.file], caption: text.trim(), tags, at: new Date(d.local).toISOString(), label: d.label });
      }
      p.say(`${drafts.length} Beiträge eingeplant`);
      p.onDone();
    } catch (e) {
      p.say((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>📅 7-Tage-Plan einplanen</h2>
      <div className="row wrap">
        {p.story.lang.length > 1 && (
          <div className="seg">
            {p.story.lang.map((l) => (
              <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
        )}
        <label className="check"><input type="checkbox" checked={reel} onChange={(e) => setReel(e.target.checked)} /> als Reel</label>
        <label className="check"><input type="checkbox" checked={asStory} onChange={(e) => setAsStory(e.target.checked)} /> als Story</label>
        <label className="inline">täglich um <input type="time" value={time} onChange={(e) => setTime(e.target.value || '18:00')} /></label>
      </div>
      <p className="muted small">
        {drafts.length ? `${drafts.length} Termine: ${[...new Set(drafts.map((d) => d.label.split(':')[0]))].join(', ')}. Texte und Markierungen kommen aus dem Plan.` : 'Keine Termine mehr in der Zukunft.'}
      </p>
      <button className="primary" disabled={busy || !drafts.length} onClick={plan}>{busy ? 'Wird eingeplant …' : `${drafts.length} Beiträge einplanen`}</button>
    </div>
  );
}

function PostList(p: { posts: IgPost[]; urlBase: string; base: string; say: (t: string, e?: boolean) => void; reload: () => void }) {
  if (!p.posts.length) return null;
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      p.reload();
    } catch (e) {
      p.say((e as Error).message, true);
    }
  };
  const sorted = [...p.posts].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="card">
      <h2>Geplant und geteilt</h2>
      <p className="muted small">Instagram selbst kann über die Schnittstelle nicht planen – die App teilt zum Termin. Dafür muss sie laufen (Rechner an).</p>
      <div className="posts">
        {sorted.map((x) => (
          <div key={x.id} className={`post ${x.status}`}>
            <div className="post-media">{/\.mp4$/.test(x.files[0]) ? <video src={`${p.urlBase}${x.files[0]}#t=1.5`} muted preload="metadata" /> : <img src={p.urlBase + x.files[0]} loading="lazy" />}</div>
            <div className="grow">
              <b>{x.label ?? KIND_LABEL[x.kind]}</b>
              <div className="small">
                <span className={`chip ${x.status}`}>{STATUS_LABEL[x.status]}</span> {when(x.status === 'veröffentlicht' && x.publishedAt ? x.publishedAt : x.at)}
                {x.tags.length > 0 && <span className="muted"> · {x.tags.map((t) => `@${t}`).join(' ')}</span>}
              </div>
              {x.message && <div className={`small ${x.status === 'fehler' || x.status === 'verpasst' ? 'warn' : 'muted'}`}>{x.message}</div>}
              {x.permalink && <a className="small" href={x.permalink} target="_blank" rel="noreferrer">Auf Instagram ansehen ↗</a>}
            </div>
            <div className="post-actions">
              {x.status === 'geplant' && Date.parse(x.at) > Date.now() && <button className="ghost" onClick={() => act(() => call('POST', `${p.base}/${x.id}/retry`, {}))}>Jetzt</button>}
              {(x.status === 'fehler' || x.status === 'verpasst') && <button onClick={() => act(() => call('POST', `${p.base}/${x.id}/retry`, {}))}>Erneut senden</button>}
              {x.status !== 'läuft' && (
                <button className="ghost danger" onClick={() => (x.status !== 'veröffentlicht' || confirm('Nur aus der Liste entfernen? Auf Instagram bleibt der Beitrag.')) && act(() => call('DELETE', `${p.base}/${x.id}`))}>
                  {x.status === 'veröffentlicht' ? 'Ausblenden' : 'Löschen'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
