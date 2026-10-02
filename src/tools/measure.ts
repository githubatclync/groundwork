// Turns the clicked points of a measurement into numbers: total and per-segment distance,
// heading, and polygon area/perimeter. Pure functions over geodesy.ts.
import { inverse, polygonAreaPerimeter, segments, type LonLat } from './geodesy';

export type MeasureMode = 'distance' | 'path' | 'area';

export interface SegmentResult {
  lengthM: number;
  /** Initial azimuth of the segment, degrees clockwise from north. */
  azimuth: number;
}

export interface Measurement {
  mode: MeasureMode;
  points: LonLat[];
  /** Total length: the distance, the path length, or the polygon perimeter. */
  totalM: number;
  segments: SegmentResult[];
  /** Heading at the start and end of a two-point distance measurement. */
  initialAzimuth: number | null;
  finalAzimuth: number | null;
  areaM2: number | null;
  perimeterM: number | null;
}

export function measure(mode: MeasureMode, points: LonLat[]): Measurement {
  if (mode === 'distance') {
    const pts = points.slice(0, 2);
    const first = pts.length === 2 ? inverse(pts[0], pts[1]) : null;
    return {
      mode,
      points: pts,
      totalM: first?.distanceM ?? 0,
      segments: first ? [{ lengthM: first.distanceM, azimuth: first.initialAzimuth }] : [],
      initialAzimuth: first?.initialAzimuth ?? null,
      finalAzimuth: first?.finalAzimuth ?? null,
      areaM2: null,
      perimeterM: null,
    };
  }
  const segs = segments(points).map((s) => ({ lengthM: s.distanceM, azimuth: s.initialAzimuth }));
  if (mode === 'path') {
    return {
      mode,
      points,
      totalM: segs.reduce((n, s) => n + s.lengthM, 0),
      segments: segs,
      initialAzimuth: null,
      finalAzimuth: null,
      areaM2: null,
      perimeterM: null,
    };
  }
  const a = polygonAreaPerimeter(points);
  return {
    mode,
    points,
    totalM: a.perimeterM,
    segments: segs,
    initialAzimuth: null,
    finalAzimuth: null,
    areaM2: a.areaM2,
    perimeterM: a.perimeterM,
  };
}

/** Minimum number of points before a measurement can be finished or saved. */
export const MIN_POINTS: Record<MeasureMode, number> = { distance: 2, path: 2, area: 3 };
