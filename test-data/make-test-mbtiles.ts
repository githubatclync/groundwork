// Generates test-data/test-tiles.mbtiles: zoom 0-3 raster PNG tiles, each labelled by a coloured
// pattern that makes the TMS y-flip visible (the tile's top-left corner is white, and colour
// varies with x and y). Run with: node test-data/make-test-mbtiles.ts
import { DatabaseSync } from 'node:sqlite';
import { crc32, deflateSync } from 'node:zlib';
import { rmSync } from 'node:fs';

const SIZE = 256;

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(z: number, x: number, y: number): Buffer {
  const n = 2 ** z;
  const r = Math.round((x / Math.max(1, n - 1)) * 200) + 30;
  const g = Math.round((y / Math.max(1, n - 1)) * 200) + 30;
  const b = 120;
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  for (let row = 0; row < SIZE; row++) {
    const o = row * (SIZE * 3 + 1);
    for (let col = 0; col < SIZE; col++) {
      const edge = row < 3 || col < 3;
      const corner = row < 48 && col < 48;
      const px = corner ? [255, 255, 255] : edge ? [0, 0, 0] : [r, g, b];
      raw[o + 1 + col * 3] = px[0];
      raw[o + 2 + col * 3] = px[1];
      raw[o + 3 + col * 3] = px[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('./test-tiles.mbtiles', import.meta.url);
rmSync(out, { force: true });
const db = new DatabaseSync(out);
db.exec(`CREATE TABLE metadata (name TEXT, value TEXT);
CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);`);
const meta = db.prepare('INSERT INTO metadata VALUES (?, ?)');
for (const [k, v] of Object.entries({
  name: 'Groundwork test tiles',
  format: 'png',
  minzoom: '0',
  maxzoom: '3',
  attribution: 'Groundwork test tiles (synthetic)',
})) {
  meta.run(k, v);
}
const ins = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
for (let z = 0; z <= 3; z++) {
  for (let x = 0; x < 2 ** z; x++) {
    for (let y = 0; y < 2 ** z; y++) {
      ins.run(z, x, 2 ** z - 1 - y, png(z, x, y)); // store at the TMS row
    }
  }
}
db.close();
console.log('wrote', out.pathname);
