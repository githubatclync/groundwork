// Holds the single Cesium viewer so non-React code (the layer manager) can reach it.
// Cesium-specific, so it lives in globe/.
import type { Viewer } from 'cesium';

let current: Viewer | null = null;
let waiters: ((v: Viewer) => void)[] = [];

export const setViewer = (v: Viewer | null) => {
  current = v;
  if (v) {
    waiters.forEach((w) => w(v));
    waiters = [];
  }
};

export const getViewer = (): Viewer | null => (current && !current.isDestroyed() ? current : null);

/** Resolves once the viewer exists (immediately if it already does). */
export const whenViewerReady = (): Promise<Viewer> => {
  const v = getViewer();
  return v ? Promise.resolve(v) : new Promise((resolve) => waiters.push(resolve));
};
