import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../paths';
import type { JobSettings } from './pipeline';

export function jobsDir() {
  return process.env.SINCAPP_JOBS || join(ROOT, 'jobs');
}

export interface JobMeta {
  id: string;
  title: string;
  createdAt: string;
  settings: JobSettings;
  /** Herkunft, wenn der Prospekt aus Firestore kam */
  source?: { firestoreProspect: string; firestoreProspects?: string[]; marketId: string };
}

export interface JobSummary extends JobMeta {
  inputs: number;
  hasStory: boolean;
  offers: number;
  videos: string[];
  poster: string | null;
  dates: { from: string; to: string } | null;
}

const ID = /^[a-z0-9][a-z0-9-]{2,80}$/;
export const validJobId = (id: string) => ID.test(id);

export function jobPath(id: string) {
  if (!validJobId(id)) throw new Error('Ungültige Job-ID');
  return join(jobsDir(), id);
}

export async function createJob(settings: JobSettings, title?: string): Promise<JobMeta> {
  const day = new Date().toISOString().slice(0, 10);
  const slug = `${day}-${settings.market}${settings.topic ? `-${settings.topic}` : ''}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  let id = slug;
  for (let n = 2; existsSync(join(jobsDir(), id)); n++) id = `${slug}-${n}`;
  const meta: JobMeta = { id, title: title || id, createdAt: new Date().toISOString(), settings };
  await mkdir(join(jobsDir(), id, 'input'), { recursive: true });
  await writeFile(join(jobsDir(), id, 'job.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

export async function readJob(id: string): Promise<JobMeta> {
  const f = join(jobPath(id), 'job.json');
  if (existsSync(f)) return JSON.parse(await readFile(f, 'utf8'));
  // Ordner ohne job.json (z. B. per CLI angelegt)
  const s = await stat(jobPath(id));
  return { id, title: id, createdAt: s.birthtime.toISOString(), settings: { market: '' } };
}

export async function saveJob(meta: JobMeta) {
  await writeFile(join(jobPath(meta.id), 'job.json'), JSON.stringify(meta, null, 2) + '\n');
}

export async function summarize(id: string): Promise<JobSummary> {
  const dir = jobPath(id);
  const meta = await readJob(id);
  const inputs = existsSync(join(dir, 'input')) ? (await readdir(join(dir, 'input'))).filter((f) => !f.startsWith('.')).length : 0;
  let offers = 0;
  let dates = null;
  const hasStory = existsSync(join(dir, 'story.json'));
  if (hasStory) {
    try {
      const s = JSON.parse(await readFile(join(dir, 'story.json'), 'utf8'));
      offers = s.offers?.length ?? 0;
      dates = s.dates ?? null;
    } catch {
      /* kaputte Datei: als leer zeigen */
    }
  }
  const videos = ['de', 'tr'].filter((l) => existsSync(join(dir, `output/story-${l}.mp4`)));
  return { ...meta, inputs, hasStory, offers, dates, videos, poster: existsSync(join(dir, 'output/preview.png')) ? `/jobs/${id}/output/preview.png` : null };
}

export async function listJobs(): Promise<JobSummary[]> {
  if (!existsSync(jobsDir())) return [];
  const ids = (await readdir(jobsDir(), { withFileTypes: true })).filter((d) => d.isDirectory() && validJobId(d.name)).map((d) => d.name);
  const all = await Promise.all(ids.map((id) => summarize(id).catch(() => null)));
  return all.filter((j): j is JobSummary => !!j).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Dateiname für Uploads: nur sichere Zeichen, Endung behalten. */
export function safeName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? 'datei';
  const m = base.match(/^(.*?)(\.[A-Za-z0-9]{1,5})?$/)!;
  const stem = (m[1] || 'datei').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'datei';
  return `${stem}${(m[2] ?? '').toLowerCase()}`;
}
