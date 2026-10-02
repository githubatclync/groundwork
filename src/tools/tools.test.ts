import { beforeEach, describe, expect, it } from 'vitest';
import { useUserLayer } from '../layers/userLayerStore';
import { measure } from './measure';
import { useMeasure } from './measureStore';
import { measurementToFeature } from './saveMeasurement';
import { measureModeOf, useTool } from './toolStore';
import { formatArea, formatDistance } from './units';

describe('formatDistance', () => {
  it('metric', () => {
    expect(formatDistance(5, 'metric')).toBe('5.00 m');
    expect(formatDistance(850.46, 'metric')).toBe('850.5 m');
    expect(formatDistance(12_345.6, 'metric')).toBe('12.346 km');
  });
  it('imperial switches from feet to miles at 1000 ft', () => {
    expect(formatDistance(100, 'imperial')).toBe('328.1 ft');
    expect(formatDistance(1609.344, 'imperial')).toBe('1.000 mi');
  });
  it('nautical', () => {
    expect(formatDistance(1852, 'nautical')).toBe('1.000 nmi');
    expect(formatDistance(18_520, 'nautical')).toBe('10.000 nmi');
  });
});

describe('formatArea', () => {
  it('metric picks m2, ha, or km2', () => {
    expect(formatArea(500, 'metric')).toBe('500.0 m²');
    expect(formatArea(50_000, 'metric')).toBe('5.00 ha');
    expect(formatArea(12_308_778_361, 'metric')).toBe('12,308.778 km²');
  });
  it('imperial picks ft2, acres, or mi2', () => {
    expect(formatArea(100, 'imperial')).toBe('1,076 ft²');
    expect(formatArea(40_468.564224, 'imperial')).toBe('10.00 ac');
    expect(formatArea(2_589_988.110336 * 2, 'imperial')).toBe('2.000 mi²');
  });
  it('can force hectares or acres in any system', () => {
    expect(formatArea(10_000, 'imperial', 'hectares')).toBe('1.00 ha');
    expect(formatArea(4046.8564224, 'metric', 'acres')).toBe('1.00 ac');
  });
});

describe('measure', () => {
  const p = (lon: number, lat: number) => ({ lon, lat });

  it('distance uses the first two points and reports headings', () => {
    const m = measure('distance', [p(0, 0), p(0, 1), p(5, 5)]);
    expect(m.points).toHaveLength(2);
    expect(m.totalM).toBeGreaterThan(110_000);
    expect(m.initialAzimuth).toBeCloseTo(0, 6);
    expect(measure('distance', [p(0, 0)]).totalM).toBe(0);
  });

  it('path totals its segments', () => {
    const m = measure('path', [p(0, 0), p(0, 1), p(1, 1)]);
    expect(m.segments).toHaveLength(2);
    expect(m.totalM).toBeCloseTo(m.segments[0].lengthM + m.segments[1].lengthM, 6);
  });

  it('area reports area and perimeter', () => {
    const m = measure('area', [p(0, 0), p(0, 1), p(1, 1), p(1, 0)]);
    expect(m.areaM2).toBeGreaterThan(1.2e10);
    expect(m.perimeterM).toBeCloseTo(m.totalM, 6);
  });
});

describe('measure store', () => {
  beforeEach(() => useMeasure.getState().reset());
  const p = (lon: number, lat: number) => ({ lon, lat });

  it('distance finishes automatically at two points; later clicks start over', () => {
    const s = useMeasure.getState();
    s.addPoint('distance', p(0, 0));
    expect(useMeasure.getState().finished).toBe(false);
    s.addPoint('distance', p(1, 0));
    expect(useMeasure.getState().finished).toBe(true);
    s.addPoint('distance', p(5, 5));
    expect(useMeasure.getState().points).toEqual([p(5, 5)]);
    expect(useMeasure.getState().finished).toBe(false);
  });

  it('path and area finish only with enough points', () => {
    const s = useMeasure.getState();
    s.addPoint('area', p(0, 0));
    s.addPoint('area', p(1, 0));
    expect(s.finish('area')).toBe(false);
    s.addPoint('area', p(1, 1));
    expect(useMeasure.getState().finish('area')).toBe(true);
    expect(useMeasure.getState().finished).toBe(true);
  });

  it('pops the duplicate point from a double-click', () => {
    const s = useMeasure.getState();
    s.addPoint('path', p(0, 0));
    s.addPoint('path', p(1, 1));
    s.addPoint('path', p(1, 1));
    useMeasure.getState().popPoint();
    expect(useMeasure.getState().points).toHaveLength(2);
  });
});

describe('tool store', () => {
  it('switching tools abandons the measurement in progress', () => {
    useTool.getState().setTool('measure-path');
    useMeasure.getState().addPoint('path', { lon: 0, lat: 0 });
    useTool.getState().setTool('none');
    expect(useMeasure.getState().points).toEqual([]);
  });
  it('maps tools to measurement modes', () => {
    expect(measureModeOf('measure-distance')).toBe('distance');
    expect(measureModeOf('measure-path')).toBe('path');
    expect(measureModeOf('measure-area')).toBe('area');
    expect(measureModeOf('draw-line')).toBeNull();
  });
});

describe('save as feature', () => {
  it('turns a path into a line with length attributes', () => {
    const f = measurementToFeature(
      measure('path', [
        { lon: 0, lat: 0 },
        { lon: 0, lat: 1 },
      ]),
      'metric',
      'auto',
    );
    expect(f.kind).toBe('line');
    expect(f.name).toBe('Path 110.574 km');
    expect(Number(f.attrs.length_m)).toBeCloseTo(110_574.39, 0);
    expect(f.coords).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it('turns an area into a polygon with area and perimeter, in the chosen units', () => {
    const f = measurementToFeature(
      measure('area', [
        { lon: 0, lat: 0 },
        { lon: 1, lat: 0 },
        { lon: 1, lat: 1 },
        { lon: 0, lat: 1 },
      ]),
      'imperial',
      'acres',
    );
    expect(f.kind).toBe('polygon');
    expect(f.name).toMatch(/^Area .* ac$/);
    expect(f.description).toContain('Perimeter:');
    expect(Number(f.attrs.area_m2)).toBeGreaterThan(1.2e10);
  });

  it('adds to the user layer', () => {
    useUserLayer.getState().clear();
    const id = useUserLayer.getState().addFeature({
      name: 'x',
      kind: 'line',
      coords: [],
      description: '',
      attrs: {},
    });
    expect(useUserLayer.getState().features.map((f) => f.id)).toEqual([id]);
    useUserLayer.getState().removeFeature(id);
    expect(useUserLayer.getState().features).toEqual([]);
  });
});
