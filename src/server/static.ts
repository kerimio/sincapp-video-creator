// Statische Dateien (gebaute Web-App, Bilder, Videos) mit passendem Content-Type ausliefern.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** URL-Präfix → Ordner. Das längste passende Präfix gewinnt. */
export type Mounts = Record<string, string | string[]>;

export interface StaticServer {
  url: string;
  close: () => Promise<void>;
  server: Server;
}

export function resolveFile(mounts: Mounts, pathname: string): string | null {
  const prefixes = Object.keys(mounts).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (!pathname.startsWith(prefix)) continue;
    const rel = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
    // mehrere Ordner pro Präfix: der erste, in dem die Datei liegt, gewinnt
    for (const dir of ([] as string[]).concat(mounts[prefix])) {
      const base = resolve(dir);
      const file = normalize(join(base, rel));
      if (file !== base && !file.startsWith(base + sep)) return null; // kein Ausbruch aus dem Ordner
      if (existsSync(file) && statSync(file).isFile()) return file;
    }
  }
  return null;
}

/** Liefert eine Datei aus den Mounts aus; false, wenn es keine gibt. */
export function serveStatic(mounts: Mounts, req: IncomingMessage, res: ServerResponse) {
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;
  const file = resolveFile(mounts, pathname);
  if (!file) return false;
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
  return true;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;

/** Statischer Server; `handler` (z. B. eine API) kommt vor den Dateien dran. */
export function startStaticServer(mounts: Mounts, port = 0, handler?: Handler, host = '127.0.0.1'): Promise<StaticServer> {
  const server = createServer(async (req, res) => {
    try {
      if (handler && (await handler(req, res))) return;
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: (e as Error).message }));
      return;
    }
    if (!serveStatic(mounts, req, res)) {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname;
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${pathname}`);
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      ok({ url: `http://127.0.0.1:${p}`, server, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
