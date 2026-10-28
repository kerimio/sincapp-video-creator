// Dateien kurz öffentlich erreichbar machen, damit Instagram sie abholen kann (die API lädt nur von einer öffentlichen URL).
// Weg: ein eigener Mini-Server, der nur einen Ordner unter einem Zufallspfad ausliefert, und ein Cloudflare-Schnelltunnel
// (cloudflared, ohne Konto). Die App selbst wird dabei nie öffentlich; nach dem Teilen ist alles wieder zu.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ROOT } from '../paths';
import { ffmpegBin, run } from '../render/render';
import { startStaticServer } from '../server/static';

export interface PublicFiles {
  urls: string[];
  close: () => Promise<void>;
}

/** Öffnet einen Tunnel auf einen lokalen Port und liefert die öffentliche Adresse. */
export type Tunnel = (localUrl: string, log: (m: string) => void) => Promise<{ url: string; close: () => Promise<void> }>;

const TOOLS = join(ROOT, '.tools');

/** Name der cloudflared-Datei für dieses System bei den GitHub-Releases. */
function cloudflaredAsset(): string | null {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : null;
  if (!arch) return null;
  if (process.platform === 'linux') return `cloudflared-linux-${arch}`;
  if (process.platform === 'darwin') return `cloudflared-darwin-${arch}.tgz`;
  if (process.platform === 'win32' && arch === 'amd64') return 'cloudflared-windows-amd64.exe';
  return null;
}

/** cloudflared finden; fehlt es, einmalig in .tools/ herunterladen (offizielle Releases von Cloudflare). */
export async function ensureCloudflared(log: (m: string) => void, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
  const local = join(TOOLS, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(local)) return local;
  const onPath = await new Promise<boolean>((ok) => {
    const p = spawn('cloudflared', ['--version'], { stdio: 'ignore' });
    p.on('error', () => ok(false));
    p.on('close', (c) => ok(c === 0));
  });
  if (onPath) return 'cloudflared';
  const asset = cloudflaredAsset();
  if (!asset) throw new Error('Für dieses System gibt es kein cloudflared zum Herunterladen. Bitte cloudflared selbst installieren.');
  log('Einmalig: Cloudflare-Tunnel (cloudflared) wird heruntergeladen …');
  const res = await fetchImpl(`https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`cloudflared konnte nicht heruntergeladen werden (HTTP ${res.status})`);
  await mkdir(TOOLS, { recursive: true });
  const tmp = join(TOOLS, `.${asset}.tmp`);
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  if (asset.endsWith('.tgz')) {
    await run('tar', ['-xzf', tmp, '-C', TOOLS]);
    await rm(tmp, { force: true });
  } else {
    await rename(tmp, local);
  }
  await chmod(local, 0o755);
  return local;
}

/** Cloudflare-Schnelltunnel: `cloudflared tunnel --url …` druckt eine https://….trycloudflare.com-Adresse. */
export const cloudflareTunnel: Tunnel = async (localUrl, log) => {
  const bin = await ensureCloudflared(log);
  const proc: ChildProcess = spawn(bin, ['tunnel', '--no-autoupdate', '--url', localUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
  const close = async () => {
    if (proc.exitCode === null) proc.kill();
  };
  const url = await new Promise<string>((ok, fail) => {
    let seen = '';
    const timer = setTimeout(() => fail(new Error('Der Cloudflare-Tunnel startet nicht (keine Internetverbindung?)')), 45_000);
    const onData = (d: Buffer) => {
      seen = (seen + d).slice(-8000);
      const m = seen.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        ok(m[0]);
      }
    };
    proc.stdout!.on('data', onData);
    proc.stderr!.on('data', onData);
    proc.on('error', (e) => (clearTimeout(timer), fail(new Error(`cloudflared lässt sich nicht starten: ${e.message}`))));
    proc.on('close', () => (clearTimeout(timer), fail(new Error('Der Cloudflare-Tunnel wurde beendet, bevor er bereit war'))));
  }).catch(async (e) => {
    await close();
    throw e;
  });
  return { url, close };
};

/** Hat die MP4 eine Tonspur? Unsere Videos sind stumm (keine Musik). */
function hasAudio(file: string): Promise<boolean> {
  const probe = process.env.FFPROBE_PATH || ffmpegBin().replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  return new Promise((ok) => {
    const p = spawn(probe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => ok(false));
    p.on('close', () => ok(out.trim().length > 0));
  });
}

/**
 * Bereitet Dateien für Instagram vor: Bilder als JPEG (PNG nimmt die API nicht), Videos mit einer stillen
 * Tonspur (manche Uploads ohne Tonspur lehnt Instagram ab – zu hören ist nichts).
 */
export async function prepareForInstagram(files: string[], dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const out: string[] = [];
  for (const [i, file] of files.entries()) {
    const ext = extname(file).toLowerCase();
    const n = String(i + 1).padStart(2, '0');
    if (ext === '.mp4') {
      const target = join(dir, `${n}.mp4`);
      if (await hasAudio(file)) await copyFile(file, target);
      else await run(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', file, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', target]);
      out.push(target);
    } else if (ext === '.jpg' || ext === '.jpeg') {
      await copyFile(file, join(dir, `${n}.jpg`));
      out.push(join(dir, `${n}.jpg`));
    } else {
      await run(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', file, '-q:v', '2', join(dir, `${n}.jpg`)]);
      out.push(join(dir, `${n}.jpg`));
    }
  }
  return out;
}

/**
 * Macht die Dateien öffentlich erreichbar, bis `close()` aufgerufen wird. Nur der Zufallsordner wird ausgeliefert.
 * Prüft vor der Rückgabe, dass die erste Datei über die öffentliche Adresse wirklich ankommt (DNS braucht ein paar Sekunden).
 */
export async function publishFiles(files: string[], workDir: string, opts: { log: (m: string) => void; tunnel?: Tunnel; fetchImpl?: typeof fetch; wait?: (ms: number) => Promise<void> }): Promise<PublicFiles> {
  const token = randomBytes(16).toString('hex');
  const dir = join(workDir, token);
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetchImpl = opts.fetchImpl ?? fetch;
  let server: Awaited<ReturnType<typeof startStaticServer>> | null = null;
  let tunnel: Awaited<ReturnType<Tunnel>> | null = null;
  const close = async () => {
    await tunnel?.close().catch(() => {});
    await server?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  };
  try {
    opts.log('Dateien werden für Instagram vorbereitet …');
    const ready = await prepareForInstagram(files, dir);
    server = await startStaticServer({ [`/${token}/`]: dir });
    opts.log('Öffentliche Adresse wird geöffnet …');
    tunnel = await (opts.tunnel ?? cloudflareTunnel)(server.url, opts.log);
    const urls = ready.map((f) => `${tunnel!.url}/${token}/${f.slice(dir.length + 1)}`);
    for (let i = 0; ; i++) {
      const ok = await fetchImpl(urls[0], { method: 'HEAD', signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false);
      if (ok) break;
      if (i >= 20) throw new Error('Die Dateien sind von außen nicht erreichbar – bitte erneut versuchen');
      await wait(3000);
    }
    return { urls, close };
  } catch (e) {
    await close();
    throw e;
  }
}
