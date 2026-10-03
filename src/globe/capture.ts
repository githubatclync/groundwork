// Captures the globe at a higher resolution. The viewer's resolution scale is raised so the whole
// scene (imagery, geometry, point sizes) renders at that many times the screen resolution, then
// the frame is copied out in the same task as the render (so no preserveDrawingBuffer is needed).
// If the GPU cannot hold the requested size the scale is reduced; see tools/imageExportLayout.
import * as Cesium from 'cesium';
import { Cartesian2, type Viewer } from 'cesium';
import { inverse } from '../tools/geodesy';
import { DEFAULT_LIMITS, outputSize, type OutputSize } from '../tools/imageExportLayout';
import { lonLatAt } from './lonLat';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export interface Capture {
  canvas: HTMLCanvasElement;
  /** Output pixels per CSS pixel. */
  k: number;
  size: OutputSize;
}

/**
 * Cesium interop shim: ContextLimits is exported at runtime (it holds the real GPU limits) but is
 * missing from the published typings.
 */
const ContextLimits = (
  Cesium as unknown as {
    ContextLimits: {
      maximumRenderbufferSize: number;
      maximumViewportWidth: number;
      maximumViewportHeight: number;
    };
  }
).ContextLimits;

/** What the GPU can render, as limits for outputSize(). */
export function gpuLimits() {
  return {
    maxDim: Math.min(
      DEFAULT_LIMITS.maxDim,
      ContextLimits.maximumRenderbufferSize,
      ContextLimits.maximumViewportWidth,
      ContextLimits.maximumViewportHeight,
    ),
    maxPixels: DEFAULT_LIMITS.maxPixels,
  };
}

export function previewSize(viewer: Viewer, scale: number): OutputSize {
  const c = viewer.canvas;
  return outputSize(
    c.clientWidth,
    c.clientHeight,
    window.devicePixelRatio || 1,
    scale,
    gpuLimits(),
  );
}

/** Meters on the ground per CSS pixel near the bottom of the view, or null when over empty space. */
export function metersPerCssPixel(viewer: Viewer): number | null {
  const c = viewer.canvas;
  const y = Math.max(0, c.clientHeight - 60);
  const x = c.clientWidth / 2;
  const span = 100;
  const a = lonLatAt(viewer, new Cartesian2(x - span / 2, y));
  const b = lonLatAt(viewer, new Cartesian2(x + span / 2, y));
  if (!a || !b) return null;
  const d = inverse({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] }).distanceM;
  return d > 0 ? d / span : null;
}

export async function captureView(
  viewer: Viewer,
  scale: number,
  onStatus: (message: string) => void,
): Promise<Capture> {
  const size = previewSize(viewer, scale);
  const previousScale = viewer.resolutionScale;
  try {
    viewer.resolutionScale = size.effectiveScale;
    viewer.resize();
    onStatus('Loading map detail…');
    // Higher resolution needs finer imagery tiles; wait (bounded) for them to arrive.
    const deadline = performance.now() + 45_000;
    let settled = 0;
    while (performance.now() < deadline && settled < 5) {
      await nextFrame();
      settled = viewer.scene.globe.tilesLoaded ? settled + 1 : 0;
    }
    onStatus('Rendering…');
    const out = document.createElement('canvas');
    out.width = viewer.scene.canvas.width;
    out.height = viewer.scene.canvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('Could not create the image canvas');
    // Render and copy in the same task: the WebGL buffer is only guaranteed valid right now.
    viewer.scene.render();
    ctx.drawImage(viewer.scene.canvas, 0, 0);
    return { canvas: out, k: out.width / viewer.canvas.clientWidth, size };
  } finally {
    viewer.resolutionScale = previousScale;
    viewer.resize();
  }
}
