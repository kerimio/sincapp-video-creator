import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';

// Kleiner ZIP-Schreiber (ohne Kompression – Videos und PNGs sind ohnehin komprimiert).

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

async function crcOf(file: string): Promise<number> {
  let c = 0xffffffff;
  for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
    for (let i = 0; i < chunk.length; i++) c = TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Schreibt `entries` (Name im ZIP → Datei) nach `out`. */
export async function writeZip(out: string, entries: { name: string; file: string }[]) {
  const ws = createWriteStream(out);
  const write = (b: Buffer) => new Promise<void>((ok, fail) => ws.write(b, (e) => (e ? fail(e) : ok())));
  const central: Buffer[] = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const e of entries) {
    const size = (await stat(e.file)).size;
    const crc = await crcOf(e.file);
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8-Namen
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    await write(local);
    await write(name);
    for await (const chunk of createReadStream(e.file) as AsyncIterable<Buffer>) await write(chunk);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(size, 20);
    cen.writeUInt32LE(size, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + size;
  }
  const cd = Buffer.concat(central);
  await write(cd);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(end);
  await new Promise<void>((ok, fail) => ws.end((e?: Error | null) => (e ? fail(e) : ok())));
}
