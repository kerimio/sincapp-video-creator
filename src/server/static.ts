import { createServer, type Server } from 'node:http';
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
export type Mounts = Record<string, string>;

export interface StaticServer {
  url: string;
  close: () => Promise<void>;
  server: Server;
}

function resolveFile(mounts: Mounts, pathname: string): string | null {
  const prefixes = Object.keys(mounts).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (!pathname.startsWith(prefix)) continue;
    const base = resolve(mounts[prefix]);
    const rel = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
    const file = normalize(join(base, rel));
    if (file !== base && !file.startsWith(base + sep)) return null; // kein Ausbruch aus dem Ordner
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

export function startStaticServer(mounts: Mounts, port = 0): Promise<StaticServer> {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const file = resolveFile(mounts, pathname);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${pathname}`);
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      ok({ url: `http://127.0.0.1:${p}`, server, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
