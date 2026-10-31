import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CachingInspector, type Still, type StoryInspector } from '../src/ai/inspect';
import { parseStory } from '../src/core/schema';
import { pagesFor } from '../src/core/pages';
import { inspectStory, productChecks, ruleChecks, storyFacts } from '../src/render/inspect';
import { pythonBin } from '../src/python';
import { imageArtifacts } from '../src/images/artifacts';
import { PNG } from 'pngjs';
import { ROOT } from '../src/paths';

const fixture = join(__dirname, 'fixtures/reference-job');
const story = () => parseStory(JSON.parse(readFileSync(join(fixture, 'story.json'), 'utf8')));

describe('Prüfung nach Regeln', () => {
  it('meldet doppelte Produkte, fehlende Bilder, abgelaufene Angebote und Märkte mit sehr wenigen Angeboten', () => {
    const s = story();
    expect(ruleChecks(s, fixture, s.dates.from)).toEqual([]);
    s.offers.push({ ...s.offers[0], price: '1,11' });
    s.offers[1] = { ...s.offers[1], img: 'images/gibt-es-nicht.png' };
    const f = ruleChecks(s, fixture, '2099-01-01');
    expect(f.map((x) => x.text).join('\n')).toMatch(/abgelaufen/);
    expect(f.find((x) => /zweimal/.test(x.text))?.severity).toBe('fehler');
    expect(f.find((x) => /Bild für/.test(x.text))?.severity).toBe('fehler');
    const m = story();
    m.offers = m.offers.map((o, i) => ({ ...o, market: i < 2 ? 'Saray Market' : 'Bizim Market' }));
    expect(ruleChecks(m, fixture, m.dates.from).map((x) => x.text)).toContain('Saray Market hat nur 2 Angebote im Video');
  });

  it('Daten für die KI: je Seite Name DE/TR, Preis und Menge', () => {
    const t = storyFacts(story());
    expect(t).toMatch(/^Markt: /);
    expect(t).toMatch(/Seite 1:\n- .+ \| TR: .+ \| \d+,\d\d €/);
  });
});

describe.skipIf(!existsSync(join(ROOT, 'dist/template/index.html')))('KI-Prüfung des fertigen Videos', () => {
  it('ein Aufruf mit allen Seiten beider Sprachen (512 px), Funde mit Seite, gemerkt, Fehler brechen nichts ab', async () => {
    const job = mkdtempSync(join(tmpdir(), 'pruefung-'));
    cpSync(fixture, job, { recursive: true });
    let calls = 0;
    let seen: Still[] = [];
    const fake: StoryInspector = {
      name: 'attrappe',
      async inspect(stills, data) {
        calls++;
        seen = stills;
        expect(data).toContain('Seite 1:');
        return [{ image: 2, offer: 'Hack', severity: 'fehler', text: 'Foto zeigt Hähnchenbrust' }];
      },
    };
    const cache = new CachingInspector(fake, join(job, 'cache'));
    const r = await inspectStory(job, cache);
    const s = story();
    const pages = pagesFor(s, 'story').map((_, i) => `Seite ${i + 1}`);
    const shots = ['DE', 'TR'].flatMap((l) => ['Titel', ...pages, 'Schluss'].map((n) => `${n} ${l}`));
    expect(seen.slice(0, shots.length).map((x) => x.label)).toEqual(shots);
    // danach jedes Produktbild einzeln (nur mit Python), jedes Bild nur einmal
    if (existsSync(pythonBin())) {
      const products = seen.slice(shots.length);
      expect(products).toHaveLength(new Set(s.offers.map((o) => o.img)).size);
      expect(products[0].label).toMatch(/^Produktbild „.+“ \(Seite 1\)$/);
    }
    // 512 px breit (JPEG-Kopf: Breite steht im SOF-Segment)
    const jpg = readFileSync(seen[0].file);
    const sof = jpg.indexOf(Buffer.from([0xff, 0xc0]));
    expect(jpg.readUInt16BE(sof + 7)).toBe(512);
    expect(r.model).toBe('attrappe');
    // Fehler zuerst, mit Seite und Produkt (die Fixture ist inzwischen abgelaufen: Hinweis aus den Regeln)
    expect(r.findings[0]).toEqual({ severity: 'fehler', where: 'Seite 1 DE', text: 'Hack: Foto zeigt Hähnchenbrust' });
    expect(JSON.parse(readFileSync(join(job, 'output/pruefung.json'), 'utf8')).findings).toEqual(r.findings);
    // gleiches Video noch einmal: aus dem Speicher, kein zweiter Aufruf
    await inspectStory(job, cache);
    expect(calls).toBe(1);
    // KI nicht erreichbar: Regeln trotzdem, Grund steht dabei
    const broken = await inspectStory(job, { name: 'kaputt', inspect: async () => { throw new Error('Gemini: Tageskontingent aufgebraucht'); } });
    expect(broken.model).toBeNull();
    expect(broken.skipped).toMatch(/Tageskontingent/);
    expect((await inspectStory(job, null)).skipped).toMatch(/Kein KI-Key/);
  }, 120000);
});

describe.skipIf(!existsSync(pythonBin()))('Artefakte in Produktbildern', () => {
  it('findet lose Flecken, Schnittkanten und Löcher; Fotos mit Hintergrund lässt es in Ruhe', async () => {
    const job = mkdtempSync(join(tmpdir(), 'artefakte-'));
    cpSync(fixture, job, { recursive: true });
    // 200×200: Packung in der Mitte mit Loch, ein Fleck in der Ecke, links bis an den Rand (abgeschnitten)
    const png = new PNG({ width: 200, height: 200 });
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++) {
        const i = (y * 200 + x) * 4;
        const pack = x < 150 && y > 20 && y < 180 && !(x > 60 && x < 90 && y > 80 && y < 110);
        const speck = x > 185 && x < 195 && y > 5 && y < 15;
        png.data.set([200, 40, 30, pack || speck ? 255 : 0], i);
      }
    writeFileSync(join(job, 'images/kaputt.png'), PNG.sync.write(png));
    const s = story();
    s.offers[0] = { ...s.offers[0], img: 'images/kaputt.png' };
    const r = await productChecks(job, s, true);
    const texts = r.findings.map((f) => f.text).join('\n');
    expect(texts).toMatch(/1 loser Fleck/);
    expect(texts).toMatch(/Schnittkante links/);
    expect(texts).toMatch(/1 Loch/);
    expect(r.findings.every((f) => f.text.startsWith(`Bild „${s.offers[0].name.de.join(' ').replace(/- /g, '')}“`))).toBe(true);
    // dieselbe Prüfung läuft schon beim Erstellen und nach jedem Bildwechsel im Prüfen-Schritt
    const early = await imageArtifacts([join(job, 'images/kaputt.png'), join(job, s.offers[1].img)]);
    expect(early[0].join('\n')).toMatch(/loser Fleck/);
    expect(early[1]).toEqual([]);
    // die Fleisch-Fotos der Fixture (mit Hintergrund) sind unauffällig, Vorschauen für die KI gibt es für alle
    expect(r.previews).toHaveLength(new Set(s.offers.map((o) => o.img)).size);
  }, 60000);
});
