// HTTP-Server der Web-App: Jobs anlegen und starten, Einstellungen, Märkte; Katalog- und Job-Routen kommen aus catalog-api.ts und review/server.ts.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cacheMarket, mixMarket, listMarkets, listProspects, marketDirs, marketsCacheDir, pagesToRead, todayBerlin, type FsMarket, type FsProspect } from '../firestore/firestore';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { aiProvider, currentModels, NO_AI_KEY } from '../ai/provider';
import { usageSummary } from '../ai/usage';
import { libraryDir } from '../library/library';
import { catalogApi } from '../library/catalog-api';
import { ROOT } from '../paths';
import { readBody, sendJson, jobApi } from '../review/server';
import { startStaticServer } from '../server/static';
import { createJob, jobPath, jobsDir, listJobs, readJob, safeName, saveJob, summarize } from './jobs';
import { prepareStory, type JobSettings, type Progress } from './pipeline';
import { MAGIC_PACK } from '../core/packs';
import { checkCampaign, prepareCampaign, type CatalogCampaign } from './campaign';

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
  // Firestore kostet pro gelesenem Dokument: Listen zwischenspeichern (auch über Neustarts),
  // Märkte 6 h, Prospekte 15 min; nur Prospekte der letzten 3 Wochen lesen. "Neu laden" holt sofort frisch.
  const listFile = join(marketsCacheDir(), 'firestore-listen.json');
  let fsCache: { marketsAt: number; prospectsAt: number; markets: FsMarket[]; prospects: FsProspect[] } | null = null;
  const firestore = async (fresh = false) => {
    if (!fsCache && existsSync(listFile)) fsCache = JSON.parse(await readFile(listFile, 'utf8').catch(() => 'null'));
    const now = Date.now();
    const oldMarkets = !fsCache || fresh || now - fsCache.marketsAt > 6 * 3600_000;
    const oldProspects = !fsCache || fresh || now - fsCache.prospectsAt > 15 * 60_000;
    if (oldMarkets || oldProspects) {
      const since = todayBerlin(new Date(now - 21 * 86_400_000));
      const [markets, prospects] = await Promise.all([
        oldMarkets ? listMarkets(fetchImpl) : fsCache!.markets,
        oldProspects ? listProspects(fetchImpl, since) : fsCache!.prospects,
      ]);
      fsCache = { marketsAt: oldMarkets ? now : fsCache!.marketsAt, prospectsAt: oldProspects ? now : fsCache!.prospectsAt, markets, prospects };
      await mkdir(dirname(listFile), { recursive: true });
      await writeFile(listFile, JSON.stringify(fsCache));
    }
    return fsCache!;
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
      const onProgress = (p: Progress) => (run.progress = { ...p, fraction: p.fraction * k });
      const r = settings.catalog ? await prepareCampaign(jobPath(id), settings.market, settings.catalog, onProgress) : await prepareStory(jobPath(id), settings, onProgress);
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
      // auf der Platte merken: jedes Vorschaubild wird nur einmal aus dem Storage geladen
      const cached = join(marketsCacheDir(), 'vorschau', createHash('sha256').update(src.href).digest('hex').slice(0, 32));
      if (existsSync(cached)) {
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=604800' }).end(await readFile(cached));
        return true;
      }
      const r = await fetchImpl(src.href, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return sendJson(res, { error: `HTTP ${r.status}` }, 502);
      const buf = Buffer.from(await r.arrayBuffer());
      await mkdir(dirname(cached), { recursive: true });
      await writeFile(cached, buf);
      res.writeHead(200, { 'content-type': r.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'max-age=604800' }).end(buf);
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
      // Mehrere Prospekte werden zusammen gelesen; die besten Angebote kommen in die Story.
      // Prospekte verschiedener Märkte ("picks") ergeben ein sincapp-Video, jedes Angebot mit seinem Markt.
      const b = JSON.parse((await readBody(req)).toString('utf8')) as { marketId?: string; prospectId?: string; prospectIds?: string[]; picks?: { marketId: string; prospectId: string }[]; topic?: string | null; count?: number };
      const picks = b.picks?.length ? b.picks : [...new Set(b.prospectIds?.length ? b.prospectIds : b.prospectId ? [b.prospectId] : [])].map((prospectId) => ({ marketId: b.marketId ?? '', prospectId }));
      const marketIds = [...new Set(picks.length ? picks.map((x) => x.marketId) : [b.marketId ?? ''])];
      let { markets, prospects } = await firestore();
      // gerade erst in Firestore angelegt? Dann einmal frisch laden
      const complete = () => marketIds.every((id) => markets.some((x) => x.id === id)) && picks.every((x) => prospects.some((y) => y.id === x.prospectId));
      if (!complete()) ({ markets, prospects } = await firestore(true));
      if (!complete()) return sendJson(res, { error: 'Markt oder Prospekt nicht (mehr) in Firestore' }, 404);
      const ms = marketIds.map((id) => markets.find((x) => x.id === id)!);
      const chosen = picks.map((x) => ({ ...prospects.find((y) => y.id === x.prospectId)!, marketName: ms.find((m) => m.id === x.marketId)!.name }));
      const mixed = ms.length > 1;
      const market = mixed ? await mixMarket(ms) : await cacheMarket(ms[0], fetchImpl);
      const title = mixed ? `sincapp – ${ms.map((m) => m.name).join(' + ')}` : chosen.length ? `${ms[0].name} – ${chosen.map((x) => x.title).join(' + ')}` : ms[0].name;
      const meta = await createJob({ market: market.slug, topic: b.topic || null, count: b.count || undefined }, title);
      if (!chosen.length) return sendJson(res, meta, 201);
      meta.source = { firestoreProspect: chosen[0].id, firestoreProspects: chosen.map((x) => x.id), marketId: ms[0].id, ...(mixed ? { marketIds } : {}) };
      await saveJob(meta);
      // Seiten laden (1200 px aus dem Admin-Tool); Seiten ohne Produkte werden übersprungen, wenn Fundstellen da sind.
      // Bei mehreren Prospekten steht die Nummer vorn ("p2-seite-03.jpg"), daran hängt später der Markt des Angebots.
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

    if (method === 'GET' && p === '/api/usage') {
      const month = url.searchParams.get('month') ?? undefined;
      return sendJson(res, { ...(await usageSummary(month && /^\d{4}-\d{2}$/.test(month) ? month : undefined)), models: currentModels() });
    }

    if (p.startsWith('/api/library') && (await catalogApi(method, p, req, res))) return true;

    if (p === '/api/jobs') {
      if (method === 'GET') return sendJson(res, await listJobs());
      if (method === 'POST') {
        const s = JSON.parse((await readBody(req)).toString('utf8')) as JobSettings & { title?: string };
        if (!s.market) throw new Error('Bitte einen Markt wählen');
        const meta = await createJob({ market: s.market, topic: s.topic || null, count: s.count || undefined }, s.title);
        return sendJson(res, meta, 201);
      }
    }

    if (method === 'POST' && p === '/api/kampagne') {
      // Kampagne aus dem Katalog: Produkte + Preise, ohne Prospekt und ohne KI
      const b = JSON.parse((await readBody(req)).toString('utf8')) as CatalogCampaign & { marketId?: string; market?: string; title?: string; auto?: boolean };
      checkCampaign(b);
      let market = b.market ?? '';
      if (b.marketId) {
        const m = (await firestore()).markets.find((x) => x.id === b.marketId);
        if (!m) throw new Error('Markt nicht gefunden');
        market = (await cacheMarket(m, fetchImpl)).slug;
      }
      if (!market) throw new Error('Bitte einen Markt wählen');
      const meta = await createJob({ market, catalog: { items: b.items, from: b.from, to: b.to } }, b.title || undefined);
      process_(meta.id, meta.settings, !!b.auto);
      return sendJson(res, meta, 201);
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
        if (!meta.settings.recorded && !meta.settings.catalog && !aiProvider()) throw new Error(NO_AI_KEY);
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
