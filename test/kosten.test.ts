import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logUsage, usageSummary } from '../src/ai/usage';
import { listProspects } from '../src/firestore/firestore';
import { BraveImages } from '../src/images/search';

describe('Kosten im Blick', () => {
  it('KI-Verbrauch wird pro Monat zusammengezählt, Speicher-Treffer extra', async () => {
    process.env.SINCAPP_AI_CACHE = mkdtempSync(join(tmpdir(), 'ki-'));
    try {
      await logUsage({ model: 'gemini-3.8-flash', task: 'seite', input: 1200, output: 800, thinking: 300 });
      await logUsage({ model: 'gemini-3.8-flash', task: 'preise', input: 400, output: 50 });
      await logUsage({ model: 'gemini-3.8-flash', task: 'speicher', input: 0, output: 0, cached: true });
      const s = await usageSummary();
      expect(s).toMatchObject({ calls: 2, cachedCalls: 1, input: 1600, output: 850, thinking: 300, byTask: { seite: 1, preise: 1 } });
      expect((await usageSummary('2001-01')).calls).toBe(0);
    } finally {
      delete process.env.SINCAPP_AI_CACHE;
    }
  });

  it('Firestore: mit Datum nur aktuelle Prospekte abfragen, bei Fehler ganze Liste', async () => {
    const calls: string[] = [];
    const doc = (id: string, until: string) => ({ name: `x/prospects/${id}`, fields: { marketIds: { arrayValue: { values: [{ stringValue: 'm' }] } }, validUntil: { stringValue: until }, imageUrls: { arrayValue: { values: [{ stringValue: 'u' }] } } } });
    const ok: typeof fetch = async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url).split('/documents')[1]}`);
      if (String(url).endsWith(':runQuery')) {
        expect(JSON.parse(String(init?.body)).structuredQuery.where.fieldFilter).toMatchObject({ op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: '2026-10-07' } });
        return new Response(JSON.stringify([{ document: doc('neu', '2026-11-07') }, { readTime: 'x' }]));
      }
      return new Response(JSON.stringify({ documents: [doc('neu', '2026-11-07'), doc('alt', '2025-01-01')] }));
    };
    expect((await listProspects(ok, '2026-10-07')).map((p) => p.id)).toEqual(['neu']);
    expect(calls).toEqual(['POST :runQuery']);
    const broken: typeof fetch = async (url, init) => (String(url).endsWith(':runQuery') ? new Response('nein', { status: 400 }) : ok(url, init));
    expect((await listProspects(broken, '2026-10-07')).map((p) => p.id)).toEqual(['neu', 'alt']);
  });

  it('Bildersuche wird gemerkt – dieselbe Suche kostet nur einmal', async () => {
    process.env.SINCAPP_AI_CACHE = join(mkdtempSync(join(tmpdir(), 'ki-')), 'ki');
    let n = 0;
    const f: typeof fetch = async () => {
      n++;
      return new Response(JSON.stringify({ results: [{ title: 'Tahin', url: 'https://s', properties: { url: 'https://img/1.jpg' } }] }));
    };
    try {
      const b = new BraveImages('KEY', f);
      expect((await b.search('Durra Tahin')).length).toBe(1);
      expect((await b.search('Durra Tahin'))[0].url).toBe('https://img/1.jpg');
      expect(n).toBe(1);
    } finally {
      delete process.env.SINCAPP_AI_CACHE;
    }
  });
});
