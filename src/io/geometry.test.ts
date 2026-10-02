import { describe, expect, it } from 'vitest';
import { GEOM_LINE, GEOM_POINT, HEADER_BYTES, MAGIC, decodeGeometry } from './geometry';

interface Part {
  type: number;
  flags: number;
  feature: number;
  folder: number;
  style: number;
  coords: number[];
}

/** Builds a buffer exactly as src-tauri/src/binary.rs lays it out. */
function encode(parts: Part[], featureCount: number): ArrayBuffer {
  const verts = parts.reduce((n, p) => n + p.coords.length / 3, 0);
  const n = parts.length;
  const buf = new ArrayBuffer(HEADER_BYTES + verts * 24 + (n + 1) * 4 + n * 12 + n * 2);
  const dv = new DataView(buf);
  [MAGIC, 1, n, verts, featureCount].forEach((v, i) => dv.setUint32(i * 4, v, true));
  let o = HEADER_BYTES;
  for (const p of parts) {
    for (const c of p.coords) {
      dv.setFloat64(o, c, true);
      o += 8;
    }
  }
  let v = 0;
  for (const p of parts) {
    dv.setUint32(o, v, true);
    o += 4;
    v += p.coords.length / 3;
  }
  dv.setUint32(o, v, true);
  o += 4;
  for (const key of ['feature', 'folder', 'style'] as const) {
    for (const p of parts) {
      dv.setUint32(o, p[key], true);
      o += 4;
    }
  }
  for (const p of parts) dv.setUint8(o++, p.type);
  for (const p of parts) dv.setUint8(o++, p.flags);
  return buf;
}

describe('decodeGeometry', () => {
  const parts: Part[] = [
    { type: GEOM_POINT, flags: 2, feature: 0, folder: 0, style: 1, coords: [10, 20, 30] },
    {
      type: GEOM_LINE,
      flags: 0b1001,
      feature: 1,
      folder: 2,
      style: 0,
      coords: [0, 0, 0, 1, 1, 1, 2, 2, 2],
    },
  ];

  it('decodes every section', () => {
    const g = decodeGeometry(encode(parts, 2));
    expect([g.partCount, g.vertexCount, g.featureCount]).toEqual([2, 4, 2]);
    expect(Array.from(g.coords.slice(0, 3))).toEqual([10, 20, 30]);
    expect(Array.from(g.offsets)).toEqual([0, 1, 4]);
    expect(Array.from(g.featureIds)).toEqual([0, 1]);
    expect(Array.from(g.folderIds)).toEqual([0, 2]);
    expect(Array.from(g.styleIds)).toEqual([1, 0]);
    expect(Array.from(g.types)).toEqual([GEOM_POINT, GEOM_LINE]);
    expect(Array.from(g.flags)).toEqual([2, 0b1001]);
  });

  it('handles an empty layer', () => {
    const g = decodeGeometry(encode([], 0));
    expect(g.partCount).toBe(0);
    expect(Array.from(g.offsets)).toEqual([0]);
  });

  it('rejects bad signatures, versions, and sizes', () => {
    const good = encode(parts, 2);
    const bad = good.slice(0);
    new DataView(bad).setUint32(0, 0, true);
    expect(() => decodeGeometry(bad)).toThrow(/signature/);
    const v2 = good.slice(0);
    new DataView(v2).setUint32(4, 2, true);
    expect(() => decodeGeometry(v2)).toThrow(/version/);
    expect(() => decodeGeometry(good.slice(0, good.byteLength - 1))).toThrow(/expected/);
    expect(() => decodeGeometry(new ArrayBuffer(4))).toThrow(/small/);
  });
});
