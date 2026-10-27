import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths';

/** Python aus .venv (pnpm setup:python), sonst SINCAPP_PYTHON oder python3. */
export function pythonBin() {
  if (process.env.SINCAPP_PYTHON) return process.env.SINCAPP_PYTHON;
  for (const p of ['.venv/bin/python', '.venv/Scripts/python.exe']) {
    if (existsSync(join(ROOT, p))) return join(ROOT, p);
  }
  return 'python3';
}

/** Startet ein Skript aus tools/, schickt `input` als JSON an stdin, liefert stdout-Zeilen. */
export function runPython(script: string, args: string[], input?: unknown, onLine?: (line: string) => void): Promise<string[]> {
  return new Promise((ok, fail) => {
    const p = spawn(pythonBin(), ['-I', join(ROOT, 'tools', script), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines: string[] = [];
    let buf = '';
    let err = '';
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) {
          lines.push(line);
          onLine?.(line);
        }
      }
    });
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    p.on('error', fail);
    p.on('close', (code) => {
      if (buf.trim()) lines.push(buf.trim());
      if (code === 0) ok(lines);
      else fail(new Error(`${script} beendet mit Code ${code}${code === null ? ' (vermutlich zu wenig Arbeitsspeicher)' : ''}\n${err}`));
    });
    p.stdin.end(input === undefined ? '' : JSON.stringify(input));
  });
}
