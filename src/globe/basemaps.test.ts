import { describe, expect, it } from 'vitest';
import { BASEMAPS, DEFAULT_BASEMAP } from './basemaps';

describe('basemaps', () => {
  it('defaults to OSM, which needs no key', () => {
    expect(DEFAULT_BASEMAP.id).toBe('osm');
    expect(DEFAULT_BASEMAP.requiresKey).toBe(false);
  });
  it('has unique ids', () => {
    expect(new Set(BASEMAPS.map((b) => b.id)).size).toBe(BASEMAPS.length);
  });
});
