import { describe, expect, it } from 'vitest';
import {
  BASEMAPS,
  availability,
  buildTileUrl,
  mbtilesBasemap,
  mbtilesUrlTemplate,
  type Keys,
} from './basemaps';

const noKeys: Keys = { ionToken: '', esriKey: '', mapboxToken: '' };
const esri = BASEMAPS.find((b) => b.id === 'esri-imagery')!;

describe('basemaps', () => {
  it('defaults to OSM first, which needs no key', () => {
    expect(BASEMAPS[0].id).toBe('osm');
    expect(BASEMAPS[0].requiresKey).toBe(false);
  });
  it('has unique ids and an attribution for every provider', () => {
    expect(new Set(BASEMAPS.map((b) => b.id)).size).toBe(BASEMAPS.length);
    BASEMAPS.forEach((b) => expect(b.attribution).toBeTruthy());
  });
  it('disables keyed providers until a key is entered', () => {
    const keyed = BASEMAPS.filter((b) => b.requiresKey);
    expect(keyed.length).toBe(3);
    keyed.forEach((b) => expect(availability(b, noKeys).available).toBe(false));
    expect(availability(esri, { ...noKeys, esriKey: 'abc' }).available).toBe(true);
    expect(availability(esri, { ...noKeys, esriKey: '   ' }).available).toBe(false);
  });
  it('substitutes and encodes the key but leaves z/x/y alone', () => {
    const url = buildTileUrl(esri, { ...noKeys, esriKey: 'a b&c' });
    expect(url).toContain('token=a%20b%26c');
    expect(url).toContain('{z}/{y}/{x}');
  });
  it('builds MBTiles URLs for the platform scheme', () => {
    expect(mbtilesUrlTemplate('abc', true)).toBe('http://mbtiles.localhost/abc/{z}/{x}/{y}');
    expect(mbtilesUrlTemplate('abc', false)).toBe('mbtiles://localhost/abc/{z}/{x}/{y}');
  });
  it('marks an unopened MBTiles entry unavailable', () => {
    const cfg = mbtilesBasemap({ path: 'x.mbtiles', name: 'X', minZoom: 0, maxZoom: 5 });
    expect(availability(cfg, noKeys).available).toBe(false);
  });
});
