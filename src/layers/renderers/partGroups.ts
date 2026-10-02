// Groups a layer's geometry parts into drawable units: a polygon is its outer-ring part plus the
// hole parts that follow it. Pure logic, no Cesium dependency.
import { GEOM_POLY_HOLE, GEOM_POLY_OUTER } from '../../io/geometry';

export interface PolygonGroup {
  outer: number;
  holes: number[];
  /** Index of the next part after this polygon. */
  next: number;
}

/** Reads the polygon starting at part `i` (which must be an outer ring). */
export function polygonAt(types: Uint8Array, i: number): PolygonGroup {
  const holes: number[] = [];
  let j = i + 1;
  while (j < types.length && types[j] === GEOM_POLY_HOLE) holes.push(j++);
  return { outer: i, holes, next: j };
}

export function isPolygonStart(type: number): boolean {
  return type === GEOM_POLY_OUTER;
}
