import { existsSync } from 'node:fs';
import { copyFile, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Library, libraryDir } from '../library/library';
import { ROOT } from '../paths';
import { readBody, sendJson, jobApi } from '../review/server';
import { startStaticServer } from '../server/static';
import { createJob, jobPath, jobsDir, listJobs, readJob, safeName, saveJob, summarize } from './jobs';
import { prepareStory, type JobSettings, type Progress } from './pipeline';

const INPUT_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf']);
const KEYS = ['ANTHROPIC_API_KEY', 'BRAVE_API_KEY', 'REMOVEBG_API_KEY'] as const;
const SAMPLES = join(ROOT, 'reference/samples/saray-2026-10-28');

interface Run {
  running: boolean;
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

export async function startAppServer(port = 4321, log: (m: string) => void = console.log) {
  const runs = new Map<string, Run>();
  const apis = new Map<string, ReturnType<typeof jobApi>>();
  const apiFor = (id: string) => {
    let a = apis.get(id);
    if (!a) apis.set(id, (a = jobApi(jobPath(id), `/jobs/${id}/`, log)));
    return a;
  };

  function process_(id: string, settings: JobSettings) {
    const run: Run = { running: true, progress: { step: 'extract', message: 'Startet …', fraction: 0 } };
    runs.set(id, run);
    prepareStory(jobPath(id), settings, (p) => (run.progress = p))
      .then((r) => (run.notes = r.notes))
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

    if (method === 'GET' && p === '/api/markets') {
      const files = (await readdir(join(ROOT, 'markets'))).filter((f) => f.endsWith('.json'));
      const markets = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(ROOT, 'markets', f), 'utf8'))));
      return sendJson(res, markets.map((m) => ({ slug: m.slug, name: m.name, logo: `/markets/${m.logo}`, addresses: m.addresses })));
    }

    if (p === '/api/settings') {
      if (method === 'PUT') await writeEnv(JSON.parse((await readBody(req)).toString('utf8')));
      return sendJson(res, Object.fromEntries(KEYS.map((k) => [k, !!process.env[k]])));
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
        if (!meta.settings.recorded && !process.env.ANTHROPIC_API_KEY) throw new Error('Zum Auslesen fehlt der Anthropic-API-Key – bitte unter Einstellungen eintragen.');
        process_(id, meta.settings);
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
    '/markets/': join(ROOT, 'markets'),
    '/jobs/': jobsDir(),
    '/library/': libraryDir(),
  };
  return startStaticServer(mounts, port, handler);
}
