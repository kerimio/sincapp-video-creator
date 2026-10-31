// Fertiges Video prüfen: erst kostenlose Regeln (story.json, Produktbilder), dann ein KI-Blick auf jede Seite und jedes Produktbild.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StoryInspector, Still } from '../ai/inspect';
import { pagesFor } from '../core/pages';
import { LAYOUTS } from '../core/layout';
import { parseStory, type Story } from '../core/schema';
import { priceValue } from '../core/format';
import { TR_MAX_CHARS } from '../extract/normalize';
import { glossaryKey } from '../core/glossary';
import { todayBerlin } from '../firestore/firestore';
import { runPython } from '../python';
import { startStaticServer } from '../server/static';
import { stillTimes } from './export';
import { launchBrowser, openStoryPage, templateMounts } from './render';

export interface Inspection {
  at: string;
  /** Modell der KI-Prüfung; null = nur Regeln (kein Key oder KI nicht erreichbar) */
  model: string | null;
  findings: { severity: 'fehler' | 'hinweis'; where: string; text: string }[];
  /** Warum die KI-Prüfung nicht lief (sonst fehlt das Feld) */
  skipped?: string;
}

/** Bilder für die KI: 512 px breit (AGENTS.md: Bilder für die KI verkleinern) */
const AI_WIDTH = 512;

const offerName = (o: Story['offers'][number]) => o.name.de.join(' ').replace(/- /g, '');

/** Seiten mit Überschrift wie in der App: "Seite 2 (Saray Market)" */
function pageLabels(story: Story) {
  return pagesFor(story, 'story').map((p, i) => `Seite ${i + 1}${p[0]?.market ? ` (${p[0].market})` : ''}`);
}

/**
 * Regeln ohne KI: was sich aus story.json sicher sagen lässt.
 * Dasselbe Produkt zweimal bei einem Markt, Bild fehlt, Preis 0, Datum vorbei oder verdreht, Markt mit sehr wenigen Angeboten.
 */
export function ruleChecks(story: Story, jobDir: string, today = todayBerlin()): Inspection['findings'] {
  const out: Inspection['findings'] = [];
  const labels = pageLabels(story);
  const pages = pagesFor(story, 'story');
  const where = (o: Story['offers'][number]) => labels[pages.findIndex((p) => p.includes(o))] ?? 'Video';
  if (story.dates.from > story.dates.to) out.push({ severity: 'fehler', where: 'Titel', text: `Zeitraum verdreht: ${story.dates.from} bis ${story.dates.to}` });
  else if (story.dates.to < today) out.push({ severity: 'hinweis', where: 'Titel', text: `Die Angebote sind schon abgelaufen (bis ${story.dates.to})` });
  const seen = new Map<string, Story['offers'][number]>();
  for (const o of story.offers) {
    const key = `${o.market ?? ''}|${o.name.de.join(' ').toLocaleLowerCase('de')}|${o.unit ? JSON.stringify(o.unit) : ''}`;
    const prev = seen.get(key);
    if (prev) out.push({ severity: 'fehler', where: where(o), text: `„${offerName(o)}“ ist zweimal drin (${prev.price} € und ${o.price} €)` });
    seen.set(key, o);
    if (!(priceValue(o.price) > 0)) out.push({ severity: 'fehler', where: where(o), text: `„${offerName(o)}“ hat keinen Preis (${o.price} €)` });
    if (!existsSync(join(jobDir, o.img.replace(/\?.*$/, '')))) out.push({ severity: 'fehler', where: where(o), text: `Bild für „${offerName(o)}“ fehlt` });
    if (o.name.tr.some((l) => l.length > TR_MAX_CHARS + 2)) out.push({ severity: 'hinweis', where: where(o), text: `Türkischer Name „${o.name.tr.join(' ')}“ ist sehr lang und wird evtl. abgeschnitten` });
  }
  out.push(...nameChecks(story, jobDir, where));
  const markets = [...new Set(story.offers.map((o) => o.market).filter((m): m is string => !!m))];
  for (const m of markets) {
    const n = story.offers.filter((o) => o.market === m).length;
    if (n < 3) out.push({ severity: 'hinweis', where: m, text: `${m} hat nur ${n} Angebot${n === 1 ? '' : 'e'} im Video` });
  }
  return out;
}

/**
 * Namen einheitlich? Dasselbe Produkt soll überall gleich heißen:
 * - gleiche Schreibweise bis auf Akzente/Großschreibung ("Mevlâna Schwarztee" / "Mevlana Schwarztee")
 * - gleicher deutscher Name, aber anderer türkischer ("Hähnchenbrustfilet": "Tavuk Göğüs" / "Tavuk Göğsü")
 * - gleiches Produktbild (Katalog) unter verschiedenen Namen ("Schwarztee" / "Ceylon Tee")
 */
export function nameChecks(story: Story, jobDir: string, where: (o: Story['offers'][number]) => string = () => 'Video'): Inspection['findings'] {
  const out: Inspection['findings'] = [];
  const de = (o: Story['offers'][number]) => offerName(o);
  const tr = (o: Story['offers'][number]) => o.name.tr.join(' ').replace(/- /g, '');
  const said = new Set<string>();
  const say = (o: Story['offers'][number], text: string) => {
    if (said.has(text)) return;
    said.add(text);
    out.push({ severity: 'hinweis', where: where(o), text });
  };
  const byKey = new Map<string, Story['offers'][number]>();
  const byDe = new Map<string, Story['offers'][number]>();
  const byImg = new Map<string, Story['offers'][number]>();
  for (const o of story.offers) {
    const k = glossaryKey(de(o));
    const a = byKey.get(k);
    if (a && de(a) !== de(o)) say(o, `„${de(a)}“ und „${de(o)}“ sind unterschiedlich geschrieben`);
    byKey.set(k, o);
    const b = byDe.get(de(o));
    if (b && glossaryKey(tr(b)) !== glossaryKey(tr(o))) say(o, `„${de(o)}“ heißt auf Türkisch einmal „${tr(b)}“ und einmal „${tr(o)}“`);
    byDe.set(de(o), o);
    const f = join(jobDir, o.img.replace(/\?.*$/, ''));
    if (!existsSync(f)) continue;
    const h = createHash('sha1').update(readFileSync(f)).digest('hex');
    const c = byImg.get(h);
    if (c && glossaryKey(de(c)) !== glossaryKey(de(o))) say(o, `Dasselbe Produktbild heißt einmal „${de(c)}“ und einmal „${de(o)}“`);
    byImg.set(h, o);
  }
  return out;
}

/** Was im Video stehen soll, als Text für die KI: je Seite die Angebote mit Namen DE/TR, Preis und Menge. */
export function storyFacts(story: Story) {
  const L = [`Markt: ${story.market.name}`, `Zeitraum: ${story.dates.from} bis ${story.dates.to}`];
  if (story.markets?.length) for (const m of story.markets) L.push(`Markt im Video: ${m.name}${m.address ? `, ${m.address}` : ''}${m.dates ? `, ${m.dates.from} bis ${m.dates.to}` : ''}`);
  const labels = pageLabels(story);
  pagesFor(story, 'story').forEach((p, i) => {
    L.push(`${labels[i]}:`);
    for (const o of p) {
      const unit = typeof o.unit === 'string' ? o.unit : o.unit ? `${o.unit.de} / ${o.unit.tr}` : '';
      L.push(`- ${offerName(o)} | TR: ${o.name.tr.join(' ')} | ${o.price} €${unit ? ` | ${unit}` : ''}`);
    }
  });
  return L.join('\n');
}

/**
 * Prüft das Video im Job: Regeln immer, die KI nur mit `inspector` (ein Aufruf für alle Seiten beider Sprachen, gemerkt).
 * Schreibt output/pruefung.json. Ein Fehler der KI bricht nichts ab – dann steht er unter `skipped`.
 */
export async function inspectStory(jobDir: string, inspector: StoryInspector | null, log: (m: string) => void = () => {}): Promise<Inspection> {
  const story = parseStory(JSON.parse(await readFile(join(jobDir, 'story.json'), 'utf8')));
  const findings = ruleChecks(story, jobDir);
  const result: Inspection = { at: new Date().toISOString(), model: null, findings };
  log('Produktbilder werden geprüft …');
  const products = await productChecks(jobDir, story, !!inspector);
  findings.push(...products.findings);
  if (!inspector) result.skipped = 'Kein KI-Key – nur nach Regeln geprüft';
  else {
    try {
      log('KI prüft das Video …');
      const stills = [...(await captureStills(jobDir, story)), ...products.previews];
      const ai = await inspector.inspect(stills, storyFacts(story), await fingerprint(jobDir, story));
      result.model = inspector.name;
      for (const f of ai) findings.push({ severity: f.severity, where: stills[f.image - 1]?.label ?? 'Video', text: f.offer && !f.text.includes(f.offer) ? `${f.offer}: ${f.text}` : f.text });
    } catch (e) {
      result.skipped = `KI-Prüfung nicht möglich: ${(e as Error).message.split('\n')[0]}`;
    }
  }
  // Fehler zuerst
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'fehler' ? -1 : 1));
  await mkdir(join(jobDir, 'output'), { recursive: true });
  await writeFile(join(jobDir, 'output', 'pruefung.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

/**
 * Jedes Produktbild einzeln (ohne KI, tools/artifacts.py): lose Flecken, Schnittkanten, Löcher, ausgefranster Rand.
 * Mit `previews` zusätzlich 256-px-Vorschauen auf grauem Grund für die KI – dort fallen Preisschild-, Schrift- und Brett-Reste auf.
 */
export async function productChecks(jobDir: string, story: Story, previews: boolean): Promise<{ findings: Inspection['findings']; previews: Still[] }> {
  const labels = pageLabels(story);
  const pages = pagesFor(story, 'story');
  // jedes Bild nur einmal (dasselbe Katalogbild kann bei zwei Märkten stehen)
  const byImg = new Map<string, Story['offers'][number]>();
  for (const o of story.offers) {
    const img = o.img.replace(/\?.*$/, '');
    if (!byImg.has(img) && existsSync(join(jobDir, img))) byImg.set(img, o);
  }
  const list = [...byImg];
  const jobs = list.map(([img], i) => ({ id: String(i), image: join(jobDir, img), ...(previews ? { preview: join(jobDir, 'work', 'pruefung', `produkt-${String(i + 1).padStart(2, '0')}.jpg`) } : {}) }));
  const out = { findings: [] as Inspection['findings'], previews: [] as Still[] };
  if (!jobs.length) return out;
  try {
    const lines = await runPython('artifacts.py', [], jobs);
    for (const line of lines) {
      const r = JSON.parse(line) as { id: string; warnings: string[] };
      const o = list[Number(r.id)][1];
      const where = labels[pages.findIndex((p) => p.includes(o))] ?? 'Video';
      for (const w of r.warnings) out.findings.push({ severity: 'hinweis', where, text: `Bild „${offerName(o)}“: ${w}` });
      const job = jobs[Number(r.id)];
      if (job.preview && existsSync(job.preview)) out.previews.push({ label: `Produktbild „${offerName(o)}“ (${where})`, file: job.preview });
    }
  } catch (e) {
    out.findings.push({ severity: 'hinweis', where: 'Video', text: `Produktbilder konnten nicht geprüft werden: ${(e as Error).message.split('\n')[0]}` });
  }
  return out;
}

/** Inhalt des Videos: story.json und alle Produktbilder – gleich → gleiches Video, die KI-Antwort darf wiederverwendet werden. */
async function fingerprint(jobDir: string, story: Story) {
  const h = createHash('sha256').update(await readFile(join(jobDir, 'story.json')));
  for (const o of story.offers) {
    const f = join(jobDir, o.img.replace(/\?.*$/, ''));
    if (existsSync(f)) h.update(await readFile(f));
  }
  return h.digest('hex');
}

/** Standbilder (Titel, jede Seite, Schluss) in allen Sprachen der Story, 512 px breit, nach work/pruefung/. */
async function captureStills(jobDir: string, story: Story): Promise<Still[]> {
  const dir = join(jobDir, 'work', 'pruefung');
  await mkdir(dir, { recursive: true });
  for (const lang of story.lang) for (let i = 1; i < 100; i++) await rm(join(dir, `${lang}-${String(i).padStart(2, '0')}.jpg`), { force: true });
  const labels = pageLabels(story);
  const stills: Still[] = [];
  const server = await startStaticServer(templateMounts(jobDir));
  const browser = await launchBrowser();
  try {
    for (const lang of story.lang) {
      const { page } = await openStoryPage(browser, server.url, lang, 'story', '', AI_WIDTH / LAYOUTS.story.W);
      for (const [i, s] of stillTimes(story, 'story').entries()) {
        await page.evaluate((tt) => window.sincapp.seek(tt), s.t);
        const name = s.name === 'Intro' ? 'Titel' : s.name === 'CTA' ? 'Schluss' : labels[Number(s.name.slice(1)) - 1] ?? s.name;
        const file = join(dir, `${lang}-${String(i + 1).padStart(2, '0')}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
        stills.push({ label: `${name} ${lang.toUpperCase()}`, file });
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return stills;
}
