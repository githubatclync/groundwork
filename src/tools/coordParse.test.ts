import { describe, expect, it } from 'vitest';
import { fromUtm, toUtm } from '../globe/coords';
import { parseCoordinates } from './coordParse';

const near = (r: { lat: number; lon: number } | null, lat: number, lon: number, tol = 1e-4) => {
  expect(r).not.toBeNull();
  expect(Math.abs((r as { lat: number }).lat - lat)).toBeLessThan(tol);
  expect(Math.abs((r as { lon: number }).lon - lon)).toBeLessThan(tol);
};

describe('fromUtm', () => {
  it('matches the proj4 reference values used for the forward projection', () => {
    const ny = fromUtm(18, 'N', 585631.397, 4511326.923);
    near(ny, 40.74844, -73.985664, 1e-6);
    const sydney = fromUtm(56, 'S', 334900.57, 6252288.753);
    near(sydney, -33.8568, 151.2153, 1e-6);
  });

  it('is the exact inverse of toUtm over a grid of points', () => {
    for (let lat = -78; lat <= 83; lat += 13) {
      for (let lon = -179; lon <= 179; lon += 31) {
        const u = toUtm(lat, lon);
        if (!u) continue;
        const r = fromUtm(u.zone, u.hemisphere, u.easting, u.northing);
        near(r, lat, lon, 1e-7);
      }
    }
  });

  it('rejects bad input', () => {
    expect(fromUtm(0, 'N', 500000, 0)).toBeNull();
    expect(fromUtm(61, 'N', 500000, 0)).toBeNull();
    expect(fromUtm(18, 'N', NaN, 0)).toBeNull();
  });
});

describe('parseCoordinates: decimal degrees', () => {
  it('accepts comma, space, and semicolon separators', () => {
    near(parseCoordinates('40.7484, -73.9857'), 40.7484, -73.9857);
    near(parseCoordinates('40.7484 -73.9857'), 40.7484, -73.9857);
    near(parseCoordinates('40.7484; -73.9857'), 40.7484, -73.9857);
    near(parseCoordinates('  -33.8688,151.2093  '), -33.8688, 151.2093);
    expect(parseCoordinates('1,2')?.format).toBe('dd');
  });

  it('honors hemisphere letters in either style and either order', () => {
    near(parseCoordinates('40.7484N 73.9857W'), 40.7484, -73.9857);
    near(parseCoordinates('N40.7484 W73.9857'), 40.7484, -73.9857);
    near(parseCoordinates('40.7484 N, 73.9857 W'), 40.7484, -73.9857);
    near(parseCoordinates('73.9857W 40.7484N'), 40.7484, -73.9857); // longitude first
    near(parseCoordinates('33.8688 S, 151.2093 E'), -33.8688, 151.2093);
  });

  it('allows "lat:"/"lon:" labels', () => {
    near(parseCoordinates('lat: 12.5, lon: -45.25'), 12.5, -45.25);
  });

  it('rejects out-of-range values and contradictory letters', () => {
    expect(parseCoordinates('91, 10')).toBeNull();
    expect(parseCoordinates('10, 181')).toBeNull();
    expect(parseCoordinates('10N 20N')).toBeNull();
    expect(parseCoordinates('10E 20W')).toBeNull();
    expect(parseCoordinates('10N, 20')).not.toBeNull();
  });
});

describe('parseCoordinates: degrees, minutes, seconds', () => {
  it('handles symbols and letters', () => {
    const r = parseCoordinates(`40°26'46"N 79°58'56"W`);
    near(r, 40 + 26 / 60 + 46 / 3600, -(79 + 58 / 60 + 56 / 3600));
    expect(r?.format).toBe('dms');
  });

  it('handles spaces only, with letters or with signs', () => {
    near(parseCoordinates('40 26 46 N, 79 58 56 W'), 40.446111, -79.982222);
    near(parseCoordinates('40 26 46 N 79 58 56 W'), 40.446111, -79.982222);
    near(parseCoordinates('40 26 46 79 58 56'), 40.446111, 79.982222);
    near(parseCoordinates('-40 26 46, -79 58 56'), -40.446111, -79.982222);
  });

  it('handles decimal minutes and degrees-minutes only', () => {
    near(parseCoordinates(`40°26.767'N 79°58.933'W`), 40.446117, -79.982217);
    near(parseCoordinates('S 33 52 E 151 12'), -33.866667, 151.2);
  });

  it('prefix-letter style', () => {
    near(parseCoordinates('N 40 26 46 W 79 58 56'), 40.446111, -79.982222);
  });

  it('rejects impossible minutes/seconds', () => {
    expect(parseCoordinates('40 61 0 N 10 0 0 E')).toBeNull();
    expect(parseCoordinates('40 10 75 N 10 0 0 E')).toBeNull();
  });
});

describe('parseCoordinates: UTM', () => {
  it('parses zone, band, easting, northing', () => {
    const r = parseCoordinates('18T 585631 4511327');
    near(r, 40.74844, -73.985664, 2e-5);
    expect(r?.format).toBe('utm');
    near(parseCoordinates('18T 585631E 4511327N'), 40.74844, -73.985664, 2e-5);
    near(parseCoordinates('18t, 585631 m E, 4511327 m N'), 40.74844, -73.985664, 2e-5);
    near(parseCoordinates('zone 18T 585631 4511327'), 40.74844, -73.985664, 2e-5);
  });

  it('southern bands use the false northing', () => {
    near(parseCoordinates('56H 334901 6252289'), -33.8568, 151.2153, 2e-5);
  });

  it('round-trips what the status bar prints', () => {
    const u = toUtm(47.3769, 8.5417);
    const text = `${u?.zone}${u?.band} ${Math.round(u?.easting ?? 0)} E ${Math.round(u?.northing ?? 0)} N`;
    near(parseCoordinates(text), 47.3769, 8.5417, 2e-5);
  });

  it('rejects out-of-range zones and grid values', () => {
    expect(parseCoordinates('61T 585631 4511327')).toBeNull();
    expect(parseCoordinates('18T 50 4511327')).toBeNull();
    expect(parseCoordinates('18T 585631 99999999')).toBeNull();
  });
});

describe('parseCoordinates: not a coordinate', () => {
  it('returns null for place names and junk so they can be geocoded', () => {
    for (const text of [
      'Paris',
      'New York, NY',
      'Eiffel Tower',
      '',
      '   ',
      '12',
      '1 2 3',
      '10 20 30 40 50',
      'N S',
      '40.7 abc',
    ]) {
      expect(parseCoordinates(text), text).toBeNull();
    }
  });
});
