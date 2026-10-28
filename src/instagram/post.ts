// Ein Instagram-Beitrag (Story, Reel, Beitrag/Karussell): Daten, Prüfung und Veröffentlichen über die API.
import { z } from 'zod';
import { InstagramClient } from './graph';
import type { PublicFiles } from './host';

export const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

export const IgPost = z.object({
  id: z.string(),
  /** story und reel: genau eine Datei (mehrere Storys = mehrere Einträge, damit ein Fehler nichts doppelt postet); beitrag: 1 Datei oder Karussell (bis 10) */
  kind: z.enum(['story', 'reel', 'beitrag']),
  /** Pfade relativ zum Job-Ordner, z. B. "output/story-de.mp4" */
  files: z.array(z.string()).min(1).max(10),
  caption: z.string().max(2200).default(''),
  /** Konten, die markiert werden (ohne @) */
  tags: z.array(z.string().regex(HANDLE, 'Instagram-Name ohne @')).max(20).default([]),
  /** geplanter Zeitpunkt (ISO); beim sofortigen Teilen = Zeitpunkt des Klicks */
  at: z.string(),
  label: z.string().optional(),
  status: z.enum(['geplant', 'läuft', 'veröffentlicht', 'fehler', 'verpasst']),
  message: z.string().optional(),
  permalink: z.string().optional(),
  mediaIds: z.array(z.string()).optional(),
  createdAt: z.string(),
  publishedAt: z.string().optional(),
});
export type IgPost = z.infer<typeof IgPost>;

const isVideo = (f: string) => /\.mp4$/i.test(f);
const isImage = (f: string) => /\.(png|jpe?g)$/i.test(f);

/** Prüft, ob Instagram den Beitrag so annimmt – vorher, statt erst beim geplanten Termin zu scheitern. */
export function checkPost(p: Pick<IgPost, 'kind' | 'files' | 'caption' | 'tags'>): string | null {
  if (p.files.some((f) => !isVideo(f) && !isImage(f))) return 'Nur Videos (MP4) und Bilder (PNG/JPG) lassen sich teilen';
  if (p.kind === 'reel' && (p.files.length !== 1 || !isVideo(p.files[0]))) return 'Ein Reel ist genau ein Video';
  if (p.kind === 'beitrag' && p.files.length > 10) return 'Ein Karussell hat höchstens 10 Bilder oder Videos';
  if (p.kind === 'story' && p.files.length !== 1) return 'Eine Story ist genau ein Bild oder Video'
  const hashtags = p.caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  if (hashtags > 30) return `Instagram erlaubt höchstens 30 Hashtags (jetzt ${hashtags})`;
  const mentions = p.caption.match(/@[A-Za-z0-9._]+/g)?.length ?? 0;
  if (mentions > 20) return `Instagram erlaubt höchstens 20 @-Erwähnungen (jetzt ${mentions})`;
  return null;
}

/**
 * Bildtext mit den markierten Märkten: Wer markiert ist, steht auch als @Name im Text (dann sieht man es im Beitrag
 * und der Markt bekommt eine Benachrichtigung). Steht der Name schon drin, bleibt der Text, wie er ist.
 */
export function captionWithMentions(caption: string, tags: string[]) {
  const missing = tags.filter((t) => !new RegExp(`@${t.replace(/\./g, '\\.')}(?![A-Za-z0-9._])`, 'i').test(caption));
  if (!missing.length) return caption;
  const line = missing.map((t) => `@${t}`).join(' ');
  // vor die Hashtag-Zeile am Ende, sonst ans Ende
  const lines = caption.trimEnd().split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (/^#\S+(\s+#\S+)*$/.test(last.trim())) return [...lines.slice(0, -1), line, '', last].join('\n').replace(/\n{3,}/g, '\n\n');
  return caption.trimEnd() ? `${caption.trimEnd()}\n\n${line}` : line;
}

/** Markierungen auf einem Bild: nebeneinander im unteren Bereich, damit sie keine Preise verdecken. */
export function imageTags(tags: string[]) {
  return tags.map((username, i) => ({ username, x: Number(((i + 1) / (tags.length + 1)).toFixed(3)), y: 0.9 }));
}

/** Zugriff aufs Konto plus öffentliche Dateien – beim Test durch Attrappen ersetzbar. */
export interface PublishDeps {
  client: InstagramClient;
  igId: string;
  /** macht die (absoluten) Dateien öffentlich erreichbar */
  host: (files: string[]) => Promise<PublicFiles>;
  log: (m: string) => void;
}

/** Veröffentlicht einen Beitrag; liefert die Medien-IDs und den Link zum (ersten) Beitrag. */
export async function publishPost(post: IgPost, absFiles: string[], d: PublishDeps): Promise<{ mediaIds: string[]; permalink: string | null }> {
  const err = checkPost(post);
  if (err) throw new Error(err);
  const pub = await d.host(absFiles);
  try {
    const urls = pub.urls;
    const media = (url: string) => (/\.mp4$/i.test(url) ? { video_url: url } : { image_url: url });
    const containers: string[] = [];
    if (post.kind === 'story') {
      // Storys tragen keinen Bildtext; markieren geht ohne Position
      containers.push(await d.client.createContainer(d.igId, { media_type: 'STORIES', ...media(urls[0]), ...(post.tags.length ? { user_tags: post.tags.map((username) => ({ username })) } : {}) }));
    } else {
      const caption = captionWithMentions(post.caption, post.tags);
      if (urls.length === 1 && post.kind === 'beitrag' && !/\.mp4$/i.test(urls[0])) {
        containers.push(await d.client.createContainer(d.igId, { image_url: urls[0], caption, ...(post.tags.length ? { user_tags: imageTags(post.tags) } : {}) }));
      } else if (urls.length === 1) {
        // einzelnes Video = Reel (Instagram veröffentlicht Feed-Videos nur noch als Reel), auch im Feed sichtbar
        containers.push(await d.client.createContainer(d.igId, { media_type: 'REELS', video_url: urls[0], caption, share_to_feed: true, ...(post.tags.length ? { user_tags: post.tags.map((username) => ({ username })) } : {}) }));
      } else {
        const children: string[] = [];
        for (const url of urls) {
          const video = /\.mp4$/i.test(url);
          children.push(await d.client.createContainer(d.igId, { is_carousel_item: true, ...(video ? { media_type: 'VIDEO', video_url: url } : { image_url: url, ...(post.tags.length ? { user_tags: imageTags(post.tags) } : {}) }) }));
        }
        d.log('Instagram verarbeitet die Dateien …');
        for (const c of children) await d.client.waitFinished(c);
        containers.push(await d.client.createContainer(d.igId, { media_type: 'CAROUSEL', children: children.join(','), caption }));
      }
    }
    d.log('Instagram verarbeitet die Dateien …');
    const mediaIds: string[] = [];
    for (const c of containers) {
      await d.client.waitFinished(c);
      mediaIds.push(await d.client.publish(d.igId, c));
    }
    return { mediaIds, permalink: post.kind === 'story' ? null : await d.client.permalink(mediaIds[0]) };
  } finally {
    await pub.close();
  }
}
