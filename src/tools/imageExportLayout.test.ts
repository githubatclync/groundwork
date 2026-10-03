import { describe, expect, it } from 'vitest';
import type { Style } from '../io/types';
import { DEFAULT_STYLE, type UserFeature } from '../layers/userLayerStore';
import {
  hexAlpha,
  layerLegendEntries,
  niceNumber,
  niceScaleBar,
  outputSize,
  rgbaCss,
  userLegendEntries,
} from './imageExportLayout';

describe('outputSize', () => {
  it('scales the screen size by the requested factor', () => {
    expect(outputSize(1000, 800, 1, 1)).toMatchObject({ width: 1000, height: 800, clamped: false });
    expect(outputSize(1000, 800, 1, 4)).toMatchObject({
      width: 4000,
      height: 3200,
      effectiveScale: 4,
    });
    expect(outputSize(1000, 800, 1.5, 2)).toMatchObject({ width: 3000, height: 2400 });
  });

  it('shrinks to fit the GPU dimension limit and reports it', () => {
    const s = outputSize(4000, 2000, 2, 4, { maxDim: 16384, maxPixels: 1e12 });
    expect(s.clamped).toBe(true);
    expect(s.width).toBeLessThanOrEqual(16384);
    expect(s.width).toBe(16384);
    expect(s.height).toBe(8192); // aspect ratio is preserved
    expect(s.effectiveScale).toBeCloseTo(16384 / 8000, 6);
  });

  it('shrinks to fit the pixel budget', () => {
    const s = outputSize(2000, 1000, 1, 4, { maxDim: 99999, maxPixels: 8_000_000 });
    expect(s.clamped).toBe(true);
    expect(s.width * s.height).toBeLessThanOrEqual(8_000_000);
  });

  it('never returns an empty image', () => {
    expect(outputSize(0, 0, 1, 1).width).toBeGreaterThanOrEqual(1);
  });
});

describe('niceScaleBar', () => {
  it('picks 1, 2, or 5 times a power of ten', () => {
    expect(niceNumber(7.3)).toBe(5);
    expect(niceNumber(3.9)).toBe(2);
    expect(niceNumber(1.9)).toBe(1);
    expect(niceNumber(870)).toBe(500);
    expect(niceNumber(0.034)).toBe(0.02);
    expect(niceNumber(0)).toBe(0);
  });

  it('metric uses m below 1 km and km above', () => {
    expect(niceScaleBar(870, 'metric')).toEqual({ lengthM: 500, label: '500 m' });
    expect(niceScaleBar(23_400, 'metric')).toEqual({ lengthM: 20_000, label: '20 km' });
    expect(niceScaleBar(1000, 'metric')).toEqual({ lengthM: 1000, label: '1 km' });
  });

  it('imperial uses ft below a mile and mi above', () => {
    const ft = niceScaleBar(200, 'imperial');
    expect(ft?.label).toBe('500 ft');
    expect(ft?.lengthM).toBeCloseTo(152.4, 6);
    const mi = niceScaleBar(8000, 'imperial');
    expect(mi?.label).toBe('2 mi');
    expect(mi?.lengthM).toBeCloseTo(3218.688, 6);
  });

  it('nautical uses m for short bars and nmi for long ones', () => {
    expect(niceScaleBar(900, 'nautical')?.label).toBe('500 m');
    expect(niceScaleBar(9000, 'nautical')).toEqual({ lengthM: 2 * 1852, label: '2 nmi' });
  });

  it('never exceeds the available length and handles bad input', () => {
    for (const max of [1.3, 17, 640, 5200, 91_000, 3_000_000]) {
      for (const sys of ['metric', 'imperial', 'nautical'] as const) {
        const bar = niceScaleBar(max, sys);
        expect(bar && bar.lengthM <= max).toBe(true);
      }
    }
    expect(niceScaleBar(0, 'metric')).toBeNull();
    expect(niceScaleBar(NaN, 'metric')).toBeNull();
  });
});

describe('legend', () => {
  const style = (over: Partial<Style> = {}): Style => ({
    icon: null,
    label: null,
    line: { color: 'ff0000ff', width: 2 },
    poly: { color: '00ff0080', fill: true, outline: true },
    ...over,
  });
  const base = style({
    line: { color: 'ffffffff', width: 1 },
    poly: { color: 'ffffffff', fill: true, outline: true },
  });

  it('converts colors to CSS', () => {
    expect(rgbaCss('ff000080')).toBe('rgba(255,0,0,0.502)');
    expect(rgbaCss('nope')).toBe('rgba(255,255,255,1)');
    expect(hexAlpha('#00ff00', 0.5)).toBe('rgba(0,255,0,0.5)');
  });

  it('lists visible layers with a swatch per geometry kind, from the first non-default style', () => {
    const entries = layerLegendEntries([
      {
        name: 'Parcels',
        visible: true,
        styles: [base, style()],
        geometryCounts: { points: 0, lines: 1, polygons: 3 },
      },
      {
        name: 'Hidden',
        visible: false,
        styles: [base],
        geometryCounts: { points: 5, lines: 0, polygons: 0 },
      },
      {
        name: 'Sites',
        visible: true,
        styles: [base],
        geometryCounts: { points: 5, lines: 0, polygons: 0 },
      },
    ]);
    expect(entries.map((e) => e.label)).toEqual(['Parcels', 'Sites']);
    expect(entries[0].swatches.map((s) => s.kind)).toEqual(['line', 'area']);
    expect(entries[0].swatches[0].stroke).toBe('rgba(255,0,0,1.000)');
    expect(entries[0].swatches[1].fill).toBe('rgba(0,255,0,0.502)');
    expect(entries[1].swatches.map((s) => s.kind)).toEqual(['point']);
  });

  it('a layer with unfilled polygons has no fill swatch', () => {
    const [e] = layerLegendEntries([
      {
        name: 'Outlines',
        visible: true,
        styles: [base, style({ poly: { color: 'ffffffff', fill: false, outline: true } })],
        geometryCounts: { points: 0, lines: 0, polygons: 1 },
      },
    ]);
    expect(e.swatches[0].fill).toBeNull();
  });

  const feat = (i: number, kind: UserFeature['kind']): UserFeature => ({
    id: i,
    name: `F${i}`,
    kind,
    coords: [],
    holes: [],
    description: '',
    attrs: [],
    visible: true,
    style: { ...DEFAULT_STYLE, color: '#ff0000' },
  });

  it('lists My Places features individually and summarizes the rest', () => {
    const features = Array.from({ length: 9 }, (_, i) =>
      feat(i, i === 0 ? 'point' : i === 1 ? 'line' : 'polygon'),
    );
    const entries = userLegendEntries(features, true);
    expect(entries).toHaveLength(7);
    expect(entries[0].swatches[0].kind).toBe('point');
    expect(entries[1].swatches[0].kind).toBe('line');
    expect(entries[2].swatches[0].kind).toBe('area');
    expect(entries.at(-1)?.label).toBe('+3 more in My Places');
    expect(userLegendEntries(features, false)).toEqual([]);
    expect(userLegendEntries([], true)).toEqual([]);
  });
});
