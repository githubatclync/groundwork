import { describe, expect, it } from 'vitest';
import { LOD_TOLERANCES_DEG, lodForPixelSize, pixelSizeDegrees, simplifyIndices } from './simplify';

const line = (pts: [number, number][]) => Float64Array.from(pts.flatMap(([x, y]) => [x, y, 0]));

describe('simplifyIndices', () => {
  it('collapses a straight line to its endpoints', () => {
    const c = line([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
    expect(simplifyIndices(c, 0, 5, 0.1)).toEqual([0, 4]);
  });

  it('keeps vertices that deviate more than the tolerance', () => {
    const c = line([
      [0, 0],
      [1, 0.5],
      [2, 0],
    ]);
    expect(simplifyIndices(c, 0, 3, 0.1)).toEqual([0, 1, 2]);
    expect(simplifyIndices(c, 0, 3, 1)).toEqual([0, 2]);
  });

  it('keeps everything at tolerance 0 and for 2-point lines', () => {
    const c = line([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(simplifyIndices(c, 0, 3, 0)).toEqual([0, 1, 2]);
    expect(simplifyIndices(c, 0, 2, 5)).toEqual([0, 1]);
  });

  it('works on a sub-range and returns indices relative to its start', () => {
    const c = line([
      [9, 9],
      [0, 0],
      [1, 0],
      [2, 0],
      [8, 8],
    ]);
    expect(simplifyIndices(c, 1, 4, 0.1)).toEqual([0, 2]);
  });

  it('handles a closed loop (first == last) without dropping its shape', () => {
    const c = line([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
    const kept = simplifyIndices(c, 0, 5, 0.5);
    expect(kept.length).toBeGreaterThanOrEqual(3);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(4);
  });
});

describe('level of detail', () => {
  it('maps pixel size to the coarsest level within about a pixel', () => {
    expect(lodForPixelSize(0)).toBe(0);
    expect(lodForPixelSize(LOD_TOLERANCES_DEG[1] - 1e-9)).toBe(0);
    expect(lodForPixelSize(LOD_TOLERANCES_DEG[1])).toBe(1);
    expect(lodForPixelSize(LOD_TOLERANCES_DEG[3] * 1.5)).toBe(3);
    expect(lodForPixelSize(100)).toBe(LOD_TOLERANCES_DEG.length - 1);
  });

  it('computes ground pixel size from camera height', () => {
    // 1000 km up, 60 degree vertical FOV, 1000 px tall viewport: ~1.15 km per pixel.
    const px = pixelSizeDegrees(1_000_000, Math.PI / 3, 1000);
    expect(px * 111_320).toBeCloseTo(1154.7, 0);
    expect(pixelSizeDegrees(1000, 1, 0)).toBe(0);
  });
});
