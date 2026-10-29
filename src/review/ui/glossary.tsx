// Glossar-Seite: feste Produktnamen DE/TR pflegen, die beim Auslesen jedes Prospekts eingesetzt werden.
import { useEffect, useState } from 'react';
import type { GlossaryEntry } from '../../core/glossary';
import { call } from './api';
import { Shell } from './pages';

type Row = { de: string; tr: string; match: string };
const toRow = (e: GlossaryEntry): Row => ({ de: e.de, tr: e.tr, match: e.match.join(', ') });

export function GlossaryPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [base, setBase] = useState<GlossaryEntry[]>([]);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    call<{ own: GlossaryEntry[]; base: GlossaryEntry[] }>('GET', '/api/glossar').then((g) => {
      setRows(g.own.map(toRow));
      setBase(g.base);
    }, (e) => setMsg({ text: e.message, error: true }));
  }, []);
  const edit = (i: number, k: keyof Row, v: string) => {
    setRows((r) => r!.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
    setDirty(true);
  };
  const save = async () => {
    try {
      const g = await call<{ own: GlossaryEntry[] }>('PUT', '/api/glossar', rows!.filter((r) => r.de.trim() || r.tr.trim()).map((r) => ({ de: r.de, tr: r.tr, match: r.match })));
      setRows(g.own.map(toRow));
      setDirty(false);
      setMsg({ text: 'Gespeichert. Gilt ab dem nächsten gelesenen Prospekt.' });
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    }
  };
  const own = new Set((rows ?? []).map((r) => r.de.trim().toLocaleLowerCase('de')));
  return (
    <Shell active="glossar">
      <h1>Glossar</h1>
      <p className="muted">Feste Namen für Produkte, egal wie der Prospekt sie schreibt. Steht „Rinderhackfleisch-Mischung (Gemischtes Hackfleisch)“ im Prospekt, heißt es im Video trotzdem „Gemischtes Hack“ / „Karışık Kıyma“. Unter „erkennt auch“ stehen weitere Schreibweisen (Deutsch oder Türkisch, mit Komma getrennt).</p>
      {!rows ? (
        <p className="muted">{msg?.text ?? 'Lädt …'}</p>
      ) : (
        <div className="card glossary">
          <div className="gl-row gl-head"><span>Deutsch</span><span>Türkisch</span><span>erkennt auch</span><span /></div>
          {rows.map((r, i) => (
            <div key={i} className="gl-row">
              <input value={r.de} placeholder="Gemischtes Hack" onChange={(e) => edit(i, 'de', e.target.value)} />
              <input value={r.tr} placeholder="Karışık Kıyma" onChange={(e) => edit(i, 'tr', e.target.value)} />
              <input value={r.match} placeholder="Hackfleisch gemischt, Rinderhackfleisch-Mischung" onChange={(e) => edit(i, 'match', e.target.value)} />
              <button className="ghost danger" onClick={() => (setRows(rows.filter((_, j) => j !== i)), setDirty(true))}>Entfernen</button>
            </div>
          ))}
          <div className="row end">
            {msg && <span className={msg.error ? 'warn' : 'ok'}>{msg.text}</span>}
            <button className="ghost" onClick={() => setRows([...rows, { de: '', tr: '', match: '' }])}>+ Eintrag</button>
            <button className="primary" disabled={!dirty} onClick={save}>Speichern</button>
          </div>
        </div>
      )}
      <h2>Grundbestand</h2>
      <p className="muted small">Ist schon eingebaut. Zum Ändern „Bearbeiten“ – dann gilt dein Eintrag.</p>
      <div className="card glossary">
        {base.map((e) => (
          <div key={e.de} className="gl-row">
            <b>{e.de}</b>
            <span>{e.tr}</span>
            <span className="muted small">{e.match.join(', ')}</span>
            {own.has(e.de.toLocaleLowerCase('de')) ? <span className="muted small">überschrieben</span> : <button className="ghost" onClick={() => (setRows([...(rows ?? []), toRow(e)]), setDirty(true))}>Bearbeiten</button>}
          </div>
        ))}
      </div>
    </Shell>
  );
}
