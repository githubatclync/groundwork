import { describe, expect, it } from 'vitest';
import { formatDD, formatDMS, formatUTM, toUtm, utmZone } from './coords';

describe('coords', () => {
  it('formats DD', () => {
    expect(formatDD(40.7484, -73.9857)).toBe('40.748400, -73.985700');
  });
  it('formats DMS with hemispheres', () => {
    expect(formatDMS(40.5, -73.25)).toBe(`40°30'00.0"N 73°15'00.0"W`);
    expect(formatDMS(-33.8688, 151.2093)).toBe(`33°52'07.7"S 151°12'33.5"E`);
  });
  it('carries rounding into minutes instead of printing 60"', () => {
    expect(formatDMS(10 + 59 / 60 + 59.97 / 3600, 0)).toBe(`11°00'00.0"N 0°00'00.0"E`);
  });
  it('converts to UTM (reference values from proj4, EPSG:32618)', () => {
    const u = toUtm(40.74844, -73.985664)!;
    expect(u.zone).toBe(18);
    expect(u.band).toBe('T');
    expect(Math.abs(u.easting - 585631.397)).toBeLessThan(0.01);
    expect(Math.abs(u.northing - 4511326.923)).toBeLessThan(0.01);
  });
  it('uses false northing in the southern hemisphere', () => {
    // Sydney Opera House, proj4 reference (EPSG:32756)
    const u = toUtm(-33.8568, 151.2153)!;
    expect(u.zone).toBe(56);
    expect(u.band).toBe('H');
    expect(Math.abs(u.easting - 334900.57)).toBeLessThan(0.01);
    expect(Math.abs(u.northing - 6252288.753)).toBeLessThan(0.01);
  });
  it('handles the central meridian and polar limits', () => {
    const u = toUtm(0, 3)!;
    expect(u.zone).toBe(31);
    expect(u.easting).toBeCloseTo(500000, 3);
    expect(u.northing).toBeCloseTo(0, 3);
    expect(toUtm(85, 0)).toBeNull();
    expect(formatUTM(-85, 0)).toBe('UTM n/a');
  });
  it('applies Norway and Svalbard zone exceptions', () => {
    expect(utmZone(60, 5)).toBe(32);
    expect(utmZone(78, 15)).toBe(33);
  });
});
