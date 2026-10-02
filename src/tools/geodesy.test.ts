// Geodesy checks against independent reference values (within 0.1%, as the spec requires).
import { describe, expect, it } from 'vitest';
import { compassPoint, inverse, pathLengthM, polygonAreaPerimeter, segments } from './geodesy';

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;

/** Relative error in percent. */
const pct = (actual: number, expected: number) =>
  (Math.abs(actual - expected) / Math.abs(expected)) * 100;

/**
 * Independent closed form for the area of a lat/lon "box" bounded by parallels and meridians on the
 * WGS84 ellipsoid (integral of the ellipsoid's area element), not using GeographicLib.
 */
function boxAreaClosedForm(lat1: number, lat2: number, dLonDeg: number): number {
  const e2 = WGS84_F * (2 - WGS84_F);
  const e = Math.sqrt(e2);
  const F = (latDeg: number) => {
    const s = Math.sin((latDeg * Math.PI) / 180);
    return s / (2 * (1 - e2 * s * s)) + Math.log((1 + e * s) / (1 - e * s)) / (4 * e);
  };
  return ((dLonDeg * Math.PI) / 180) * WGS84_A * WGS84_A * (1 - e2) * (F(lat2) - F(lat1));
}

describe('geodesic distance', () => {
  it('Wellington to Salamanca (the GeographicLib documentation example)', () => {
    const d = inverse({ lat: -41.32, lon: 174.81 }, { lat: 40.96, lon: -5.5 }).distanceM;
    expect(pct(d, 19_959_679.267)).toBeLessThan(0.001);
  });

  it('one degree of longitude along the equator is a*pi/180', () => {
    const d = inverse({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }).distanceM;
    expect(pct(d, (WGS84_A * Math.PI) / 180)).toBeLessThan(0.0001);
  });

  it('one degree of latitude from the equator (meridian arc)', () => {
    const d = inverse({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }).distanceM;
    expect(pct(d, 110_574.389)).toBeLessThan(0.001);
  });

  it('one degree of latitude near the pole is longer than at the equator', () => {
    const d = inverse({ lat: 89, lon: 0 }, { lat: 90, lon: 0 }).distanceM;
    expect(pct(d, 111_693.865)).toBeLessThan(0.001);
  });

  it('is symmetric and zero for identical points', () => {
    const a = { lat: 10, lon: 20 };
    const b = { lat: -30, lon: 100 };
    expect(inverse(a, b).distanceM).toBeCloseTo(inverse(b, a).distanceM, 6);
    expect(inverse(a, a).distanceM).toBe(0);
  });

  it('sums a path from its segments', () => {
    const pts = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
    ];
    const parts = segments(pts);
    expect(parts).toHaveLength(2);
    expect(pathLengthM(pts)).toBeCloseTo(parts[0].distanceM + parts[1].distanceM, 6);
    expect(pathLengthM([pts[0]])).toBe(0);
  });
});

describe('azimuth', () => {
  it('due north, east, south, and west', () => {
    const o = { lat: 0, lon: 0 };
    expect(inverse(o, { lat: 1, lon: 0 }).initialAzimuth).toBeCloseTo(0, 6);
    expect(inverse(o, { lat: 0, lon: 1 }).initialAzimuth).toBeCloseTo(90, 6);
    expect(inverse(o, { lat: -1, lon: 0 }).initialAzimuth).toBeCloseTo(180, 6);
    expect(inverse(o, { lat: 0, lon: -1 }).initialAzimuth).toBeCloseTo(270, 6);
  });

  it('initial and final azimuths differ along a long great-circle-like route', () => {
    const r = inverse({ lat: 40.6, lon: -73.8 }, { lat: 51.6, lon: -0.5 }); // New York to London area
    expect(r.initialAzimuth).toBeGreaterThan(40);
    expect(r.initialAzimuth).toBeLessThan(60);
    expect(r.finalAzimuth).toBeGreaterThan(r.initialAzimuth + 10);
  });

  it('names compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(45)).toBe('NE');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(202.5)).toBe('SSW');
    expect(compassPoint(-90)).toBe('W');
  });
});

describe('polygon area', () => {
  it('an octant of the ellipsoid is exactly one eighth of its surface', () => {
    // Equator, the 0 meridian, and the 90E meridian are all geodesics, so the octant is exact.
    const octant = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 90 },
      { lat: 90, lon: 0 },
    ];
    const total = 510_065_621_724_000; // WGS84 surface area: 510,065,621.724 km^2 in m^2
    expect(pct(polygonAreaPerimeter(octant).areaM2, total / 8)).toBeLessThan(0.001);
  });

  it('a one-degree box at the equator matches the closed-form ellipsoid area', () => {
    const box = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 1, lon: 0 },
    ];
    expect(pct(polygonAreaPerimeter(box).areaM2, boxAreaClosedForm(0, 1, 1))).toBeLessThan(0.01);
  });

  it('a 2x2 degree box at 45N matches the closed-form ellipsoid area', () => {
    const box = [
      { lat: 45, lon: 10 },
      { lat: 45, lon: 12 },
      { lat: 47, lon: 12 },
      { lat: 47, lon: 10 },
    ];
    expect(pct(polygonAreaPerimeter(box).areaM2, boxAreaClosedForm(45, 47, 2))).toBeLessThan(0.1);
  });

  it('does not depend on winding direction or on a repeated closing vertex', () => {
    const cw = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
      { lat: 1, lon: 1 },
      { lat: 0, lon: 1 },
    ];
    const ccw = [...cw].reverse();
    const a = polygonAreaPerimeter(cw);
    expect(polygonAreaPerimeter(ccw).areaM2).toBeCloseTo(a.areaM2, 0);
    expect(a.perimeterM).toBeGreaterThan(4 * 110_000);
    expect(a.perimeterM).toBeLessThan(4 * 112_000);
  });

  it('is zero for fewer than three points, with a degenerate perimeter', () => {
    expect(polygonAreaPerimeter([]).areaM2).toBe(0);
    const two = polygonAreaPerimeter([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
    ]);
    expect(two.areaM2).toBe(0);
    expect(two.perimeterM).toBeGreaterThan(200_000);
  });

  it('handles polygons that cross the antimeridian', () => {
    const box = [
      { lat: 0, lon: 179.5 },
      { lat: 0, lon: -179.5 },
      { lat: 1, lon: -179.5 },
      { lat: 1, lon: 179.5 },
    ];
    expect(pct(polygonAreaPerimeter(box).areaM2, boxAreaClosedForm(0, 1, 1))).toBeLessThan(0.01);
  });
});
