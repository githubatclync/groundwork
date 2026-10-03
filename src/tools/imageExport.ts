// Renders the current view to a PNG with optional overlays. The attribution is always drawn.
// While capturing, editing chrome (vertex handles, selection highlight) is hidden and restored.
import { captureView, metersPerCssPixel } from '../globe/capture';
import { getViewer } from '../globe/viewerRegistry';
import { useLayers } from '../layers/layerStore';
import { useUserLayer } from '../layers/userLayerStore';
import { useSelection } from '../selection/selectionStore';
import { resolveActiveBasemap, selectKeys, useSettings } from '../settings/settingsStore';
import {
  layerLegendEntries,
  niceScaleBar,
  userLegendEntries,
  type LegendEntry,
} from './imageExportLayout';
import { drawOverlays } from './overlayDraw';
import { useTool } from './toolStore';

export type ImageScale = 1 | 2 | 4;

export interface ImageExportOptions {
  scale: ImageScale;
  title: string;
  scaleBar: boolean;
  northArrow: boolean;
  legend: boolean;
}

export interface RenderedImage {
  blob: Blob;
  width: number;
  height: number;
  /** The scale actually used; lower than requested when the GPU could not hold the full size. */
  effectiveScale: number;
  clamped: boolean;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
/** Longest scale bar, in CSS pixels. */
const MAX_BAR_CSS_PX = 160;

export function basemapAttribution(): string {
  const s = useSettings.getState();
  return resolveActiveBasemap(s.basemapId, s.mbtiles, selectKeys(s)).attribution;
}

function legendEntries(): LegendEntry[] {
  const layers = useLayers.getState().layers.map((l) => ({
    name: l.name,
    visible: l.visible,
    styles: l.styles,
    geometryCounts: l.manifest.geometryCounts,
  }));
  const user = useUserLayer.getState();
  return [...layerLegendEntries(layers), ...userLegendEntries(user.features, user.visible)];
}

export async function renderExportImage(
  opts: ImageExportOptions,
  onStatus: (message: string) => void,
): Promise<RenderedImage> {
  const viewer = getViewer();
  if (!viewer) throw new Error('The globe is not ready');

  // Hide editing chrome for the capture; restore it afterwards.
  const tool = useTool.getState().tool;
  const userSelected = useUserLayer.getState().selectedId;
  const selection = useSelection.getState().selection;
  try {
    if (tool === 'edit') useTool.getState().setTool('none');
    useUserLayer.getState().select(null);
    useSelection.getState().clear();
    await nextFrame();
    await nextFrame();

    const unitSystem = useSettings.getState().unitSystem;
    const mpp = opts.scaleBar ? metersPerCssPixel(viewer) : null;
    const bar = mpp ? niceScaleBar(mpp * MAX_BAR_CSS_PX, unitSystem) : null;

    const cap = await captureView(viewer, opts.scale, onStatus);
    onStatus('Adding overlays…');
    const ctx = cap.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the image canvas');
    drawOverlays(ctx, cap.canvas.width, cap.canvas.height, cap.k, {
      title: opts.title,
      scaleBar: bar && mpp ? { ...bar, lengthCssPx: bar.lengthM / mpp } : null,
      headingRad: opts.northArrow ? viewer.camera.heading : null,
      legend: opts.legend ? legendEntries() : [],
      attribution: basemapAttribution(),
    });

    const blob = await new Promise<Blob>((resolve, reject) =>
      cap.canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode the PNG'))),
        'image/png',
      ),
    );
    return {
      blob,
      width: cap.canvas.width,
      height: cap.canvas.height,
      effectiveScale: cap.size.effectiveScale,
      clamped: cap.size.clamped,
    };
  } finally {
    useTool.getState().setTool(tool);
    useUserLayer.getState().select(userSelected);
    if (selection)
      useSelection.getState().select(selection.layerId, selection.featureId, selection.source);
  }
}
