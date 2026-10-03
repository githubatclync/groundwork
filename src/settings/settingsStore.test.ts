import { describe, expect, it } from 'vitest';
import { mbtilesBasemapId } from '../globe/basemaps';
import {
  DEFAULT_SETTINGS,
  MAX_RECENT_PROJECTS,
  resolveActiveBasemap,
  sanitizeSettings,
  withRecentProject,
} from './settingsStore';

const noKeys = { ionToken: '', esriKey: '', mapboxToken: '' };

describe('sanitizeSettings', () => {
  it('returns defaults for empty or junk input', () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(
      sanitizeSettings({ ionToken: 5, coordFormat: 'bogus', showFps: 'yes', mbtilesPaths: 'x' }),
    ).toEqual(DEFAULT_SETTINGS);
  });
  it('keeps valid values', () => {
    const s = sanitizeSettings({
      esriKey: 'k',
      coordFormat: 'utm',
      showFps: true,
      basemapId: 'esri-imagery',
      mbtilesPaths: ['a.mbtiles', 7],
    });
    expect(s.esriKey).toBe('k');
    expect(s.coordFormat).toBe('utm');
    expect(s.showFps).toBe(true);
    expect(s.mbtilesPaths).toEqual(['a.mbtiles']);
  });
});

describe('unit settings', () => {
  it('default to metric/auto and reject unknown values', () => {
    expect(DEFAULT_SETTINGS.unitSystem).toBe('metric');
    expect(DEFAULT_SETTINGS.areaUnit).toBe('auto');
    const s = sanitizeSettings({ unitSystem: 'furlongs', areaUnit: 'acres' });
    expect(s.unitSystem).toBe('metric');
    expect(s.areaUnit).toBe('acres');
    expect(sanitizeSettings({ unitSystem: 'nautical' }).unitSystem).toBe('nautical');
  });
});

describe('recent projects', () => {
  it('puts the newest first, de-duplicates by path, and caps the list', () => {
    let list: string[] = [];
    for (let i = 0; i < MAX_RECENT_PROJECTS + 3; i++)
      list = withRecentProject(list, `C:/p/${i}.groundwork.json`);
    expect(list).toHaveLength(MAX_RECENT_PROJECTS);
    expect(list[0]).toBe(`C:/p/${MAX_RECENT_PROJECTS + 2}.groundwork.json`);
    const again = withRecentProject(
      list,
      ['c:', 'P', '5.groundwork.json'].join(String.fromCharCode(92)),
    ); // same file, other slash style and case
    expect(again[0]).toBe(['c:', 'P', '5.groundwork.json'].join(String.fromCharCode(92)));
    expect(again.filter((p) => p.toLowerCase().endsWith('5.groundwork.json'))).toHaveLength(1);
    expect(again).toHaveLength(MAX_RECENT_PROJECTS);
  });
  it('sanitizes the stored list', () => {
    expect(sanitizeSettings({ recentProjects: ['a', 5, 'b'] }).recentProjects).toEqual(['a', 'b']);
    expect(sanitizeSettings({ recentProjects: 'x' }).recentProjects).toEqual([]);
  });
});

describe('resolveActiveBasemap', () => {
  it('falls back to OSM when the saved basemap needs a missing key', () => {
    expect(resolveActiveBasemap('esri-imagery', [], noKeys).id).toBe('osm');
    expect(resolveActiveBasemap('esri-imagery', [], { ...noKeys, esriKey: 'k' }).id).toBe(
      'esri-imagery',
    );
  });
  it('falls back to OSM when an MBTiles file is not open', () => {
    const entry = { path: 'a.mbtiles', name: 'A', minZoom: 0, maxZoom: 3 };
    expect(resolveActiveBasemap(mbtilesBasemapId('a.mbtiles'), [entry], noKeys).id).toBe('osm');
    const open = { ...entry, runtimeId: 'abc' };
    expect(resolveActiveBasemap(mbtilesBasemapId('a.mbtiles'), [open], noKeys).id).toBe(
      'mbtiles:a.mbtiles',
    );
  });
});
