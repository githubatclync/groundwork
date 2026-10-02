// State of the measurement in progress (or just finished): clicked points, a live cursor point
// for the rubber band, and whether the measurement is complete.
import { create } from 'zustand';
import type { LonLat } from './geodesy';
import { MIN_POINTS, type MeasureMode } from './measure';

interface MeasureState {
  points: LonLat[];
  cursor: LonLat | null;
  finished: boolean;
  /** Adds a clicked point; distance measurements finish at two points. */
  addPoint: (mode: MeasureMode, p: LonLat) => void;
  /** Removes the last point (used to drop the extra click of a double-click). */
  popPoint: () => void;
  setCursor: (p: LonLat | null) => void;
  /** Finishes the measurement if it has enough points; returns whether it did. */
  finish: (mode: MeasureMode) => boolean;
  reset: () => void;
}

export const useMeasure = create<MeasureState>((set, get) => ({
  points: [],
  cursor: null,
  finished: false,
  addPoint: (mode, p) => {
    // A click after a finished measurement starts a new one.
    const base = get().finished ? [] : get().points;
    const points = [...base, p];
    set({
      points,
      cursor: null,
      finished: points.length >= MIN_POINTS[mode] && mode === 'distance',
    });
  },
  popPoint: () => set((s) => ({ points: s.points.slice(0, -1) })),
  setCursor: (cursor) => set({ cursor }),
  finish: (mode) => {
    if (get().points.length < MIN_POINTS[mode]) return false;
    set({ finished: true, cursor: null });
    return true;
  },
  reset: () => set({ points: [], cursor: null, finished: false }),
}));
