import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { pythonBin, runPython } from '../src/python';

const hasPython = existsSync(pythonBin()) || pythonBin() === 'python3';

/** Shopfoto: weißer Hintergrund, rote Packung mit weißem Etikett mitten auf der Packung. */
function shopPhoto(file: string) {
  const png = new PNG({ width: 400, height: 500 });
  for (let y = 0; y < 500; y++)
    for (let x = 0; x < 400; x++) {
      const i = (y * 400 + x) * 4;
      const inPack = x >= 100 && x < 300 && y >= 80 && y < 420;
      const c = !inPack ? [255, 255, 255] : [200, 30, 30];
      const label2 = inPack && x >= 140 && x < 260 && y >= 300 && y < 360;
      png.data.set(label2 ? [250, 250, 250, 255] : [...c, 255], i);
    }
  writeFileSync(file, PNG.sync.write(png));
}

describe.skipIf(!hasPython)('Freisteller für Internet-Fotos', () => {
  it('nimmt bei einfarbigem Hintergrund nur den Hintergrund weg, die Packung bleibt ganz', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bg-'));
    shopPhoto(join(dir, 'web.png'));
    const [line] = await runPython('cutout.py', [], [{ image: join(dir, 'web.png'), bbox: null, out: join(dir, 'out.png') }]);
    const r = JSON.parse(line);
    expect(r.model).toBe('hintergrund');
    const out = PNG.sync.read(readFileSync(join(dir, 'out.png')));
    expect(out.width).toBeGreaterThanOrEqual(200);
    expect(out.height).toBeGreaterThanOrEqual(340);
    const alphaAt = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3];
    // weißes Innen-Etikett bleibt deckend
    expect(alphaAt(Math.round(out.width / 2), Math.round(out.height * 0.72))).toBe(255);
    expect(r.coverage).toBeGreaterThan(0.8);
  }, 60_000);
});
