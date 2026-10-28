// Wochen-Autopilot: neue Prospekte der gewählten Märkte selbst erkennen, damit Videos und Texte ohne Klicken bereitliegen.
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FsProspect } from '../firestore/firestore';
import { jobsDir } from './jobs';

export interface AutopilotState {
  /** Firestore-IDs der Märkte, für die der Autopilot läuft (leer = aus) */
  markets: string[];
  /** true: nach dem Auslesen gleich alle Videos, Reels und Bilder erstellen (wie der Zauberknopf) */
  render: boolean;
  /** "<marketId>/<prospectId>", schon erledigt – wird nie zweimal gelesen, auch wenn der Job gelöscht wurde */
  done: string[];
  lastCheck?: string;
  lastError?: string;
}

const EMPTY: AutopilotState = { markets: [], render: true, done: [] };
const file = () => join(jobsDir(), 'autopilot.json');

export async function readAutopilot(): Promise<AutopilotState> {
  if (!existsSync(file())) return { ...EMPTY, done: [] };
  try {
    return { ...EMPTY, ...JSON.parse(await readFile(file(), 'utf8')) };
  } catch {
    return { ...EMPTY, done: [] };
  }
}

export async function saveAutopilot(s: AutopilotState) {
  // "done" begrenzen: Prospekte sind nach ein paar Wochen abgelaufen und tauchen nicht mehr auf
  await writeFile(file(), JSON.stringify({ ...s, done: s.done.slice(-500) }, null, 2) + '\n');
}

export const doneKey = (marketId: string, prospectId: string) => `${marketId}/${prospectId}`;

/**
 * Was ist neu? Pro gewähltem Markt jeder noch gültige Prospekt, der weder erledigt ist noch schon
 * in einem Job steckt (z. B. von Hand angelegt). Prospekte, die erst in mehr als 7 Tagen starten,
 * warten noch – sonst stünden Videos für übernächste Woche zwischen den aktuellen.
 */
export function dueProspects(
  s: Pick<AutopilotState, 'markets' | 'done'>,
  prospects: FsProspect[],
  jobSources: { marketId: string; prospects: string[] }[],
  today: string,
): { marketId: string; prospect: FsProspect }[] {
  const inJob = new Set(jobSources.flatMap((j) => j.prospects.map((p) => doneKey(j.marketId, p))));
  const done = new Set(s.done);
  const soon = addDays(today, 7);
  const out: { marketId: string; prospect: FsProspect }[] = [];
  for (const marketId of s.markets)
    for (const pr of prospects) {
      if (!pr.marketIds.includes(marketId) || pr.validUntil < today || (pr.validFrom && pr.validFrom > soon)) continue;
      const key = doneKey(marketId, pr.id);
      if (!done.has(key) && !inJob.has(key)) out.push({ marketId, prospect: pr });
    }
  // frühester Start zuerst: was am nächsten Montag gilt, ist zuerst fertig
  return out.sort((a, b) => a.prospect.validFrom.localeCompare(b.prospect.validFrom));
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
