import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contrast, pageMode, PRESET_DEFS, PRESETS, resolveDesign, textOn } from '../src/core/design';
import { pagesFor } from '../src/core/pages';
import { caption, cityOf } from '../src/core/captions';
import { parseStory } from '../src/core/schema';
import { writeZip } from '../src/render/zip';
import { readFileSync } from 'node:fs';

const story = parseStory(JSON.parse(readFileSync(join(__dirname, 'fixtures/reference-job/story.json'), 'utf8')));

describe('Design', () => {
  it('ohne Angabe gilt Klassik mit den Referenzfarben', () => {
    const d = resolveDesign(undefined);
    expect(d.preset).toBe('klassik');
    expect(d.colors.pages).toEqual(['#C24A18', '#292019']);
    expect(d).toMatchObject({ background: 'logo', price: 'etikett', enter: 'wischen', speed: 'normal', wobble: true, transition: 'kreis' });
  });

  it('einzelne Änderungen überschreiben das Preset', () => {
    const d = resolveDesign({ preset: 'frisch', colors: { accent: '#112233' }, price: 'flach' });
    expect(d.colors.accent).toBe('#112233');
    expect(d.colors.paper).toBe(PRESET_DEFS.frisch.colors.paper);
    expect(d.price).toBe('flach');
    expect(d.enter).toBe(PRESET_DEFS.frisch.enter);
  });

  it('Seitentyp und Schriftfarbe ergeben sich aus dem Hintergrund', () => {
    expect(pageMode('#C24A18', '#292019')).toBe('white');
    expect(pageMode('#292019', '#292019')).toBe('dark');
    expect(pageMode('#FFD31A', '#1E1A16')).toBe('light');
    expect(textOn('#E9A02A', '#292019')).toBe('#292019');
  });

  it('Preisschilder aller Vorlagen sind lesbar', () => {
    for (const k of PRESETS) {
      const c = PRESET_DEFS[k].colors;
      for (const bg of [c.accent, c.accent2]) expect(contrast(bg, textOn(bg, c.ink)), `${k} ${bg}`).toBeGreaterThan(2.5);
    }
  });
});

describe('Seiten je Format', () => {
  it('Story/Feed nach 3/2-Regel, Quadrat höchstens 2', () => {
    const s = { ...story, offers: story.offers.slice(0, 5), pages: undefined };
    expect(pagesFor(s, 'story').map((p) => p.length)).toEqual([3, 2]);
    expect(pagesFor(s, 'feed').map((p) => p.length)).toEqual([3, 2]);
    expect(pagesFor(s, 'quadrat').map((p) => p.length)).toEqual([2, 2, 1]);
  });
});

describe('Instagram-Text', () => {
  it('enthält Angebote, Datum und Hashtags in beiden Sprachen', () => {
    const de = caption(story, 'de');
    expect(de).toContain('Gültig 28.10. – 30.10.2026');
    expect(de).toMatch(/✅ .+ – \d+,\d{2} €/);
    expect(de).toContain('#sincapp');
    expect(de).toContain('#hannover');
    const tr = caption(story, 'tr');
    expect(tr).toContain('Geçerlilik');
    expect(tr).toContain('#indirim');
    expect(cityOf('Lange Laube 3, 30159 Hannover')).toBe('Hannover');
  });
});

describe('ZIP', () => {
  it('schreibt ein gültiges Archiv', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    writeFileSync(join(dir, 'a.txt'), 'Hallo sincapp\n');
    writeFileSync(join(dir, 'b.bin'), Buffer.alloc(70000, 7));
    await writeZip(join(dir, 'x.zip'), [{ name: 'a.txt', file: join(dir, 'a.txt') }, { name: 'bilder/b.bin', file: join(dir, 'b.bin') }]);
    const out = execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip(),z.namelist(),z.read("a.txt").decode())', join(dir, 'x.zip')]).toString();
    expect(out).toContain("None ['a.txt', 'bilder/b.bin'] Hallo sincapp");
  });
});

describe('Sticker und Laufband', () => {
  it('stehen im Instagram-Text', () => {
    const s = parseStory({ ...JSON.parse(readFileSync(join(__dirname, 'fixtures/reference-job/story.json'), 'utf8')), banner: { de: 'Nur bis Freitag!', tr: 'Sadece Cuma gününe kadar!' } });
    s.offers[0].badge = 'knaller';
    const de = caption(s, 'de');
    expect(de).toContain('⏰ Nur bis Freitag!');
    expect(de).toMatch(/🔥 .+ · Knaller!/);
    expect(caption(s, 'tr')).toContain('Süper fiyat!');
  });

  it('Laufband-Vorschlag nennt den letzten Tag', async () => {
    const { bannerSuggestions } = await import('../src/core/badges');
    expect(bannerSuggestions('2026-11-07')[0]).toEqual({ de: 'Nur bis Samstag!', tr: 'Sadece Cumartesi gününe kadar!' });
  });
});
