import type { Story } from '../../core/schema';
import type { ExtractedOffer, Extraction } from '../../extract/schema';

export type StoryOffer = Story['offers'][number];
export interface State {
  story: Story;
  extraction: Extraction | null;
  search: { brave: boolean; matcher: boolean };
}

async function call<T>(method: string, url: string, body?: unknown, raw?: Blob): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: raw ? { 'content-type': raw.type || 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {},
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

type OfferRes = { offer: ExtractedOffer; warnings?: string[] };

export const api = {
  state: () => call<State>('GET', '/api/state'),
  saveStory: (story: unknown) => call<{ story: Story }>('PUT', '/api/story', story),
  auto: (id: string) => call<OfferRes & { story: StoryOffer; notes: string[] }>('POST', `/api/offer/${id}/auto`),
  crop: (id: string, bbox: number[]) => call<OfferRes>('POST', `/api/offer/${id}/crop`, { bbox }),
  alternative: (id: string, index: number) => call<OfferRes>('POST', `/api/offer/${id}/alternative`, { index }),
  search: (id: string, query: string) => call<OfferRes & { query: string; errors: string[] }>('POST', `/api/offer/${id}/search`, { query }),
  upload: (id: string, file: File) => call<OfferRes>('POST', `/api/offer/${id}/upload`, undefined, file),
  render: () =>
    call<{ seconds: number; videos: Record<string, string>; poster: string | null; checks: { file: string; ok: boolean; problems: string[]; sizeMB: number; duration: number }[] }>('POST', '/api/render'),
};
