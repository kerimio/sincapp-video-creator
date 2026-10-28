import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { aiCacheDir } from './cache';

/**
 * Jeder bezahlte KI-Aufruf wird mitgeschrieben (Modell, Aufgabe, Tokens), damit man
 * in den Einstellungen sieht, was das Tool verbraucht. Antworten aus dem Speicher
 * (Cache) kosten nichts und werden extra gezählt.
 */
export interface UsageEntry {
  at: string;
  model: string;
  /** "seite" (Prospektseite lesen), "preise" (Gegencheck), "bilder" (Fotovergleich) */
  task: string;
  input: number;
  output: number;
  /** Denk-Tokens (bei Gemini extra ausgewiesen, werden wie Ausgabe berechnet) */
  thinking?: number;
  cached?: boolean;
}

export const usageFile = () => join(aiCacheDir(), 'verbrauch.jsonl');

export async function logUsage(e: Omit<UsageEntry, 'at'>) {
  if (process.env.VITEST && !process.env.SINCAPP_AI_CACHE) return;
  try {
    const f = usageFile();
    await mkdir(dirname(f), { recursive: true });
    await appendFile(f, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n');
  } catch {
    /* Protokoll ist nur Information – nie den Ablauf stören */
  }
}

export interface UsageSummary {
  month: string;
  calls: number;
  cachedCalls: number;
  input: number;
  output: number;
  thinking: number;
  byModel: Record<string, { calls: number; input: number; output: number; thinking: number }>;
  byTask: Record<string, number>;
}

/** Verbrauch eines Monats ("2026-10"; Standard: aktueller Monat). */
export async function usageSummary(month = new Date().toISOString().slice(0, 7)): Promise<UsageSummary> {
  const s: UsageSummary = { month, calls: 0, cachedCalls: 0, input: 0, output: 0, thinking: 0, byModel: {}, byTask: {} };
  const f = usageFile();
  if (!existsSync(f)) return s;
  for (const line of (await readFile(f, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    let e: UsageEntry;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e.at?.startsWith(month)) continue;
    if (e.cached) {
      s.cachedCalls++;
      continue;
    }
    s.calls++;
    s.input += e.input;
    s.output += e.output;
    s.thinking += e.thinking ?? 0;
    const m = (s.byModel[e.model] ??= { calls: 0, input: 0, output: 0, thinking: 0 });
    m.calls++;
    m.input += e.input;
    m.output += e.output;
    m.thinking += e.thinking ?? 0;
    s.byTask[e.task] = (s.byTask[e.task] ?? 0) + 1;
  }
  return s;
}
