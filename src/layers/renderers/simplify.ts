// Level-of-detail for lines: Douglas-Peucker simplification at pixel-scale tolerances, and the
// camera-height -> level mapping. Pure functions, no Cesium dependency.

/** Simplification tolerance (degrees) per level; level 0 is the full-resolution line. */
export const LOD_TOLERANCES_DEG = [0, 0.004, 0.016, 0.064, 0.256];

const METERS_PER_DEGREE = 111_320;

/** Approximate size of one screen pixel on the ground, in degrees. */
export function pixelSizeDegrees(cameraHeightM: number, fovyRad: number, viewportHeightPx: number) {
  if (viewportHeightPx <= 0) return 0;
  return (2 * cameraHeightM * Math.tan(fovyRad / 2)) / viewportHeightPx / METERS_PER_DEGREE;
}

/** Coarsest level whose tolerance stays within about one pixel. */
export function lodForPixelSize(pixelDeg: number): number {
  let level = 0;
  for (let k = 1; k < LOD_TOLERANCES_DEG.length; k++) {
    if (LOD_TOLERANCES_DEG[k] <= pixelDeg) level = k;
  }
  return level;
}

/**
 * Douglas-Peucker on the lon/lat of vertices [start, end) of `coords` (lon, lat, alt triples).
 * Longitude is scaled by cos(latitude) so the tolerance is roughly isotropic. Returns the indices
 * (relative to `start`) of the vertices to keep; the first and last are always kept.
 */
export function simplifyIndices(
  coords: Float64Array,
  start: number,
  end: number,
  toleranceDeg: number,
): number[] {
  const n = end - start;
  if (n <= 2 || toleranceDeg <= 0) return Array.from({ length: n }, (_, i) => i);

  const midLat = coords[(start + (n >> 1)) * 3 + 1];
  const kx = Math.cos((midLat * Math.PI) / 180);
  const x = (i: number) => coords[(start + i) * 3] * kx;
  const y = (i: number) => coords[(start + i) * 3 + 1];

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = toleranceDeg * toleranceDeg;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const j = stack.pop() as number;
    const i = stack.pop() as number;
    if (j <= i + 1) continue;
    const ax = x(i);
    const ay = y(i);
    const dx = x(j) - ax;
    const dy = y(j) - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD2 = tol2;
    for (let k = i + 1; k < j; k++) {
      const px = x(k) - ax;
      const py = y(k) - ay;
      // Squared distance from point k to the segment i-j.
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 > worstD2) {
        worstD2 = d2;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(i, worst, worst, j);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(k);
  return out;
}
