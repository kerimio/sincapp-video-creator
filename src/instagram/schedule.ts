// Geplante und geteilte Instagram-Beiträge pro Job (jobs/<id>/instagram.json) und der Taktgeber, der fällige Beiträge postet.
// Instagram selbst kann über die API nicht planen – deshalb postet die App zum Termin. Sie muss dafür laufen.
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IgPost } from './post';

/** Ist die App zum Termin aus und startet später, wird bis zu 3 Stunden nachgeholt – danach wäre z. B. die Tages-Story falsch. */
export const LATE_MS = 3 * 3600_000;

export const postsFile = (jobDir: string) => join(jobDir, 'instagram.json');

export async function readPosts(jobDir: string): Promise<IgPost[]> {
  const f = postsFile(jobDir);
  if (!existsSync(f)) return [];
  const raw = JSON.parse(await readFile(f, 'utf8')) as unknown[];
  return raw.flatMap((p) => {
    const r = IgPost.safeParse(p);
    return r.success ? [r.data] : [];
  });
}

// Schreibzugriffe pro Job nacheinander, sonst überschreibt der Taktgeber eine gleichzeitige Änderung aus der App
const queues = new Map<string, Promise<unknown>>();

/** Liest, ändert und schreibt die Liste eines Jobs (atomar über eine Zwischendatei). */
export function updatePosts<T>(jobDir: string, fn: (posts: IgPost[]) => T): Promise<T> {
  const prev = queues.get(jobDir) ?? Promise.resolve();
  const next = prev.then(async () => {
    const posts = await readPosts(jobDir);
    const r = fn(posts);
    const tmp = `${postsFile(jobDir)}.tmp`;
    await writeFile(tmp, JSON.stringify(posts, null, 2) + '\n');
    await rename(tmp, postsFile(jobDir));
    return r;
  });
  queues.set(jobDir, next.catch(() => {}));
  return next;
}

export interface SchedulerOptions {
  /** alle Job-Ordner */
  jobDirs: () => Promise<string[]>;
  publish: (jobDir: string, post: IgPost, log: (m: string) => void) => Promise<{ mediaIds: string[]; permalink: string | null }>;
  now?: () => number;
  log?: (m: string) => void;
}

export class Scheduler {
  private running = false;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  constructor(private o: SchedulerOptions) {}

  private now() {
    return this.o.now ? this.o.now() : Date.now();
  }

  /**
   * Nach einem Neustart: Beiträge, die gerade liefen, nicht automatisch neu senden – sonst stünden sie
   * vielleicht doppelt auf Instagram. Der Nutzer sieht nach und sendet bei Bedarf erneut.
   */
  async recover() {
    for (const dir of await this.o.jobDirs()) {
      if (!existsSync(postsFile(dir))) continue;
      await updatePosts(dir, (posts) => {
        for (const p of posts)
          if (p.status === 'läuft') Object.assign(p, { status: 'fehler', message: 'Die App wurde beim Teilen beendet. Bitte auf Instagram nachsehen, ob der Beitrag schon da ist – sonst „Erneut senden“.' });
      });
    }
  }

  /** Postet alle fälligen Beiträge nacheinander (ältester Termin zuerst). */
  async tick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        const due: { dir: string; post: IgPost }[] = [];
        for (const dir of await this.o.jobDirs()) {
          if (!existsSync(postsFile(dir))) continue;
          for (const post of await readPosts(dir)) if (post.status === 'geplant' && Date.parse(post.at) <= this.now()) due.push({ dir, post });
        }
        due.sort((a, b) => a.post.at.localeCompare(b.post.at));
        for (const { dir, post } of due) await this.run(dir, post);
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  private async run(dir: string, post: IgPost) {
    const set = (patch: Partial<IgPost>) => updatePosts(dir, (posts) => Object.assign(posts.find((p) => p.id === post.id) ?? {}, patch));
    if (this.now() - Date.parse(post.at) > LATE_MS) {
      await set({ status: 'verpasst', message: 'Die App war zum geplanten Zeitpunkt nicht an. Neuen Termin wählen oder jetzt senden.' });
      return;
    }
    // Ist der Beitrag inzwischen gelöscht oder geändert worden?
    const fresh = (await readPosts(dir)).find((p) => p.id === post.id);
    if (!fresh || fresh.status !== 'geplant') return;
    await set({ status: 'läuft', message: 'Wird geteilt …' });
    this.o.log?.(`Instagram: ${post.label ?? post.kind} wird geteilt`);
    try {
      const r = await this.o.publish(dir, fresh, (m) => void set({ message: m }));
      await set({ status: 'veröffentlicht', message: undefined, mediaIds: r.mediaIds, permalink: r.permalink ?? undefined, publishedAt: new Date(this.now()).toISOString() });
    } catch (e) {
      await set({ status: 'fehler', message: (e as Error).message });
    }
  }

  /** Bald prüfen (z. B. nach „Jetzt teilen“), ohne auf den nächsten Takt zu warten. */
  kick() {
    void this.tick().catch((e) => this.o.log?.(`Instagram-Planer: ${(e as Error).message}`));
  }

  start(everyMs = 30_000) {
    void this.recover().then(() => this.kick());
    this.timer = setInterval(() => this.kick(), everyMs);
    this.timer.unref();
    return () => this.stop();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
