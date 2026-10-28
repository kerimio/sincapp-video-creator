import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import './fonts.css';
import { parseStory, type Lang, type Story } from '../core/schema';
import { buildScenes, deriveTimeline, storyDurations, warp, type Timeline } from '../core/timeline';
import { pagesFor } from '../core/pages';
import { resolveDesign, SPEED_FACTOR } from '../core/design';
import { LAYOUTS, type Format } from '../core/layout';
import { OfferPost, OfferReel, REEL_DURATION, StoryView, type Urls } from './Story';

// Seiten-API für Renderer und Review-UI:
//   await window.sincapp.ready  → { duration, fps }
//   window.sincapp.seek(t)      → rendert synchron den Frame bei t Sekunden
//   window.sincapp.setStory(json) → neue Daten (Live-Vorschau)
declare global {
  interface Window {
    sincapp: {
      ready: Promise<{ duration: number }>;
      seek: (t: number) => void;
      setStory: (data: unknown) => Promise<{ duration: number }>;
      error?: string;
    };
  }
}

const params = new URLSearchParams(location.search);
const lang = (params.get('lang') === 'tr' ? 'tr' : 'de') as Lang;
const format = (params.get('format') && params.get('format')! in LAYOUTS ? params.get('format') : 'story') as Format;
const view = params.get('view');
const offerIndex = view === 'offer' || view === 'reel' ? Number(params.get('offer') ?? 0) : null;
const storyUrl = params.get('story') ?? '/job/story.json';
const jobBase = storyUrl.slice(0, storyUrl.lastIndexOf('/') + 1);

const urls: Urls = {
  job: (p) => (/^(https?:|data:|\/)/.test(p) ? p : jobBase + p),
  market: (p) => `/markets/${p}`,
  asset: (p) => `/assets/${p}`,
};

const root = createRoot(document.getElementById('root')!);
let state: { story: Story; tl: Timeline; logoSize: { w: number; h: number } } | null = null;
let t = 0;

function draw() {
  if (!state) return;
  const T = warp(state.tl, t);
  flushSync(() => {
    root.render(
      view === 'reel' ? (
        <OfferReel story={state!.story} lang={lang} index={offerIndex ?? 0} T={t} logoSize={state!.logoSize} urls={urls} />
      ) : offerIndex !== null ? (
        <OfferPost story={state!.story} lang={lang} format={format} index={offerIndex} logoSize={state!.logoSize} urls={urls} />
      ) : (
        <StoryView story={state!.story} lang={lang} format={format} T={T} cues={state!.tl.cues} logoSize={state!.logoSize} urls={urls} />
      ),
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Bild nicht ladbar: ${src}`));
    img.src = src;
  });
}

async function load(data: unknown) {
  const story = parseStory(data);
  const pages = pagesFor(story, format);
  const speed = SPEED_FACTOR[resolveDesign(story.design).speed];
  const tl = deriveTimeline(buildScenes(pages.length, storyDurations(story.scenes, speed)));
  const logo = await loadImage(urls.market(story.market.logo));
  // Alle Fontschnitte laden, bevor der erste Frame entsteht (kein Fallback-Font).
  const sample = 'AÄÖÜßÇĞİŞ€0123456789 aäöüçğışü';
  await Promise.all([500, 600, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px Archivo`, sample)));
  await document.fonts.ready;
  if (!document.fonts.check('900 40px Archivo', sample)) throw new Error('Font Archivo nicht geladen');
  state = { story, tl, logoSize: { w: logo.naturalWidth, h: logo.naturalHeight } };
  draw();
  // Alle Bilder sind ab dem ersten Frame gemountet; warten, bis sie dekodiert sind.
  const imgs = [...document.images];
  await Promise.all(imgs.map((i) => (i.complete && i.naturalWidth ? i.decode() : new Promise((res, rej) => { i.onload = () => i.decode().then(res, rej); i.onerror = () => rej(new Error(`Bild nicht ladbar: ${i.src}`)); }))));
  return { duration: view === 'reel' ? REEL_DURATION : tl.total };
}

window.sincapp = {
  ready: fetch(storyUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`story.json nicht gefunden (${storyUrl})`);
      return r.json();
    })
    .then(load)
    .catch((e) => {
      window.sincapp.error = String(e?.message ?? e);
      throw e;
    }),
  seek(time: number) {
    t = time;
    draw();
  },
  setStory(data: unknown) {
    return load(data);
  },
};
