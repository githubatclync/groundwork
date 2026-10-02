// Live globe status shown in the status bar: cursor position, elevation, camera altitude, FPS.
import { create } from 'zustand';

interface StatusState {
  cursor: { lat: number; lon: number } | null;
  /** Meters above the ellipsoid under the cursor; null when no terrain is loaded. */
  elevation: number | null;
  cameraHeight: number | null;
  fps: number | null;
  terrainLoaded: boolean;
  /** Non-fatal globe problem (e.g. a bad token) shown in the status bar. */
  notice: string | null;
  set: (patch: Partial<Omit<StatusState, 'set'>>) => void;
}

export const useStatus = create<StatusState>((set) => ({
  cursor: null,
  elevation: null,
  cameraHeight: null,
  fps: null,
  terrainLoaded: false,
  notice: null,
  set: (patch) => set(patch),
}));
