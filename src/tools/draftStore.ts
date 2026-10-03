// The line or polygon being drawn: clicked points plus a live cursor point for the rubber band.
import { create } from 'zustand';
import type { Coord } from '../layers/userLayerStore';

interface DraftState {
  points: Coord[];
  cursor: Coord | null;
  addPoint: (p: Coord) => void;
  /** Removes the last point (the extra click of a double-click). */
  popPoint: () => void;
  setCursor: (p: Coord | null) => void;
  reset: () => void;
}

export const useDraft = create<DraftState>((set) => ({
  points: [],
  cursor: null,
  addPoint: (p) => set((s) => ({ points: [...s.points, p], cursor: null })),
  popPoint: () => set((s) => ({ points: s.points.slice(0, -1) })),
  setCursor: (cursor) => set({ cursor }),
  reset: () => set({ points: [], cursor: null }),
}));

export type DrawKind = 'point' | 'line' | 'polygon';

/** Fewest points a drawn feature needs before it can be finished. */
export const DRAW_MIN_POINTS: Record<DrawKind, number> = { point: 1, line: 2, polygon: 3 };

export function drawKindOf(tool: string): DrawKind | null {
  switch (tool) {
    case 'draw-point':
      return 'point';
    case 'draw-line':
      return 'line';
    case 'draw-polygon':
      return 'polygon';
    default:
      return null;
  }
}
