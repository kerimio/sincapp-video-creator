// Vorschläge für den Schritt „Teilen“ (läuft auch im Browser): passende Dateien je Beitragsart, Märkte zum Markieren,
// und der 7-Tage-Plan als fertige Termine.
import type { Lang, Story } from '../core/schema';
import type { ExportFile } from '../render/export';

export type PostKind = 'story' | 'reel' | 'beitrag';

export const KIND_LABEL: Record<PostKind, string> = { story: 'Story', reel: 'Reel', beitrag: 'Beitrag' };

/** Welche Export-Dateien zu einer Beitragsart passen (ohne ZIP und Texte). */
export function choices(files: ExportFile[], kind: PostKind, lang: Lang): ExportFile[] {
  const own = files.filter((f) => (f.kind === 'video' || f.kind === 'image') && (!f.lang || f.lang === lang));
  if (kind === 'reel') return own.filter((f) => f.kind === 'video');
  // Story: hochkant (9:16); Bilder gibt es meist nur in 4:5 – die zeigt Instagram mit Rand, geht also auch
  if (kind === 'story') return own.filter((f) => f.kind === 'video' ? (f.format ?? 'story') === 'story' : true);
  return own;
}

/**
 * Markt-Konten zum Markieren: bei mehreren Märkten die Märkte der gezeigten Angebote, sonst der Markt selbst.
 * `offer` (Index) schränkt auf den Markt dieses Angebots ein, z. B. beim Reel eines Tages im Plan.
 */
export function marketHandles(story: Story, offer?: number): { name: string; handle: string }[] {
  if (story.markets?.length) {
    const names = offer != null && story.offers[offer]?.market ? [story.offers[offer].market] : story.markets.map((m) => m.name);
    return story.markets.filter((m) => m.instagram && names.includes(m.name)).map((m) => ({ name: m.name, handle: m.instagram! }));
  }
  return story.market.instagram ? [{ name: story.market.name, handle: story.market.instagram }] : [];
}

/** Datum eines Plan-Ordners: "output/plan/03-freitag-31-10/reel-de.mp4" → "2026-10-31" (Jahr aus dem Gültigkeitszeitraum). */
export function planDate(path: string, from: string): string | null {
  const m = path.match(/plan\/\d+-[a-zäöüß]+-(\d{2})-(\d{2})\//);
  if (!m) return null;
  const [, dd, mm] = m;
  const y = Number(from.slice(0, 4)) + (Number(mm) < Number(from.slice(5, 7)) ? 1 : 0);
  return `${y}-${mm}-${dd}`;
}

/** Angebot aus dem Dateinamen ("reel-02-de.mp4", "angebot-02-…png" → Index 1), für Text und Markierung. */
export function fileOffer(path: string): number | undefined {
  const m = path.match(/(?:reel|angebot)-(\d+)-/);
  return m ? Number(m[1]) - 1 : undefined;
}

export interface Draft {
  kind: PostKind;
  file: string;
  /** Datum + Uhrzeit in Ortszeit, "2026-10-31T18:00" */
  local: string;
  label: string;
  /** Textdatei des Tages (für Reel und Beitrag) */
  text?: string;
  /** Angebot des Tages (Index in story.offers), für die Markierung */
  offer?: number;
}

/**
 * Der 7-Tage-Plan als Termine: pro Tag das Reel (als Reel und/oder als Story), am Ende „Letzte Chance“ als Story.
 * Tage, die schon vorbei sind, fallen weg.
 */
export function weekDrafts(files: ExportFile[], story: Story, o: { lang: Lang; time: string; reel: boolean; story: boolean; nowLocal: string }): Draft[] {
  const out: Draft[] = [];
  for (const f of files) {
    if (f.lang !== o.lang || f.kind !== 'video' || !f.day) continue;
    const date = planDate(f.path, story.dates.from);
    if (!date) continue;
    const local = `${date}T${o.time}`;
    if (local <= o.nowLocal) continue;
    const dir = f.path.slice(0, f.path.lastIndexOf('/'));
    // "plan/03-freitag-…" → 3. Tag; der Plan nimmt die Angebote der Reihe nach (siehe weekPlan)
    const offer = (Number(dir.match(/plan\/(\d+)-/)![1]) - 1) % story.offers.length;
    if (/\/reel-\w+\.mp4$/.test(f.path)) {
      if (o.reel) out.push({ kind: 'reel', file: f.path, local, label: `${f.day}: Reel`, text: `${dir}/text-${o.lang}.txt`, offer });
      if (o.story) out.push({ kind: 'story', file: f.path, local, label: `${f.day}: Story`, offer });
    } else if (/letzte-chance/.test(f.path) && o.story) {
      out.push({ kind: 'story', file: f.path, local, label: `${f.day}: Letzte Chance (Story)`, offer });
    }
  }
  return out;
}
