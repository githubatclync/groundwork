// Camera helpers.
import { Math as CesiumMath, Rectangle } from 'cesium';
import type { Bounds } from '../io/types';
import { getViewer } from './viewerRegistry';

/** Pads bounds so points and tiny layers get a sensible view, then clamps to valid ranges. */
export function paddedBounds([w, s, e, n]: Bounds, minSpanDeg = 0.01, factor = 0.1): Bounds {
  const dx = Math.max(e - w, minSpanDeg);
  const dy = Math.max(n - s, minSpanDeg);
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const hx = (dx * (1 + factor * 2)) / 2;
  const hy = (dy * (1 + factor * 2)) / 2;
  return [
    Math.max(-180, cx - hx),
    Math.max(-89.9, cy - hy),
    Math.min(180, cx + hx),
    Math.min(89.9, cy + hy),
  ];
}

/** Flies (or, with duration 0, jumps) the camera to show the bounds. */
export function zoomToBounds(bounds: Bounds | null, duration = 1.2) {
  const viewer = getViewer();
  if (!viewer || !bounds) return;
  const [w, s, e, n] = paddedBounds(bounds);
  const destination = Rectangle.fromDegrees(w, s, e, n);
  if (duration <= 0) viewer.camera.setView({ destination });
  else viewer.camera.flyTo({ destination, duration });
}

/** The geographic rectangle the camera currently sees, or null when it can't be determined. */
export function currentViewBounds(): Bounds | null {
  const viewer = getViewer();
  const rect = viewer?.camera.computeViewRectangle();
  if (!rect) return null;
  return [
    CesiumMath.toDegrees(rect.west),
    CesiumMath.toDegrees(rect.south),
    CesiumMath.toDegrees(rect.east),
    CesiumMath.toDegrees(rect.north),
  ];
}

/** Calls `onChange` (debounced) whenever the camera stops moving. Returns an unsubscribe function. */
export function onCameraSettled(onChange: () => void, delayMs = 300): () => void {
  const viewer = getViewer();
  if (!viewer) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const handler = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, delayMs);
  };
  viewer.camera.moveEnd.addEventListener(handler);
  return () => {
    clearTimeout(timer);
    if (!viewer.isDestroyed()) viewer.camera.moveEnd.removeEventListener(handler);
  };
}
