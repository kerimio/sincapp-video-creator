import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAppServer } from '../src/app/server';
import { safeName } from '../src/app/jobs';

let server: Awaited<ReturnType<typeof startAppServer>>;
let jobs = '';
const saved: Record<string, string | undefined> = {};
const ENV = ['SINCAPP_JOBS', 'SINCAPP_LIBRARY', 'SINCAPP_ENV_FILE', 'SINCAPP_NO_OPENFOODFACTS', 'ANTHROPIC_API_KEY', 'BRAVE_API_KEY'];

beforeAll(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  jobs = mkdtempSync(join(tmpdir(), 'jobs-'));
  process.env.SINCAPP_JOBS = jobs;
  process.env.SINCAPP_LIBRARY = mkdtempSync(join(tmpdir(), 'lib-'));
  process.env.SINCAPP_ENV_FILE = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
  process.env.SINCAPP_NO_OPENFOODFACTS = '1';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.BRAVE_API_KEY;
  server = await startAppServer(0, () => {});
});
afterAll(async () => {
  await server.close();
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

const api = async (method: string, path: string, body?: unknown, raw?: Buffer) => {
  const r = await fetch(`${server.url}${path}`, { method, body: raw ? new Uint8Array(raw) : body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
};

describe('App-Server', () => {
  it('leitet / auf die App um und liefert die Märkte', async () => {
    const r = await fetch(`${server.url}/`, { redirect: 'manual' });
    expect(r.headers.get('location')).toBe('/app/');
    const { data } = await api('GET', '/api/markets');
    expect(data.map((m: { slug: string }) => m.slug)).toContain('saray');
  });

  it('speichert Keys in der .env, ohne sie zurückzugeben', async () => {
    expect((await api('GET', '/api/settings')).data.BRAVE_API_KEY).toBe(false);
    const { data } = await api('PUT', '/api/settings', { BRAVE_API_KEY: ' test-key\n', EVIL: 'x' });
    expect(data).toEqual({ ANTHROPIC_API_KEY: false, BRAVE_API_KEY: true, REMOVEBG_API_KEY: false });
    const env = readFileSync(process.env.SINCAPP_ENV_FILE!, 'utf8');
    expect(env).toBe('BRAVE_API_KEY=test-key\n');
    await api('PUT', '/api/settings', { BRAVE_API_KEY: '' });
    expect(process.env.BRAVE_API_KEY).toBeUndefined();
  });

  it('legt Jobs an, nimmt nur Prospektdateien an und verlangt den Key zum Auslesen', async () => {
    const { status, data: job } = await api('POST', '/api/jobs', { market: 'saray', topic: 'fleisch', title: 'Test' });
    expect(status).toBe(201);
    expect(job.id).toMatch(/^\d{4}-\d\d-\d\d-saray-fleisch$/);
    expect((await api('POST', '/api/jobs', { market: 'saray', topic: 'fleisch' })).data.id).toBe(`${job.id}-2`);

    expect((await api('POST', `/api/jobs/${job.id}/files?name=${encodeURIComponent('../Seite 1.PNG')}`, undefined, Buffer.from('x'))).data.name).toBe('Seite-1.png');
    expect((await api('POST', `/api/jobs/${job.id}/files?name=boese.sh`, undefined, Buffer.from('x'))).status).toBe(500);
    expect(existsSync(join(jobs, job.id, 'input/Seite-1.png'))).toBe(true);

    const p = await api('POST', `/api/jobs/${job.id}/process`);
    expect(p.data.error).toMatch(/Anthropic-API-Key/);
    expect((await api('GET', '/api/jobs/..%2F..%2Fetc')).status).toBe(404);
  });

  it('Demo: Saray-Prospekt bis zur fertigen story.json', async () => {
    const { data: job } = await api('POST', '/api/jobs/demo');
    expect((await api('POST', `/api/jobs/${job.id}/process`)).status).toBe(202);
    let run;
    for (let i = 0; i < 1200; i++) {
      run = (await api('GET', `/api/jobs/${job.id}/progress`)).data;
      if (!run.running) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(run.error).toBeUndefined();
    const { data } = await api('GET', `/api/jobs/${job.id}`);
    expect(data.hasStory).toBe(true);
    expect(data.offers).toBeGreaterThanOrEqual(5);
    expect(data.dates).toEqual({ from: '2026-10-28', to: '2026-11-07' });

    // Review-API des Jobs, Story-Datei über /jobs/
    const state = (await api('GET', `/api/jobs/${job.id}/state`)).data;
    expect(state.urlBase).toBe(`/jobs/${job.id}/`);
    expect(state.story.offers).toHaveLength(data.offers);
    const img = await fetch(`${server.url}/jobs/${job.id}/${state.story.offers[0].img}`);
    expect(img.headers.get('content-type')).toBe('image/png');

    // Ohne Internetsuche nur Prospekt-Freisteller – die kommen bewusst nicht in die Bibliothek
    expect((await api('GET', '/api/library')).data).toEqual([]);

    const list = (await api('GET', '/api/jobs')).data;
    expect(list.map((j: { id: string }) => j.id)).toContain(job.id);
    await api('DELETE', `/api/jobs/${job.id}`);
    expect(existsSync(join(jobs, job.id))).toBe(false);
  }, 600_000);
});

describe('safeName', () => {
  it('macht Uploadnamen ungefährlich', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('Prospekt KW 44 – Seite 2.JPG')).toBe('Prospekt-KW-44-Seite-2.jpg');
  });
});
