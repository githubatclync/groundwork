import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteVertex,
  getRing,
  insertVertex,
  midpoint,
  midpointHandles,
  minVertices,
  moveVertex,
} from '../tools/editOps';
import {
  COALESCE_MS,
  DEFAULT_STYLE,
  HISTORY_LIMIT,
  resetUserLayer,
  useUserLayer,
  type UserFeature,
} from './userLayerStore';

const base = (over: Partial<Omit<UserFeature, 'id'>> = {}): Omit<UserFeature, 'id'> => ({
  name: 'F',
  kind: 'line',
  coords: [
    [0, 0],
    [1, 1],
  ],
  holes: [],
  description: '',
  attrs: [],
  style: { ...DEFAULT_STYLE },
  visible: true,
  ...over,
});

const store = () => useUserLayer.getState();
const poly = (): Omit<UserFeature, 'id'> =>
  base({
    kind: 'polygon',
    coords: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    holes: [
      [
        [1, 1],
        [2, 1],
        [2, 2],
      ],
    ],
  });

describe('vertex editing', () => {
  it('moves, inserts, and deletes vertices without mutating the original', () => {
    const f = base();
    const moved = moveVertex(f, 0, 1, [5, 5]);
    expect(moved.coords).toEqual([
      [0, 0],
      [5, 5],
    ]);
    expect(f.coords[1]).toEqual([1, 1]);
    const inserted = insertVertex(f, 0, 0, [0.5, 0.5]);
    expect(inserted.coords).toEqual([
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]);
    expect(deleteVertex(inserted, 0, 1)?.coords).toHaveLength(2);
  });

  it('refuses to delete below the minimum for each kind', () => {
    expect(minVertices(base())).toBe(2);
    expect(deleteVertex(base(), 0, 0)).toBeNull(); // a line keeps at least 2
    const tri = base({
      kind: 'polygon',
      coords: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    expect(deleteVertex(tri, 0, 0)).toBeNull(); // a polygon ring keeps at least 3
    expect(deleteVertex(poly(), 0, 0)?.coords).toHaveLength(3);
    expect(deleteVertex(poly(), 1, 0)).toBeNull(); // the hole is already a triangle
  });

  it('addresses polygon holes as rings 1..n', () => {
    const p = poly();
    expect(getRing(p, 1)).toHaveLength(3);
    const moved = moveVertex(p, 1, 0, [1.5, 1.5]);
    expect(moved.holes[0][0]).toEqual([1.5, 1.5]);
    expect(moved.coords).toEqual(p.coords);
    expect(insertVertex(p, 1, 2, [1, 2]).holes[0]).toHaveLength(4);
  });

  it('points cannot gain vertices', () => {
    const pt = base({ kind: 'point', coords: [[1, 1]] });
    expect(insertVertex(pt, 0, 0, [2, 2])).toBe(pt);
    expect(midpointHandles(pt)).toEqual([]);
    expect(moveVertex(pt, 0, 0, [3, 3]).coords).toEqual([[3, 3]]);
  });

  it('computes midpoint handles: open for lines, wrapping for polygons', () => {
    expect(midpointHandles(base())).toEqual([{ ring: 0, index: 0, pos: [0.5, 0.5] }]);
    const handles = midpointHandles(poly());
    expect(handles).toHaveLength(4 + 3); // outer ring edges + hole edges
    expect(handles.find((h) => h.ring === 0 && h.index === 3)?.pos).toEqual([0, 2]); // wraps to vertex 0
  });

  it('midpoint takes the short way across the antimeridian', () => {
    expect(midpoint([179, 10], [-179, 20])).toEqual([180, 15]);
    expect(Math.abs(midpoint([-170, 0], [170, 0])[0])).toBeCloseTo(180, 9); // -180 and 180 are the same meridian
    expect(midpoint([10, 0], [20, 10])).toEqual([15, 5]);
  });
});

describe('user layer history', () => {
  beforeEach(() => resetUserLayer());
  afterEach(() => vi.useRealTimers());

  it('undoes and redoes add, update, and remove', () => {
    const id = store().add(base({ name: 'A' }));
    store().update(id, { name: 'B' });
    store().remove(id);
    expect(store().features).toEqual([]);
    store().undo();
    expect(store().features[0].name).toBe('B');
    store().undo();
    expect(store().features[0].name).toBe('A');
    store().undo();
    expect(store().features).toEqual([]);
    store().redo();
    store().redo();
    expect(store().features[0].name).toBe('B');
    store().redo();
    expect(store().features).toEqual([]);
  });

  it('a new change after undo clears the redo stack', () => {
    store().add(base());
    store().add(base());
    store().undo();
    expect(store().future).toHaveLength(1);
    store().add(base({ name: 'C' }));
    expect(store().future).toHaveLength(0);
    store().redo(); // nothing to redo
    expect(store().features.map((f) => f.name)).toEqual(['F', 'C']);
  });

  it('keeps at least 50 steps (and caps the history)', () => {
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) store().add(base());
    expect(store().past.length).toBe(HISTORY_LIMIT);
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(50);
    for (let i = 0; i < 60; i++) store().undo();
    expect(store().features.length).toBe(HISTORY_LIMIT + 20 - 60);
  });

  it('coalesces rapid edits to the same field into one undo step', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const id = store().add(base({ name: 'A' }));
    store().update(id, { name: 'Ab' }, `${id}:name`);
    vi.setSystemTime(1_000_200);
    store().update(id, { name: 'Abc' }, `${id}:name`);
    expect(store().features[0].name).toBe('Abc');
    store().undo(); // one step back goes all the way to the original name
    expect(store().features[0].name).toBe('A');
    // After the window, or for another field, a new step starts.
    store().redo();
    vi.setSystemTime(1_000_200 + COALESCE_MS + 1);
    store().update(id, { name: 'Abcd' }, `${id}:name`);
    store().undo();
    expect(store().features[0].name).toBe('Abc');
  });

  it('a vertex drag is a single undo step', () => {
    const id = store().add(base());
    store().beginTransient();
    for (let i = 1; i <= 10; i++) {
      store().setTransient(id, { coords: moveVertex(store().features[0], 0, 1, [i, i]).coords });
    }
    store().endTransient();
    expect(store().features[0].coords[1]).toEqual([10, 10]);
    store().undo();
    expect(store().features[0].coords[1]).toEqual([1, 1]);
    store().redo();
    expect(store().features[0].coords[1]).toEqual([10, 10]);
  });

  it('a drag that changed nothing adds no history', () => {
    store().add(base());
    const before = store().past.length;
    store().beginTransient();
    store().endTransient();
    expect(store().past.length).toBe(before);
  });

  it('addMany is one undo step; undo drops a selection that no longer exists', () => {
    store().addMany([base(), base(), base()]);
    expect(store().features).toHaveLength(3);
    expect(store().selectedId).toBe(3);
    store().undo();
    expect(store().features).toHaveLength(0);
    expect(store().selectedId).toBeNull();
  });

  it('removing the selected feature clears the selection', () => {
    const id = store().add(base());
    expect(store().selectedId).toBe(id);
    store().remove(id);
    expect(store().selectedId).toBeNull();
  });
});
