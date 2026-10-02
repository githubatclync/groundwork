// Spatial ordering of drawable units so that each Primitive chunk covers a compact area and
// Cesium can cull whole chunks that are off screen. A unit is one point part, one line part, or
// one polygon (outer ring plus its holes), identified by its first part index. Units are sorted
// along a Hilbert curve, which (unlike Z-order) has no jumps, so a run of consecutive units stays
// spatially compact and its bounding sphere stays tight.
import { GEOM_POLY_HOLE } from '../../io/geometry';
import type { GeometryBuffer } from '../../io/geometry';

const ORDER = 14;
const SIZE = 1 << ORDER; // grid cells per axis

/** Distance along the Hilbert curve of cell (x, y) on a 2^14 x 2^14 grid (28-bit result). */
export function hilbertIndex(x: number, y: number): number {
  let d = 0;
  for (let s = SIZE >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = SIZE - 1 - x;
        y = SIZE - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return d;
}

/** Hilbert key of a lon/lat position on a 16384 x 16384 grid. */
export function lonLatKey(lon: number, lat: number): number {
  const x = Math.min(SIZE - 1, Math.max(0, Math.floor(((lon + 180) / 360) * SIZE)));
  const y = Math.min(SIZE - 1, Math.max(0, Math.floor(((lat + 90) / 180) * SIZE)));
  return hilbertIndex(x, y);
}

/** Start part index of each drawable unit, in file order. Stray holes are skipped. */
export function drawUnits(types: Uint8Array): Int32Array {
  const units = new Int32Array(types.length);
  let n = 0;
  for (let i = 0; i < types.length; i++) {
    if (types[i] !== GEOM_POLY_HOLE) units[n++] = i;
  }
  return units.subarray(0, n);
}

/** Drawable units sorted along a Hilbert curve of their first vertex. */
export function spatiallySortedUnits(g: GeometryBuffer): Int32Array {
  const units = drawUnits(g.types);
  // Pack key (28 bits) and unit index (up to 2^24) into one double so a native numeric sort works.
  const packed = new Float64Array(units.length);
  for (let u = 0; u < units.length; u++) {
    const k = g.offsets[units[u]] * 3;
    packed[u] = lonLatKey(g.coords[k], g.coords[k + 1]) * 2 ** 24 + u;
  }
  packed.sort();
  const out = new Int32Array(units.length);
  for (let u = 0; u < packed.length; u++) out[u] = units[packed[u] % 2 ** 24];
  return out;
}

/** Layers with more units than this keep file order (the index would not fit in the packed key). */
export const MAX_SORTABLE_UNITS = 2 ** 24;
