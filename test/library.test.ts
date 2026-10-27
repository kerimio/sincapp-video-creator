import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Library, productKey } from '../src/library/library';

const png = () => {
  const f = join(mkdtempSync(join(tmpdir(), 'lib-src-')), 'x.png');
  writeFileSync(f, 'png');
  return f;
};

describe('Produkt-Bibliothek', () => {
  it('Schlüssel ignoriert Akzente, Groß/klein und Satzzeichen', () => {
    expect(productKey('Egetürk', 'Sırma Knoblauchwurst')).toBe(productKey('EGETURK', 'sirma knoblauch wurst'.replace(' wurst', 'wurst')));
  });

  it('findet gespeicherte Produkte wieder, auch über den türkischen Namen und nach dem Neuladen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lib-'));
    const lib = await Library.open(dir);
    await lib.put({ brand: 'Egetürk', name: { de: 'Sırma Knoblauchwurst', tr: 'Sırma Parmak Sucuk' }, unit: '1 kg' }, png(), { type: 'web', url: 'https://x/y.jpg' }, true);
    await lib.save();
    const again = await Library.open(dir);
    expect(again.find({ brand: 'EGETÜRK', name: { de: 'Sirma Knoblauchwurst' }, unit: '1kg' })?.source.url).toBe('https://x/y.jpg');
    expect(again.find({ brand: 'Egetürk', name: { de: 'Wurst', tr: 'Sırma Parmak Sucuk' } })).not.toBeNull();
    // ähnlicher Name, gleiche Marke
    expect(again.find({ brand: 'Egetürk', name: { de: 'Sırma Knoblauchwurst Parmak' } })).not.toBeNull();
  });

  it('unterscheidet Marken und Packungsgrößen', async () => {
    const lib = await Library.open(mkdtempSync(join(tmpdir(), 'lib-')));
    await lib.put({ brand: 'Tat', name: { de: 'Kichererbsen' }, unit: '1 kg' }, png(), { type: 'web' }, true);
    expect(lib.find({ brand: 'Dere', name: { de: 'Kichererbsen' }, unit: '1 kg' })).toBeNull();
    expect(lib.find({ brand: 'Tat', name: { de: 'Kichererbsen' }, unit: '2,5 kg' })).toBeNull();
    expect(lib.find({ brand: 'Tat', name: { de: 'Kichererbsen' } })).not.toBeNull();
  });

  it('ersetzt statt zu verdoppeln und zählt Nutzungen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lib-'));
    const lib = await Library.open(dir);
    const q = { brand: 'Durra', name: { de: 'Tahin' }, unit: '800 g' };
    await lib.put(q, png(), { type: 'prospekt' }, false);
    const e = await lib.put(q, png(), { type: 'manual' }, true);
    expect(lib.entries).toHaveLength(1);
    expect(e.verified).toBe(true);
    await lib.use(e, join(mkdtempSync(join(tmpdir(), 'dst-')), 'o.png'));
    expect(e.uses).toBe(1);
  });
});
