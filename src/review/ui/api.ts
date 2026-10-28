// Fetch-Hilfen und Typen der Web-App für die Job-API.
import type { Story } from '../../core/schema';
import type { ExtractedOffer, Extraction } from '../../extract/schema';
import type { RenderState } from '../server';
import type { ExportOptions } from '../../render/export';
import type { Design } from '../../core/design';

export type StoryOffer = Story['offers'][number];
export type { RenderState, ExportOptions };
export interface State {
  story: Story;
  extraction: Extraction | null;
  search: { brave: boolean; matcher: boolean };
  urlBase: string;
  render: RenderState;
  videos: boolean;
}

export async function call<T>(method: string, url: string, body?: unknown, raw?: Blob): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: raw ? { 'content-type': raw.type || 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {},
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data && data.error)) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

type OfferRes = { offer: ExtractedOffer; warnings?: string[] };

/** API eines Jobs; `base` z. B. "/api" (Einzel-Review) oder "/api/jobs/<id>" (App). */
export function jobClient(base: string) {
  return {
    state: () => call<State>('GET', `${base}/state`),
    saveStory: (story: unknown) => call<{ story: Story }>('PUT', `${base}/story`, story),
    auto: (id: string) => call<OfferRes & { story: StoryOffer; notes: string[] }>('POST', `${base}/offer/${id}/auto`),
    crop: (id: string, sel: { bbox: number[]; polygon?: number[][]; removeBackground?: boolean }) => call<OfferRes>('POST', `${base}/offer/${id}/crop`, sel),
    alternative: (id: string, index: number) => call<OfferRes>('POST', `${base}/offer/${id}/alternative`, { index }),
    search: (id: string, query: string) => call<OfferRes & { query: string; errors: string[] }>('POST', `${base}/offer/${id}/search`, { query }),
    upload: (id: string, file: File) => call<OfferRes>('POST', `${base}/offer/${id}/upload`, undefined, file),
    startRender: (opts: ExportOptions) => call<RenderState>('POST', `${base}/render`, opts),
    marketDesign: () => call<{ design: Design | null }>('GET', `${base}/market-design`),
    saveMarketDesign: (design: unknown) => call<{ design: Design }>('PUT', `${base}/market-design`, design),
    uploadLogo: (file: File) => call<{ story: Story }>('POST', `${base}/market-logo`, undefined, file),
    renderState: () => call<RenderState>('GET', `${base}/render`),
  };
}
export type JobClient = ReturnType<typeof jobClient>;
