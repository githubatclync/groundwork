// Orchestrates opening files: Rust import -> binary geometry -> batched Cesium rendering.
// Keeps one LayerRenderer per layer in sync with the layer store (visibility, removal) and
// rebuilds renderers when terrain availability changes.
import { whenViewerReady } from '../globe/viewerRegistry';
import { zoomToBounds } from '../globe/camera';
import { useStatus } from '../globe/statusStore';
import { fetchGeometry, importCsvFile, importFile, removeLayerData } from '../io/import';
import { useSelection } from '../selection/selectionStore';
import { useUi } from '../ui/uiStore';
import { layerFromManifest, useLayers } from './layerStore';
import { LayerRenderer } from './renderers/LayerRenderer';

const renderers = new Map<string, LayerRenderer>();

// Slider drags fire many opacity changes; apply at most one per animation frame per layer.
const opacityFrames = new Map<string, number>();
function scheduleOpacity(id: string, opacity: number) {
  if (opacityFrames.has(id)) cancelAnimationFrame(opacityFrames.get(id) as number);
  opacityFrames.set(
    id,
    requestAnimationFrame(() => {
      opacityFrames.delete(id);
      renderers.get(id)?.setOpacity(opacity);
    }),
  );
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Opens files one after another so the UI shows steady progress and memory stays bounded. */
export async function openFiles(paths: string[]): Promise<void> {
  for (const path of paths) await openFile(path);
}

export interface OpenOptions {
  /** Latitude/longitude columns for a CSV file (already confirmed by the user or a project). */
  csv?: { latCol: number; lonCol: number };
  /** Set for layers created from a parent's NetworkLink. */
  derivedFrom?: string;
  /** Display name from the NetworkLink. */
  linkName?: string;
  depth?: number;
  /** Files already opened in this chain, so link cycles stop. */
  visited?: Set<string>;
}

/** How many levels of NetworkLinks are followed. */
export const MAX_LINK_DEPTH = 3;

const pathKey = (p: string) => p.replace(/\\/g, '/').toLowerCase();

/**
 * Imports one file and draws it. Local NetworkLinks inside it are opened afterwards as child
 * layers. Returns the new layer's id, or null if the import failed (an error is shown).
 */
export async function openFile(path: string, opts: OpenOptions = {}): Promise<string | null> {
  const store = useLayers.getState();
  const job = store.startJob(fileName(path));
  const started = performance.now();
  let layerId: string | null = null;
  let links: { name: string; path: string }[] = [];
  let parentName = '';
  try {
    const viewer = await whenViewerReady();

    const manifest = opts.csv
      ? await importCsvFile(path, opts.csv.latCol, opts.csv.lonCol)
      : await importFile(path);
    store.updateJob(job, { phase: 'transferring' });
    const geometry = await fetchGeometry(manifest.id);

    store.updateJob(job, { phase: 'rendering', progress: 0 });
    const renderer = new LayerRenderer(viewer, manifest, geometry);
    renderers.set(manifest.id, renderer);
    const layer = layerFromManifest(manifest);
    if (opts.csv) layer.csv = opts.csv;
    if (opts.derivedFrom) {
      layer.derived = true;
      layer.name = `${opts.derivedFrom} › ${opts.linkName || manifest.name}`;
    }
    store.addLayer(layer);
    if (useLayers.getState().layers.length === 1) useUi.getState().setTableOpen(true);
    // For the first layer, jump to it before drawing so the right level of detail is built first.
    if (useLayers.getState().layers.length === 1) zoomToBounds(manifest.bounds, 0);
    await renderer.build({
      terrain: useStatus.getState().terrainLoaded,
      onProgress: (progress) => useLayers.getState().updateJob(job, { progress }),
    });
    useLayers.getState().setLoadMs(manifest.id, Math.round(performance.now() - started));
    layerId = manifest.id;
    links = manifest.links;
    parentName = manifest.name;
  } catch (e) {
    useLayers.getState().addError(message(e));
  } finally {
    useLayers.getState().endJob(job);
  }

  // Child layers for local NetworkLinks (guarded against cycles and runaway nesting).
  if (layerId && links.length > 0) {
    const depth = opts.depth ?? 0;
    const visited = opts.visited ?? new Set<string>();
    visited.add(pathKey(path));
    for (const link of links) {
      const key = pathKey(link.path);
      if (depth >= MAX_LINK_DEPTH || visited.has(key)) continue;
      visited.add(key);
      await openFile(link.path, {
        derivedFrom: parentName,
        linkName: link.name,
        depth: depth + 1,
        visited,
      });
    }
  }
  return layerId;
}

/** Removes every layer (used when opening a project). */
export function removeAllLayers() {
  for (const l of [...useLayers.getState().layers]) removeLayer(l.id);
}

/** Removes a layer from the store, the scene, and the Rust side. */
export function removeLayer(id: string) {
  if (useSelection.getState().selection?.layerId === id) useSelection.getState().clear();
  useLayers.getState().removeLayer(id);
}

/** Wires store changes to renderers. Call once at startup; returns an unsubscribe function. */
export function startLayerManager(): () => void {
  const unsubLayers = useLayers.subscribe((state, prev) => {
    const ids = new Set(state.layers.map((l) => l.id));
    for (const [id, r] of renderers) {
      if (!ids.has(id)) {
        r.destroy();
        renderers.delete(id);
        void removeLayerData(id).catch(() => undefined);
      }
    }
    for (const layer of state.layers) {
      const before = prev.layers.find((l) => l.id === layer.id);
      const renderer = renderers.get(layer.id);
      if (before?.visible !== layer.visible) renderer?.setVisible(layer.visible);
      if (before && before.tree !== layer.tree) renderer?.applyVisibility(layer.tree);
      if (before && before.opacity !== layer.opacity) scheduleOpacity(layer.id, layer.opacity);
    }
  });
  // Highlight the selected feature in its layer.
  const unsubSelection = useSelection.subscribe((state, prev) => {
    const a = prev.selection;
    const b = state.selection;
    if (a && (!b || a.layerId !== b.layerId)) renderers.get(a.layerId)?.setHighlight(null);
    if (b) renderers.get(b.layerId)?.setHighlight(b.featureId);
  });
  // Clamped geometry is drawn differently with real terrain, so rebuild when it appears/disappears.
  const unsubTerrain = useStatus.subscribe((state, prev) => {
    if (state.terrainLoaded === prev.terrainLoaded) return;
    for (const r of renderers.values()) void r.build({ terrain: state.terrainLoaded });
  });
  return () => {
    unsubLayers();
    unsubTerrain();
    unsubSelection();
  };
}
