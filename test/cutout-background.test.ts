import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { pythonBin, runPython } from '../src/python';
import { hasAlpha } from '../src/images/resolve';

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

  it('behält frisches Fleisch als Foto: kein Freisteller, Zuschnitt auf höchstens 4:3, ohne Alphakanal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foto-'));
    // Fleisch auf einem gemaserten Brett – kein einfarbiger Hintergrund
    const png = new PNG({ width: 800, height: 400 });
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 800; x++) {
        const meat = (x - 400) ** 2 + (y - 200) ** 2 < 120 ** 2;
        const wood = 140 + Math.round(30 * Math.sin(x / 9 + y / 31));
        png.data.set(meat ? [190, 50, 60, 255] : [wood, Math.round(wood * 0.7), Math.round(wood * 0.4), 255], (y * 800 + x) * 4);
      }
    writeFileSync(join(dir, 'web.png'), PNG.sync.write(png));
    const out = join(dir, 'out.png');
    const [line] = await runPython('cutout.py', [], [{ image: join(dir, 'web.png'), bbox: null, out, photo: true }]);
    const r = JSON.parse(line);
    expect(r).toMatchObject({ ok: true, model: 'foto', width: 533, height: 400 });
    expect(await hasAlpha(out)).toBe(false);
    expect(await hasAlpha(join(dir, 'web.png'))).toBe(true);
  }, 60_000);
});
