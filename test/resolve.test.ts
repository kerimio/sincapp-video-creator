import { existsSync, mkdirSync, mkdtempSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { normalizePage } from '../src/extract/extract';
import { PageResult } from '../src/extract/schema';
import { resolveImages } from '../src/images/resolve';
import type { ImageSearchProvider } from '../src/images/search';
import { Library } from '../src/library/library';
import { pythonBin } from '../src/python';

const ROOT = join(__dirname, '..');
const hasPython = existsSync(pythonBin()) || pythonBin() === 'python3';

/** Produktfoto mit transparentem Rand, wie es Shops oft liefern. */
function transparentProduct() {
  const p = new PNG({ width: 200, height: 260 });
  for (let y = 0; y < 260; y++)
    for (let x = 0; x < 200; x++) {
      const i = (y * 200 + x) * 4;
      const inside = x > 30 && x < 170 && y > 20 && y < 240;
      p.data[i] = 150 + ((x * 7 + y * 13) % 90); p.data[i + 1] = (x * y) % 60; p.data[i + 2] = 40; p.data[i + 3] = inside ? 255 : 0;
    }
  return PNG.sync.write(p);
}

function job() {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
  mkdirSync(join(dir, 'work/pages'), { recursive: true });
  const offers = [3, 4].flatMap((n) => {
    copyFileSync(join(ROOT, `reference/samples/saray-2026-10-28/seite-${n}.png`), join(dir, `work/pages/seite-${n}.png`));
    const raw = PageResult.parse(JSON.parse(readFileSync(join(ROOT, `test/fixtures/saray-extraction/seite-${n}.json`), 'utf8')));
    return normalizePage(raw, { source: '', page: 1, file: join(dir, `work/pages/seite-${n}.png`), width: 1200, height: 1500 }, n, dir);
  });
  return { dir, offers: offers.filter((o) => o.id === 's3-1' || o.id === 's4-1') };
}

describe.skipIf(!hasPython)('Bildquelle: Bibliothek → Internet → Prospekt', () => {
  it('nimmt Bibliothek, sonst bestätigtes Internet-Bild, und merkt es sich', async () => {
    const { dir, offers } = job();
    const lib = await Library.open(mkdtempSync(join(tmpdir(), 'lib-')));
    const src = join(dir, 'tahin.png');
    writeFileSync(src, transparentProduct());
    await lib.put({ brand: 'Durra', name: { de: 'Tahin' }, unit: '800 g' }, src, { type: 'manual' }, true);

    const provider: ImageSearchProvider = { name: 'brave', search: async () => [{ url: 'https://img/tee.png', title: 'Tanay Yakut', provider: 'brave' }] };
    const fetchImpl = (async () => new Response(new Uint8Array(transparentProduct()), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
    const compared: string[] = [];
    const matcher = {
      compare: async (crop: string, cands: string[], product: string) => {
        compared.push(product);
        expect(existsSync(crop)).toBe(true);
        return cands.map((_, i) => ({ id: i + 1, same_product: true, same_variant: true, clean_shot: true, note: 'passt' }));
      },
    };
    await resolveImages(offers, { jobDir: dir, library: lib, providers: [provider], matcher, fetchImpl });

    const tahin = offers.find((o) => o.id === 's3-1')!;
    const tee = offers.find((o) => o.id === 's4-1')!;
    expect(tahin.imgSource).toBe('library');
    expect(tee.imgSource).toBe('web');
    expect(compared).toEqual(['Tanay Yakut Ceylon-Schwarztee 800 g']);
    expect(existsSync(join(dir, 'images/s4-1.png'))).toBe(true);
    expect(tee.imgAlternatives?.[0]).toMatchObject({ source: 'brave', match: true });
    // jetzt auch in der Bibliothek
    expect(lib.find({ brand: 'Tanay', name: { de: 'Yakut Ceylon-Schwarztee' }, unit: '800 g' })?.verified).toBe(true);
  }, 120000);

  it('Prospekt-Bild im Katalog: einmal im Internet suchen, danach nicht bei jedem Video', async () => {
    const { dir, offers } = job();
    const tahin = offers.filter((o) => o.id === 's3-1');
    const lib = await Library.open(mkdtempSync(join(tmpdir(), 'lib-')));
    const src = join(dir, 'tahin.png');
    writeFileSync(src, transparentProduct());
    await lib.put({ brand: 'Durra', name: { de: 'Tahin' }, unit: '800 g' }, src, { type: 'prospekt' }, false);

    let searches = 0;
    const provider: ImageSearchProvider = { name: 'brave', search: async () => (searches++, []) };
    await resolveImages(tahin, { jobDir: dir, library: lib, providers: [provider], matcher: null });
    expect(searches).toBe(1);
    expect(tahin[0].imgSource).toBe('library');
    expect(lib.entries[0].webTried).toBeTruthy();

    tahin[0].img = undefined;
    tahin[0].imgSource = undefined;
    await resolveImages(tahin, { jobDir: dir, library: lib, providers: [provider], matcher: null });
    expect(searches).toBe(1);
    expect(tahin[0].imgSource).toBe('library');
  }, 120000);
});
