import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cacheMarket, listMarkets, listProspects, marketDirs, pagesToRead, todayBerlin, type FsMarket, type FsProspect } from '../firestore/firestore';
import { existsSync } from 'node:fs';
import { copyFile, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { aiProvider, NO_AI_KEY } from '../ai/provider';
import { Library, libraryDir } from '../library/library';
import { ROOT } from '../paths';
import { readBody, sendJson, jobApi } from '../review/server';
import { startStaticServer } from '../server/static';
import { createJob, jobPath, jobsDir, listJobs, readJob, safeName, saveJob, summarize } from './jobs';
import { prepareStory, type JobSettings, type Progress } from './pipeline';
import { MAGIC_PACK } from '../core/packs';

const INPUT_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf']);
const KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'BRAVE_API_KEY', 'REMOVEBG_API_KEY'] as const;
const SAMPLES = join(ROOT, 'reference/samples/saray-2026-10-28');

interface Run {
  running: boolean;
  /** Zauberknopf: nach dem Auslesen direkt alles exportieren */
  auto?: boolean;
  progress: Progress;
  error?: string;
  notes?: string[];
}

/** .env-Einträge setzen (andere Zeilen bleiben), und sofort für diesen Prozess übernehmen. */
async function writeEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  const file = process.env.SINCAPP_ENV_FILE || join(ROOT, '.env');
  const lines = existsSync(file) ? (await readFile(file, 'utf8')).split('\n') : [];
  for (const [k, v] of Object.entries(values)) {
    if (!KEYS.includes(k as never) || typeof v !== 'string') continue;
    const clean = v.trim().replace(/[\r\n]/g, '');
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${clean}`;
    else lines.push(`${k}=${clean}`);
    if (clean) process.env[k] = clean;
    else delete process.env[k];
  }
  await writeFile(file, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
}

/** Stand des Codes: Git-Commit, sonst package.json-Version. */
export function appVersion() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

export async function startAppServer(port = 4321, log: (m: string) => void = console.log, fetchImpl: typeof fetch = fetch) {
  const runs = new Map<string, Run>();
  // Firestore-Listen kurz zwischenspeichern, damit Klicken im Assistenten nicht jedes Mal lädt
  let fsCache: { at: number; markets: FsMarket[]; prospects: FsProspect[] } | null = null;
  const firestore = async (fresh = false) => {
    if (!fsCache || fresh || Date.now() - fsCache.at > 60_000) {
      const [markets, prospects] = await Promise.all([listMarkets(fetchImpl), listProspects(fetchImpl)]);
      fsCache = { at: Date.now(), markets, prospects };
    }
    return fsCache;
  };
  const apis = new Map<string, ReturnType<typeof jobApi>>();
  const apiFor = (id: string) => {
    let a = apis.get(id);
    if (!a) apis.set(id, (a = jobApi(jobPath(id), `/jobs/${id}/`, log)));
    return a;
  };

  function process_(id: string, settings: JobSettings, auto = false) {
    const run: Run = { running: true, auto, progress: { step: 'extract', message: 'Startet …', fraction: 0 } };
    runs.set(id, run);
    // Beim Zauberknopf zählt das Auslesen bis 50 %, der Export die zweite Hälfte.
    const k = auto ? 0.5 : 1;
    (async () => {
      const r = await prepareStory(jobPath(id), settings, (p) => (run.progress = { ...p, fraction: p.fraction * k }));
      run.notes = r.notes;
      if (!auto) return;
      const api = apiFor(id);
      run.progress = { step: 'render', message: 'Videos, Reels und Bilder werden erstellt …', fraction: 0.5 };
      await api.startRender({ ...MAGIC_PACK, langs: r.story.lang }, (f, m) => (run.progress = { step: 'render', message: m, fraction: 0.5 + f * 0.5 }));
      if (api.render.error) throw new Error(`Export: ${api.render.error}`);
    })()
      .catch((e) => (run.error = (e as Error).message))
      .finally(() => (run.running = false));
  }

  const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    const method = req.method ?? 'GET';
    if (p === '/') {
      res.writeHead(302, { location: '/app/' }).end();
      return true;
    }
    if (!p.startsWith('/api/')) return false;

    if (method === 'GET' && p === '/api/version') return sendJson(res, { version: appVersion() });
    if (method === 'POST' && p === '/api/shutdown') {
      // nur für einen neueren Start auf demselben Rechner (Server lauscht ausschließlich auf 127.0.0.1)
      sendJson(res, { ok: true });
      log('Beendet – eine neuere Version wurde gestartet.');
      setTimeout(() => process.exit(0), 200);
      return true;
    }

    if (method === 'GET' && p === '/api/markets') {
      const files = (await readdir(join(ROOT, 'markets'))).filter((f) => f.endsWith('.json'));
      const markets = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(ROOT, 'markets', f), 'utf8'))));
      return sendJson(res, markets.map((m) => ({ slug: m.slug, name: m.name, logo: `/markets/${m.logo}`, addresses: m.addresses })));
    }

    if (method === 'GET' && p === '/api/firestore/markets') {
      const { markets, prospects } = await firestore(url.searchParams.has('fresh'));
      const today = todayBerlin();
      return sendJson(
        res,
        markets.map((m) => ({ ...m, current: prospects.filter((x) => x.marketIds.includes(m.id) && x.validUntil >= today).length })),
      );
    }
    if (method === 'GET' && p === '/api/firestore/image') {
      // Logos/Seitenvorschauen über den eigenen Server laden (nur Firebase Storage)
      const src = new URL(url.searchParams.get('url') ?? '', 'http://x');
      if (src.protocol !== 'https:' || src.hostname !== 'firebasestorage.googleapis.com') return sendJson(res, { error: 'Nur Firebase-Storage-Bilder' }, 400);
      const r = await fetchImpl(src.href, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return sendJson(res, { error: `HTTP ${r.status}` }, 502);
      res.writeHead(200, { 'content-type': r.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'max-age=86400' }).end(Buffer.from(await r.arrayBuffer()));
      return true;
    }
    const fsm = p.match(/^\/api\/firestore\/markets\/([^/]+)\/prospects$/);
    if (method === 'GET' && fsm) {
      const { prospects } = await firestore();
      const id = decodeURIComponent(fsm[1]);
      const today = todayBerlin();
      const mine = prospects.filter((x) => x.marketIds.includes(id));
      // aktuelle zuerst (früheste Gültigkeit vorn), danach die letzten abgelaufenen
      const current = mine.filter((x) => x.validUntil >= today).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
      const past = mine.filter((x) => x.validUntil < today).slice(0, 4);
      return sendJson(res, [...current, ...past].map((x) => ({ id: x.id, title: x.title, validFrom: x.validFrom, validUntil: x.validUntil, pages: x.imageUrls.length, thumb: x.thumbnailUrls[0] ?? x.imageUrls[0], current: x.validUntil >= today })));
    }
    if (method === 'POST' && p === '/api/jobs/from-firestore') {
      // ohne Prospekt: nur der Markt kommt aus Firestore, die Seiten lädt man danach selbst hoch.
      // Mehrere Prospekte desselben Markts werden zusammen gelesen; die besten Angebote kommen in die Story.
      const b = JSON.parse((await readBody(req)).toString('utf8')) as { marketId: string; prospectId?: string; prospectIds?: string[]; topic?: string | null; count?: number };
      const { markets, prospects } = await firestore();
      const m = markets.find((x) => x.id === b.marketId);
      const ids = [...new Set(b.prospectIds?.length ? b.prospectIds : b.prospectId ? [b.prospectId] : [])];
      const prs = ids.map((id) => prospects.find((x) => x.id === id));
      if (!m || prs.some((x) => !x)) return sendJson(res, { error: 'Markt oder Prospekt nicht (mehr) in Firestore' }, 404);
      const chosen = prs as FsProspect[];
      const market = await cacheMarket(m, fetchImpl);
      const title = chosen.length ? `${m.name} – ${chosen.map((x) => x.title).join(' + ')}` : m.name;
      const meta = await createJob({ market: market.slug, topic: b.topic || null, count: b.count || undefined }, title);
      if (!chosen.length) return sendJson(res, meta, 201);
      meta.source = { firestoreProspect: chosen[0].id, firestoreProspects: chosen.map((x) => x.id), marketId: m.id };
      await saveJob(meta);
      // Seiten laden (1200 px aus dem Admin-Tool); Seiten ohne Produkte werden übersprungen, wenn Fundstellen da sind
      const dir = jobPath(meta.id);
      const skipped: string[] = [];
      await Promise.all(
        chosen.flatMap((pr, k) => {
          const read = pagesToRead(pr);
          if (read.length < pr.imageUrls.length) skipped.push(`${pr.title}: ${pr.imageUrls.length - read.length} von ${pr.imageUrls.length} Seiten ohne Produkte übersprungen`);
          return read.map(async (n) => {
            const r = await fetchImpl(pr.imageUrls[n - 1], { signal: AbortSignal.timeout(30000) });
            if (!r.ok) throw new Error(`${pr.title}, Seite ${n} nicht ladbar (HTTP ${r.status})`);
            const name = `${chosen.length > 1 ? `p${k + 1}-` : ''}seite-${String(n).padStart(2, '0')}.jpg`;
            await writeFile(join(dir, 'input', name), Buffer.from(await r.arrayBuffer()));
          });
        }),
      );
      await writeFile(join(dir, 'firestore-prospekt.json'), JSON.stringify(chosen.length === 1 ? chosen[0] : chosen, null, 2) + '\n');
      return sendJson(res, { ...meta, notes: skipped }, 201);
    }

    if (p === '/api/settings') {
      if (method === 'PUT') await writeEnv(JSON.parse((await readBody(req)).toString('utf8')));
      return sendJson(res, { ...Object.fromEntries(KEYS.map((k) => [k, !!process.env[k]])), ai: aiProvider() });
    }

    if (p === '/api/library') {
      const lib = await Library.open();
      return sendJson(res, lib.entries.map((e) => ({ ...e, url: `/library/${encodeURIComponent(e.img)}` })));
    }
    const libDel = p.match(/^\/api\/library\/(.+)$/);
    if (libDel && method === 'DELETE') {
      const lib = await Library.open();
      const key = decodeURIComponent(libDel[1]);
      lib.entries = lib.entries.filter((e) => e.img !== key);
      await lib.save();
      return sendJson(res, { ok: true });
    }

    if (p === '/api/jobs') {
      if (method === 'GET') return sendJson(res, await listJobs());
      if (method === 'POST') {
        const s = JSON.parse((await readBody(req)).toString('utf8')) as JobSettings & { title?: string };
        if (!s.market) throw new Error('Bitte einen Markt wählen');
        const meta = await createJob({ market: s.market, topic: s.topic || null, count: s.count || undefined }, s.title);
        return sendJson(res, meta, 201);
      }
    }

    if (method === 'POST' && p === '/api/jobs/demo') {
      // Saray-Beispiel mit den aufgezeichneten Antworten – läuft ohne API-Key
      const meta = await createJob({ market: 'saray', recorded: join(ROOT, 'test/fixtures/saray-extraction') }, 'Demo: Saray Market (Beispiel)');
      for (const f of await readdir(SAMPLES)) if (f.endsWith('.png')) await copyFile(join(SAMPLES, f), join(jobPath(meta.id), 'input', f));
      return sendJson(res, meta, 201);
    }

    const jm = p.match(/^\/api\/jobs\/([a-z0-9-]+)(?:\/(.*))?$/);
    if (jm) {
      const [, id, sub = ''] = jm;
      const dir = jobPath(id);
      if (!existsSync(dir)) return sendJson(res, { error: 'Job nicht gefunden' }, 404);

      if (sub === '' && method === 'GET') {
        const files = existsSync(join(dir, 'input')) ? (await readdir(join(dir, 'input'))).filter((f) => !f.startsWith('.')) : [];
        return sendJson(res, { ...(await summarize(id)), files, run: runs.get(id) ?? null });
      }
      if (sub === '' && method === 'DELETE') {
        await rm(dir, { recursive: true, force: true });
        return sendJson(res, { ok: true });
      }
      if (sub === '' && method === 'PATCH') {
        const meta = await readJob(id);
        const s = JSON.parse((await readBody(req)).toString('utf8')) as Partial<JobSettings> & { title?: string };
        if (s.title) meta.title = s.title;
        meta.settings = { ...meta.settings, ...Object.fromEntries(Object.entries(s).filter(([k]) => ['market', 'topic', 'count'].includes(k))) };
        await saveJob(meta);
        return sendJson(res, meta);
      }

      if (sub === 'files' && method === 'POST') {
        const name = safeName(url.searchParams.get('name') ?? 'seite.png');
        if (!INPUT_EXT.has(extname(name))) throw new Error('Erlaubt sind PDF, JPG, PNG und WEBP');
        await writeFile(join(dir, 'input', name), await readBody(req));
        return sendJson(res, { name }, 201);
      }
      const fm = sub.match(/^files\/(.+)$/);
      if (fm && method === 'DELETE') {
        await rm(join(dir, 'input', safeName(decodeURIComponent(fm[1]))), { force: true });
        return sendJson(res, { ok: true });
      }

      if (sub === 'process' && method === 'POST') {
        if (runs.get(id)?.running) return sendJson(res, { error: 'Läuft bereits' }, 409);
        const meta = await readJob(id);
        if (!meta.settings.recorded && !aiProvider()) throw new Error(NO_AI_KEY);
        const body = (await readBody(req)).toString('utf8');
        process_(id, meta.settings, !!(body && JSON.parse(body).auto));
        return sendJson(res, runs.get(id), 202);
      }
      if (sub === 'progress' && method === 'GET') return sendJson(res, runs.get(id) ?? null);

      if (await apiFor(id)(method, sub, req, res)) return true;
    }
    return sendJson(res, { error: 'Unbekannte Anfrage' }, 404);
  };

  const mounts = {
    '/': join(ROOT, 'dist/template'),
    '/app/': join(ROOT, 'dist/review'),
    '/assets/': join(ROOT, 'assets'),
    '/markets/': marketDirs(),
    '/jobs/': jobsDir(),
    '/library/': libraryDir(),
  };
  return startStaticServer(mounts, port, handler);
}
