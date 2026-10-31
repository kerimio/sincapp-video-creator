import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CachingInspector, type Still, type StoryInspector } from '../src/ai/inspect';
import { parseStory } from '../src/core/schema';
import { pagesFor } from '../src/core/pages';
import { inspectStory, ruleChecks, storyFacts } from '../src/render/inspect';
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
    expect(seen.map((x) => x.label)).toEqual(['DE', 'TR'].flatMap((l) => ['Titel', ...pages, 'Schluss'].map((n) => `${n} ${l}`)));
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
