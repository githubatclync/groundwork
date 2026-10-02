// Zustand store for imported layers, in-flight import jobs, and import errors.
import { create } from 'zustand';
import type { Bounds, FolderNode, LayerManifest, Style, Warning } from '../io/types';

export interface Layer {
  id: string;
  name: string;
  sourcePath: string;
  visible: boolean;
  opacity: number;
  tree: FolderNode;
  styles: Style[];
  bounds: Bounds | null;
  featureCount: number;
  warnings: Warning[];
  editable: boolean;
  manifest: LayerManifest;
  /** Wall-clock time from starting the import until the layer was fully drawn. */
  loadMs?: number;
}

export type JobPhase = 'reading' | 'transferring' | 'rendering';

export interface ImportJob {
  id: number;
  name: string;
  phase: JobPhase;
  /** 0..1 within the rendering phase; ignored for other phases. */
  progress: number;
}

export interface ImportError {
  id: number;
  message: string;
}

export const layerFromManifest = (m: LayerManifest): Layer => ({
  id: m.id,
  name: m.name,
  sourcePath: m.sourcePath,
  visible: true,
  opacity: 1,
  tree: m.tree,
  styles: m.styles,
  bounds: m.bounds,
  featureCount: m.featureCount,
  warnings: m.warnings,
  editable: false,
  manifest: m,
});

interface LayerState {
  layers: Layer[];
  jobs: ImportJob[];
  errors: ImportError[];
  /** The layer shown in the attribute table. */
  activeLayerId: string | null;
  setActiveLayer: (id: string | null) => void;
  setFolderVisible: (layerId: string, folderId: number, visible: boolean) => void;
  setOpacity: (id: string, opacity: number) => void;
  addLayer: (layer: Layer) => void;
  removeLayer: (id: string) => void;
  setVisible: (id: string, visible: boolean) => void;
  setLoadMs: (id: string, ms: number) => void;
  startJob: (name: string) => number;
  updateJob: (id: number, patch: Partial<Pick<ImportJob, 'phase' | 'progress'>>) => void;
  endJob: (id: number) => void;
  addError: (message: string) => void;
  dismissError: (id: number) => void;
}

/** Returns a copy of the tree with one folder's own visibility changed. */
export function withFolderVisible(
  node: FolderNode,
  folderId: number,
  visible: boolean,
): FolderNode {
  return {
    ...node,
    visible: node.id === folderId ? visible : node.visible,
    children: node.children.map((c) => withFolderVisible(c, folderId, visible)),
  };
}

let counter = 0;

export const useLayers = create<LayerState>((set) => ({
  layers: [],
  jobs: [],
  errors: [],
  activeLayerId: null,
  setActiveLayer: (id) => set({ activeLayerId: id }),
  setFolderVisible: (layerId, folderId, visible) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId ? { ...l, tree: withFolderVisible(l.tree, folderId, visible) } : l,
      ),
    })),
  setOpacity: (id, opacity) =>
    set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, opacity } : l)) })),
  addLayer: (layer) => set((s) => ({ layers: [...s.layers, layer], activeLayerId: layer.id })),
  removeLayer: (id) =>
    set((s) => {
      const layers = s.layers.filter((l) => l.id !== id);
      const activeLayerId =
        s.activeLayerId === id ? (layers[layers.length - 1]?.id ?? null) : s.activeLayerId;
      return { layers, activeLayerId };
    }),
  setVisible: (id, visible) =>
    set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, visible } : l)) })),
  setLoadMs: (id, ms) =>
    set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, loadMs: ms } : l)) })),
  startJob: (name) => {
    const id = ++counter;
    set((s) => ({ jobs: [...s.jobs, { id, name, phase: 'reading', progress: 0 }] }));
    return id;
  },
  updateJob: (id, patch) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
  endJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
  addError: (message) => set((s) => ({ errors: [...s.errors, { id: ++counter, message }] })),
  dismissError: (id) => set((s) => ({ errors: s.errors.filter((e) => e.id !== id) })),
}));
