// Ellipsoidal (WGS84) geodesy built on GeographicLib: distances, azimuths, and polygon area.
// Pure functions with no Cesium dependency, so they can be tested against reference values.
import { Geodesic } from 'geographiclib-geodesic';

export interface LonLat {
  lon: number;
  lat: number;
}

const geod = Geodesic.WGS84;

export interface Inverse {
  /** Geodesic distance in meters. */
  distanceM: number;
  /** Azimuth at the start point, degrees clockwise from north in [0, 360). */
  initialAzimuth: number;
  /** Azimuth at the end point (direction of travel on arrival), degrees in [0, 360). */
  finalAzimuth: number;
}

const normalizeAzimuth = (a: number) => ((a % 360) + 360) % 360;

export function inverse(a: LonLat, b: LonLat): Inverse {
  const r = geod.Inverse(a.lat, a.lon, b.lat, b.lon);
  return {
    distanceM: r.s12 ?? 0,
    initialAzimuth: normalizeAzimuth(r.azi1 ?? 0),
    finalAzimuth: normalizeAzimuth(r.azi2 ?? 0),
  };
}

/** Length of each segment of a path, with its initial azimuth. */
export function segments(points: LonLat[]): Inverse[] {
  const out: Inverse[] = [];
  for (let i = 1; i < points.length; i++) out.push(inverse(points[i - 1], points[i]));
  return out;
}

export function pathLengthM(points: LonLat[]): number {
  return segments(points).reduce((sum, s) => sum + s.distanceM, 0);
}

export interface AreaResult {
  /** Absolute area in square meters. */
  areaM2: number;
  /** Perimeter in meters, including the closing edge. */
  perimeterM: number;
}

/** Area and perimeter of the polygon whose edges are geodesics between consecutive points. */
export function polygonAreaPerimeter(points: LonLat[]): AreaResult {
  if (points.length < 3) {
    return {
      areaM2: 0,
      perimeterM: points.length === 2 ? 2 * inverse(points[0], points[1]).distanceM : 0,
    };
  }
  const poly = geod.Polygon(false);
  for (const p of points) poly.AddPoint(p.lat, p.lon);
  const r = poly.Compute(false, true);
  return { areaM2: Math.abs(r.area ?? 0), perimeterM: r.perimeter ?? 0 };
}

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/** 16-point compass name for an azimuth in degrees. */
export function compassPoint(azimuth: number): string {
  return COMPASS[Math.round(normalizeAzimuth(azimuth) / 22.5) % 16];
}
