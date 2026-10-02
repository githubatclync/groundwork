import { describe, expect, it } from 'vitest';
import { GEOM_LINE, GEOM_POINT, GEOM_POLY_HOLE, GEOM_POLY_OUTER } from '../../io/geometry';
import { layerResourceUrl, customSchemeUrl } from '../../io/scheme';
import type { FolderNode } from '../../io/types';
import { effectiveFolderVisibility } from '../folderVisibility';
import { DEFAULT_POINT_COLOR, parseRgba, pointColor } from './colors';
import { polygonAt } from './partGroups';
import { drawUnits, hilbertIndex, lonLatKey, spatiallySortedUnits } from './partOrder';
import type { GeometryBuffer } from '../../io/geometry';

describe('parseRgba', () => {
  it('reads rrggbbaa', () => {
    expect(parseRgba('ff000080')).toEqual([255, 0, 0, 128]);
    expect(parseRgba('0000ffff')).toEqual([0, 0, 255, 255]);
  });
  it('falls back to opaque white on bad input', () => {
    expect(parseRgba('nope')).toEqual([255, 255, 255, 255]);
  });
  it('turns untinted markers amber but keeps tints', () => {
    expect(pointColor('ffffffff')).toEqual(DEFAULT_POINT_COLOR);
    expect(pointColor('ff0000ff')).toEqual([255, 0, 0, 255]);
    expect(pointColor(undefined)).toEqual(DEFAULT_POINT_COLOR);
  });
});

describe('polygonAt', () => {
  const types = Uint8Array.from([
    GEOM_POINT,
    GEOM_POLY_OUTER,
    GEOM_POLY_HOLE,
    GEOM_POLY_HOLE,
    GEOM_POLY_OUTER,
    GEOM_LINE,
  ]);
  it('collects the holes that follow an outer ring', () => {
    expect(polygonAt(types, 1)).toEqual({ outer: 1, holes: [2, 3], next: 4 });
    expect(polygonAt(types, 4)).toEqual({ outer: 4, holes: [], next: 5 });
  });
});

describe('effectiveFolderVisibility', () => {
  const node = (id: number, visible: boolean, children: FolderNode[] = []): FolderNode => ({
    id,
    name: String(id),
    open: false,
    visible,
    featureCount: 0,
    children,
  });
  it('hides descendants of hidden folders', () => {
    const tree = node(0, true, [node(1, false, [node(2, true)]), node(3, true)]);
    const v = effectiveFolderVisibility(tree);
    expect([v.get(0), v.get(1), v.get(2), v.get(3)]).toEqual([true, false, false, true]);
  });
});

describe('resource urls', () => {
  it('encodes each path segment', () => {
    expect(layerResourceUrl('L1', 'files/my icon.png', true)).toBe(
      'http://kmz.localhost/L1/files/my%20icon.png',
    );
    expect(layerResourceUrl('L1', 'a.png', false)).toBe('kmz://localhost/L1/a.png');
    expect(customSchemeUrl('x', '/p', true)).toBe('http://x.localhost/p');
  });
});

describe('spatial ordering', () => {
  const fake = (types: number[], coords: number[]): GeometryBuffer => {
    // One vertex per part is enough for ordering tests.
    const n = types.length;
    return {
      partCount: n,
      vertexCount: n,
      featureCount: n,
      coords: Float64Array.from(coords),
      offsets: Uint32Array.from({ length: n + 1 }, (_, i) => i),
      featureIds: new Uint32Array(n),
      folderIds: new Uint32Array(n),
      styleIds: new Uint32Array(n),
      types: Uint8Array.from(types),
      flags: new Uint8Array(n),
    };
  };

  it('keeps polygons together and skips holes', () => {
    const types = Uint8Array.from([GEOM_POLY_OUTER, GEOM_POLY_HOLE, GEOM_LINE, GEOM_POINT]);
    expect(Array.from(drawUnits(types))).toEqual([0, 2, 3]);
  });

  it('orders nearby points next to each other', () => {
    // West, east, west, east: Z-order should group the two western points and the two eastern ones.
    const g = fake(
      [GEOM_POINT, GEOM_POINT, GEOM_POINT, GEOM_POINT],
      [-120, 10, 0, 100, 10, 0, -119.9, 10.1, 0, 100.1, 10.1, 0],
    );
    const order = Array.from(spatiallySortedUnits(g));
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    const pos = (p: number) => order.indexOf(p);
    expect(Math.abs(pos(0) - pos(2))).toBe(1);
    expect(Math.abs(pos(1) - pos(3))).toBe(1);
  });

  it('computes Hilbert keys with no jumps between consecutive cells', () => {
    // Walk a corner of the grid: cells with consecutive indices must be 4-neighbours.
    const cells = new Map<number, [number, number]>();
    for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) cells.set(hilbertIndex(x, y), [x, y]);
    expect(cells.size).toBe(1024); // all distinct
    expect(hilbertIndex(0, 0)).toBe(0);
    expect(lonLatKey(-180, -90)).toBe(0);
    // Indices 0..1023 cover exactly the first 32x32 block (order-5 sub-curve), in adjacent steps.
    for (let d = 0; d < 1023; d++) {
      const a = cells.get(d);
      const b = cells.get(d + 1);
      expect(a && b).toBeTruthy();
      if (a && b) expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBe(1);
    }
  });
});
