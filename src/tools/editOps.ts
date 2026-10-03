// Pure vertex-editing operations on user features: move, insert, delete, and the midpoint handles
// used to insert vertices. Rings are addressed by index: 0 is the line / polygon outer ring,
// 1..n are polygon holes.
import type { Coord, UserFeature } from '../layers/userLayerStore';

type Geometry = Pick<UserFeature, 'kind' | 'coords' | 'holes'>;

export function ringCount(f: Geometry): number {
  return f.kind === 'polygon' ? 1 + f.holes.length : 1;
}

export function getRing(f: Geometry, ring: number): Coord[] {
  return ring === 0 ? f.coords : (f.holes[ring - 1] ?? []);
}

function withRing<T extends Geometry>(f: T, ring: number, coords: Coord[]): T {
  if (ring === 0) return { ...f, coords };
  return { ...f, holes: f.holes.map((h, i) => (i === ring - 1 ? coords : h)) };
}

/** Fewest vertices a ring may keep. */
export function minVertices(f: Geometry): number {
  return f.kind === 'polygon' ? 3 : f.kind === 'line' ? 2 : 1;
}

export function moveVertex<T extends Geometry>(f: T, ring: number, index: number, pos: Coord): T {
  const pts = getRing(f, ring);
  if (index < 0 || index >= pts.length) return f;
  return withRing(
    f,
    ring,
    pts.map((p, i) => (i === index ? pos : p)),
  );
}

/** Inserts `pos` after vertex `afterIndex` (so the new vertex gets index afterIndex + 1). */
export function insertVertex<T extends Geometry>(
  f: T,
  ring: number,
  afterIndex: number,
  pos: Coord,
): T {
  if (f.kind === 'point') return f;
  const pts = getRing(f, ring);
  return withRing(f, ring, [...pts.slice(0, afterIndex + 1), pos, ...pts.slice(afterIndex + 1)]);
}

/** Removes a vertex; returns null when that would leave too few vertices. */
export function deleteVertex<T extends Geometry>(f: T, ring: number, index: number): T | null {
  const pts = getRing(f, ring);
  if (pts.length <= minVertices(f) || index < 0 || index >= pts.length) return null;
  return withRing(
    f,
    ring,
    pts.filter((_, i) => i !== index),
  );
}

/** Midpoint of two lon/lat positions, taking the short way across the antimeridian. */
export function midpoint(a: Coord, b: Coord): Coord {
  let dLon = b[0] - a[0];
  if (dLon > 180) dLon -= 360;
  else if (dLon < -180) dLon += 360;
  let lon = a[0] + dLon / 2;
  if (lon > 180) lon -= 360;
  else if (lon < -180) lon += 360;
  return [lon, (a[1] + b[1]) / 2];
}

export interface MidpointHandle {
  ring: number;
  /** The edge runs from vertex `index` to the next one (wrapping for polygons). */
  index: number;
  pos: Coord;
}

export function midpointHandles(f: Geometry): MidpointHandle[] {
  if (f.kind === 'point') return [];
  const out: MidpointHandle[] = [];
  for (let r = 0; r < ringCount(f); r++) {
    const pts = getRing(f, r);
    const edges = f.kind === 'polygon' ? pts.length : pts.length - 1;
    for (let i = 0; i < edges; i++) {
      out.push({ ring: r, index: i, pos: midpoint(pts[i], pts[(i + 1) % pts.length]) });
    }
  }
  return out;
}
