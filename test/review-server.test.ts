import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startReviewServer } from '../src/review/server';

let server: Awaited<ReturnType<typeof startReviewServer>>;
let dir = '';
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'review-'));
  cpSync(join(__dirname, 'fixtures/reference-job'), dir, { recursive: true });
  process.env.SINCAPP_LIBRARY = mkdtempSync(join(tmpdir(), 'lib-'));
  server = await startReviewServer(dir, 0, () => {});
});
afterAll(() => server.close());

describe('Review-Server', () => {
  it('liefert den Stand', async () => {
    const r = await (await fetch(`${server.url}/api/state`)).json();
    expect(r.story.offers).toHaveLength(5);
    expect(r.extraction).toBeNull();
  });

  it('speichert gültige Änderungen und entfernt Cache-Buster', async () => {
    const story = JSON.parse(readFileSync(join(dir, 'story.json'), 'utf8'));
    story.offers[0].price = '9,99';
    story.offers[0].img += '?v=123';
    const res = await fetch(`${server.url}/api/story`, { method: 'PUT', body: JSON.stringify(story) });
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(join(dir, 'story.json'), 'utf8'));
    expect(saved.offers[0].price).toBe('9,99');
    expect(saved.offers[0].img).not.toContain('?v=');
  });

  it('lehnt ungültige Stories mit verständlicher Meldung ab', async () => {
    const story = JSON.parse(readFileSync(join(dir, 'story.json'), 'utf8'));
    story.offers[0].price = '9.99';
    const res = await fetch(`${server.url}/api/story`, { method: 'PUT', body: JSON.stringify(story) });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/13,99/);
  });

  it('leitet / auf die Oberfläche um und liefert Job-Dateien', async () => {
    const r = await fetch(`${server.url}/`, { redirect: 'manual' });
    expect(r.headers.get('location')).toBe('/review/');
    expect((await fetch(`${server.url}/job/story.json`)).status).toBe(200);
    expect((await fetch(`${server.url}/job/../package.json`)).status).toBe(404);
  });
});
