// Instagram teilen: API-Aufrufe (mit Attrappe statt echtem Instagram), Planer, Vorschläge, öffentliche Dateien, App-Routen.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InstagramClient } from '../src/instagram/graph';
import { captionWithMentions, checkPost, imageTags, publishPost, type IgPost } from '../src/instagram/post';
import { readPosts, Scheduler, updatePosts } from '../src/instagram/schedule';
import { choices, marketHandles, planDate, weekDrafts } from '../src/instagram/drafts';
import { prepareForInstagram, publishFiles } from '../src/instagram/host';
import { parseStory, type Story } from '../src/core/schema';
import type { ExportFile } from '../src/render/export';
import { startAppServer } from '../src/app/server';

const TOKEN = 'GEHEIM-token-123';

/** Instagram-Attrappe: merkt sich alle Aufrufe, antwortet wie die echte API. */
function fakeInstagram(opts: { fail?: { path: RegExp; error: object } } = {}) {
  const calls: { method: string; path: string; params: Record<string, string> }[] = [];
  let n = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const params = Object.fromEntries(init?.body ? new URLSearchParams(String(init.body)) : url.searchParams);
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^\/v[\d.]+/, '');
    calls.push({ method, path, params });
    const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
    if (opts.fail && opts.fail.path.test(path)) return json({ error: opts.fail.error }, 400);
    if (path === '/me') return json({ user_id: '1784', username: 'sincapp.de' });
    if (/\/media$/.test(path)) return json({ id: `c${++n}` });
    if (/\/media_publish$/.test(path)) return json({ id: `m${params.creation_id}` });
    if (path === '/refresh_access_token') return json({ access_token: 'NEU' });
    if (/^\/m/.test(path)) return json({ permalink: `https://instagram.com/p/${path.slice(1)}` });
    if (/^\/c\d+$/.test(path)) return json({ status_code: 'FINISHED' });
    return json({ error: { message: 'unbekannt' } }, 404);
  }) as typeof fetch;
  return { calls, fetchImpl, client: new InstagramClient(TOKEN, fetchImpl, async () => {}) };
}

const post = (p: Partial<IgPost>): IgPost => ({ id: 'p1', kind: 'story', files: ['output/story-de.mp4'], caption: '', tags: [], at: new Date(0).toISOString(), status: 'geplant', createdAt: new Date(0).toISOString(), ...p });
const fakeHost = (closed: string[]) => async (files: string[]) => ({ urls: files.map((f) => `https://x.trycloudflare.com/t/${f.split('/').pop()}`), close: async () => void closed.push('zu') });

describe('Instagram-API', () => {
  it('schickt den Token nur mit, nie in Fehlermeldungen', async () => {
    const ig = fakeInstagram({ fail: { path: /\/media$/, error: { code: 190, message: `Invalid OAuth access token ${TOKEN}` } } });
    expect(await ig.client.me()).toEqual({ id: '1784', username: 'sincapp.de' });
    expect(ig.calls[0].params.access_token).toBe(TOKEN);
    const err = await ig.client.createContainer('1784', { image_url: 'https://x/a.jpg' }).catch((e: Error) => e.message);
    expect(err).toMatch(/abgelaufen oder ungültig/);
    expect(err).not.toContain(TOKEN);
  });

  it('wartet auf die Verarbeitung und meldet Fehler verständlich', async () => {
    let polls = 0;
    const f = (async () => new Response(JSON.stringify({ status_code: ++polls < 3 ? 'IN_PROGRESS' : 'ERROR', status: 'Video zu lang' }))) as unknown as typeof fetch;
    const c = new InstagramClient(TOKEN, f, async () => {});
    await expect(c.waitFinished('c1')).rejects.toThrow(/nicht verarbeiten: Video zu lang/);
    expect(polls).toBe(3);
  });
});

describe('Beitrag', () => {
  it('prüft Art, Dateien, Hashtags', () => {
    expect(checkPost({ kind: 'reel', files: ['output/a.png'], caption: '', tags: [] })).toMatch(/genau ein Video/);
    expect(checkPost({ kind: 'story', files: ['output/a.mp4', 'output/b.mp4'], caption: '', tags: [] })).toMatch(/genau ein/);
    expect(checkPost({ kind: 'beitrag', files: ['output/a.png', 'output/b.mp4'], caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' '), tags: [] })).toMatch(/30 Hashtags/);
    expect(checkPost({ kind: 'beitrag', files: ['output/a.png', 'output/b.png'], caption: 'ok', tags: [] })).toBeNull();
  });

  it('nennt markierte Märkte im Text, vor den Hashtags, ohne Doppelungen', () => {
    expect(captionWithMentions('Angebote!\n\n#angebote #sparen', ['saraymarket', 'oez.market'])).toBe('Angebote!\n\n@saraymarket @oez.market\n\n#angebote #sparen');
    expect(captionWithMentions('Bei @saraymarket', ['saraymarket'])).toBe('Bei @saraymarket');
    expect(captionWithMentions('', ['a'])).toBe('@a');
    expect(imageTags(['a', 'b'])).toEqual([{ username: 'a', x: 0.333, y: 0.9 }, { username: 'b', x: 0.667, y: 0.9 }]);
  });

  it('Story: Video mit Markierung, ohne Text; schließt den Tunnel', async () => {
    const ig = fakeInstagram();
    const closed: string[] = [];
    const r = await publishPost(post({ tags: ['saraymarket'], caption: 'wird ignoriert' }), ['/x/story-de.mp4'], { client: ig.client, igId: '1784', host: fakeHost(closed), log: () => {} });
    const create = ig.calls.find((c) => c.path.endsWith('/media'))!;
    expect(create.params).toMatchObject({ media_type: 'STORIES', video_url: 'https://x.trycloudflare.com/t/story-de.mp4' });
    expect(JSON.parse(create.params.user_tags)).toEqual([{ username: 'saraymarket' }]);
    expect(create.params.caption).toBeUndefined();
    expect(r).toEqual({ mediaIds: ['mc1'], permalink: null });
    expect(closed).toEqual(['zu']);
  });

  it('Reel mit Text und Erwähnung, Bild mit Positions-Markierung, Karussell', async () => {
    const ig = fakeInstagram();
    const deps = { client: ig.client, igId: '1784', host: fakeHost([]), log: () => {} };
    const reel = await publishPost(post({ kind: 'reel', files: ['output/reel-01-de.mp4'], caption: 'Hähnchen 3,99 €', tags: ['saraymarket'] }), ['/x/reel-01-de.mp4'], deps);
    expect(ig.calls.find((c) => c.path.endsWith('/media'))!.params).toMatchObject({ media_type: 'REELS', share_to_feed: 'true', caption: 'Hähnchen 3,99 €\n\n@saraymarket' });
    expect(reel.permalink).toBe('https://instagram.com/p/mc1');

    ig.calls.length = 0;
    await publishPost(post({ kind: 'beitrag', files: ['output/a.png'], caption: 'Text', tags: ['saraymarket'] }), ['/x/a.png'], deps);
    const img = ig.calls.find((c) => c.path.endsWith('/media'))!.params;
    expect(img.image_url).toMatch(/a\.png$/);
    expect(JSON.parse(img.user_tags)[0]).toMatchObject({ username: 'saraymarket', y: 0.9 });

    ig.calls.length = 0;
    await publishPost(post({ kind: 'beitrag', files: ['output/a.png', 'output/b.png'], caption: 'Karussell' }), ['/x/a.png', '/x/b.png'], deps);
    const creates = ig.calls.filter((c) => c.path.endsWith('/media'));
    expect(creates.map((c) => c.params.is_carousel_item ?? c.params.media_type)).toEqual(['true', 'true', 'CAROUSEL']);
    expect(creates[2].params).toMatchObject({ caption: 'Karussell', children: 'c3,c4' });
    expect(ig.calls.filter((c) => c.path.endsWith('/media_publish'))).toHaveLength(1);
  });

  it('schließt den Tunnel auch bei einem Fehler', async () => {
    const ig = fakeInstagram({ fail: { path: /\/media$/, error: { code: 4, message: 'limit' } } });
    const closed: string[] = [];
    await expect(publishPost(post({}), ['/x/s.mp4'], { client: ig.client, igId: '1', host: fakeHost(closed), log: () => {} })).rejects.toThrow(/Limit erreicht/);
    expect(closed).toEqual(['zu']);
  });
});

describe('Planer', () => {
  const dirOf = () => mkdtempSync(join(tmpdir(), 'igjob-'));

  it('teilt fällige Beiträge der Reihe nach, lässt künftige liegen, holt höchstens 3 h nach', async () => {
    const dir = dirOf();
    const now = Date.parse('2026-10-29T18:00:00Z');
    await updatePosts(dir, (ps) => {
      ps.push(post({ id: 'b', at: '2026-10-29T17:59:00Z' }), post({ id: 'a', at: '2026-10-29T17:00:00Z' }), post({ id: 'zukunft', at: '2026-10-30T18:00:00Z' }), post({ id: 'alt', at: '2026-10-29T10:00:00Z' }));
    });
    const order: string[] = [];
    const s = new Scheduler({ jobDirs: async () => [dir], now: () => now, publish: async (_d, p) => (order.push(p.id), { mediaIds: [`m-${p.id}`], permalink: null }) });
    await s.tick();
    expect(order).toEqual(['a', 'b']);
    const byId = Object.fromEntries((await readPosts(dir)).map((p) => [p.id, p]));
    expect(byId.a).toMatchObject({ status: 'veröffentlicht', mediaIds: ['m-a'] });
    expect(byId.zukunft.status).toBe('geplant');
    expect(byId.alt.status).toBe('verpasst');
  });

  it('hält Fehler fest und sendet nach einem Absturz nicht doppelt', async () => {
    const dir = dirOf();
    await updatePosts(dir, (ps) => void ps.push(post({ id: 'x' }), post({ id: 'hing', status: 'läuft' })));
    const s = new Scheduler({ jobDirs: async () => [dir], now: () => 1000, publish: async () => { throw new Error('Instagram: kaputt'); } });
    await s.recover();
    await s.tick();
    const byId = Object.fromEntries((await readPosts(dir)).map((p) => [p.id, p]));
    expect(byId.x).toMatchObject({ status: 'fehler', message: 'Instagram: kaputt' });
    expect(byId.hing.status).toBe('fehler');
    expect(byId.hing.message).toMatch(/beim Teilen beendet/);
  });
});

describe('Vorschläge', () => {
  const story = parseStory(JSON.parse(readFileSync('test/fixtures/reference-job/story.json', 'utf8'))) as Story;
  const files: ExportFile[] = [
    { path: 'output/story-de.mp4', kind: 'video', label: 'Video Story DE', format: 'story', lang: 'de' },
    { path: 'output/feed-de.mp4', kind: 'video', label: 'Video Feed DE', format: 'feed', lang: 'de' },
    { path: 'output/bilder/feed-de-01-titel.png', kind: 'image', label: 'Feed DE', format: 'feed', lang: 'de' },
    { path: 'output/story-tr.mp4', kind: 'video', label: 'Video Story TR', format: 'story', lang: 'tr' },
    { path: 'output/plan/01-mittwoch-28-10/reel-de.mp4', kind: 'video', label: 'Reel DE', format: 'story', lang: 'de', day: 'Mittwoch, 28.10.' },
    { path: 'output/plan/02-donnerstag-29-10/reel-de.mp4', kind: 'video', label: 'Reel DE', format: 'story', lang: 'de', day: 'Donnerstag, 29.10.' },
    { path: 'output/plan/03-freitag-30-10/reel-de.mp4', kind: 'video', label: 'Reel DE', format: 'story', lang: 'de', day: 'Freitag, 30.10.' },
    { path: 'output/plan/03-freitag-30-10/letzte-chance-de.mp4', kind: 'video', label: 'Letzte Chance DE', format: 'story', lang: 'de', day: 'Freitag, 30.10.' },
    { path: 'output/saray.zip', kind: 'zip', label: 'ZIP' },
  ];

  it('wählt passende Dateien je Art und Sprache', () => {
    expect(choices(files, 'reel', 'de').map((f) => f.path)).not.toContain('output/bilder/feed-de-01-titel.png');
    expect(choices(files, 'story', 'de').map((f) => f.path)).not.toContain('output/feed-de.mp4');
    expect(choices(files, 'beitrag', 'tr').map((f) => f.path)).toEqual(['output/story-tr.mp4']);
  });

  it('plant die Woche: Reel + Story pro Tag, Letzte Chance als Story, Vergangenes fällt weg', () => {
    expect(planDate('output/plan/01-mittwoch-28-10/reel-de.mp4', '2026-10-28')).toBe('2026-10-28');
    expect(planDate('output/plan/05-montag-02-01/reel-de.mp4', '2026-12-29')).toBe('2027-01-02');
    const d = weekDrafts(files, story, { lang: 'de', time: '18:00', reel: true, story: true, nowLocal: '2026-10-28T19:00' });
    expect(d.map((x) => `${x.local} ${x.kind} ${x.offer}`)).toEqual(['2026-10-29T18:00 reel 1', '2026-10-29T18:00 story 1', '2026-10-30T18:00 reel 2', '2026-10-30T18:00 story 2', '2026-10-30T18:00 story 2']);
    expect(d[0].text).toBe('output/plan/02-donnerstag-29-10/text-de.txt');
  });

  it('markiert den Markt; bei mehreren Märkten den des Angebots', () => {
    expect(marketHandles(story)).toEqual([{ name: 'Saray Market', handle: 'saraymarket' }]);
    const mixed = structuredClone(story);
    mixed.markets = [{ name: 'Saray Market', instagram: 'saraymarket' }, { name: 'Öz Market' }, { name: 'Aldi', instagram: 'aldi.nord' }];
    mixed.offers.forEach((o, i) => (o.market = ['Saray Market', 'Öz Market', 'Aldi'][i % 3]));
    expect(marketHandles(mixed).map((m) => m.handle)).toEqual(['saraymarket', 'aldi.nord']);
    expect(marketHandles(mixed, 2)).toEqual([{ name: 'Aldi', handle: 'aldi.nord' }]);
    expect(marketHandles(mixed, 1)).toEqual([]);
  });
});

describe('Öffentliche Dateien', () => {
  it('macht JPEG aus PNG, gibt Videos eine stille Tonspur und liefert nur den Zufallsordner aus', async () => {
    const work = mkdtempSync(join(tmpdir(), 'igpub-'));
    const png = join(work, 'bild.png');
    const mp4 = join(work, 'film.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', png]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-pix_fmt', 'yuv420p', '-an', mp4]);
    const ready = await prepareForInstagram([png, mp4], join(work, 'out'));
    expect(ready.map((f) => f.split('/').pop())).toEqual(['01.jpg', '02.mp4']);
    expect(readFileSync(ready[0]).subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', ready[1]]).toString().trim()).toBe('aac');

    // Tunnel-Attrappe: die „öffentliche“ Adresse ist der lokale Mini-Server selbst
    const pub = await publishFiles([png], join(work, 'tmp'), { log: () => {}, tunnel: async (local) => ({ url: local, close: async () => {} }) });
    expect(pub.urls[0]).toMatch(/\/[0-9a-f]{32}\/01\.jpg$/);
    const res = await fetch(pub.urls[0]);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect((await fetch(pub.urls[0].replace(/[0-9a-f]{32}\/01\.jpg$/, ''))).status).toBe(404);
    await pub.close();
    expect(existsSync(join(work, 'tmp'))).toBe(true);
    await expect(fetch(pub.urls[0])).rejects.toThrow();
  });
});

describe('App-Routen', () => {
  let server: Awaited<ReturnType<typeof startAppServer>>;
  const saved: Record<string, string | undefined> = {};
  const ENV = ['SINCAPP_JOBS', 'SINCAPP_ENV_FILE', 'INSTAGRAM_ACCESS_TOKEN'];
  const ig = fakeInstagram();
  beforeAll(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.SINCAPP_JOBS = mkdtempSync(join(tmpdir(), 'jobs-'));
    process.env.SINCAPP_ENV_FILE = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
    server = await startAppServer(0, () => {}, ig.fetchImpl, { scheduler: false });
  });
  afterAll(async () => {
    await server.close();
    for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  });
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${server.url}${path}`, { method, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };

  it('zeigt die Verbindung, plant Beiträge ein, prüft Dateien und lässt löschen', async () => {
    expect((await api('GET', '/api/instagram')).data).toMatchObject({ configured: false, username: null });
    const { data: job } = await api('POST', '/api/jobs', { market: 'saray', title: 'IG' });
    const dir = join(process.env.SINCAPP_JOBS!, job.id);
    mkdirSync(join(dir, 'output'), { recursive: true });
    writeFileSync(join(dir, 'output', 'story-de.mp4'), 'x');

    const at = '2026-12-01T17:00:00.000Z';
    expect((await api('POST', `/api/jobs/${job.id}/instagram`, { kind: 'story', files: ['output/story-de.mp4'], at })).data.error).toMatch(/nicht verbunden/);
    await api('PUT', '/api/settings', { INSTAGRAM_ACCESS_TOKEN: TOKEN });
    expect((await api('GET', '/api/instagram?fresh')).data).toMatchObject({ configured: true, username: 'sincapp.de' });

    expect((await api('POST', `/api/jobs/${job.id}/instagram`, { kind: 'story', files: ['../job.json'], at })).data.error).toMatch(/nicht gefunden/);
    expect((await api('POST', `/api/jobs/${job.id}/instagram`, { kind: 'story', files: ['output/fehlt.mp4'], at })).data.error).toMatch(/nicht gefunden/);
    const { status, data: p } = await api('POST', `/api/jobs/${job.id}/instagram`, { kind: 'story', files: ['output/story-de.mp4'], tags: ['saraymarket'], at, label: 'Story DE' });
    expect(status).toBe(201);
    expect(p).toMatchObject({ status: 'geplant', at, tags: ['saraymarket'] });
    expect((await api('GET', `/api/jobs/${job.id}/instagram`)).data).toHaveLength(1);
    expect((await api('GET', '/api/instagram/plan')).data[0]).toMatchObject({ id: p.id, jobId: job.id });
    await api('DELETE', `/api/jobs/${job.id}/instagram/${p.id}`);
    expect((await api('GET', `/api/jobs/${job.id}/instagram`)).data).toHaveLength(0);
    expect(readFileSync(process.env.SINCAPP_ENV_FILE!, 'utf8')).toContain('INSTAGRAM_ACCESS_TOKEN=');
  });
});
