// The user-drawn layer ("My Places"): features, selection, and undo/redo history. It is drawn
// with the Entity API (small and editable) rather than the batched renderer. Every change goes
// through `commit`, which records a snapshot; rapid edits to the same field are coalesced into
// one undo step, and a vertex drag is a single step via begin/endTransient.
import { create } from 'zustand';

export type UserFeatureKind = 'point' | 'line' | 'polygon';
/** [lon, lat] */
export type Coord = [number, number];

export interface UserStyle {
  /** `#rrggbb` */
  color: string;
  /** Line width in pixels (also the outline width of polygons). */
  width: number;
  /** 0 (no fill) to 1 (opaque); polygons only. */
  fillOpacity: number;
  /** Built-in icon name for points; null for the default marker. */
  icon: BuiltinIcon | null;
  /** Icon size multiplier; points only. */
  scale: number;
}

export const BUILTIN_ICONS = ['circle', 'square', 'diamond', 'triangle', 'star'] as const;
export type BuiltinIcon = (typeof BUILTIN_ICONS)[number];

export const DEFAULT_STYLE: UserStyle = {
  color: '#ff9800',
  width: 3,
  fillOpacity: 0.25,
  icon: null,
  scale: 1,
};

export interface UserFeature {
  id: number;
  name: string;
  kind: UserFeatureKind;
  /** Vertices; polygons are not repeated at the closing vertex. For polygons this is the outer ring. */
  coords: Coord[];
  /** Inner rings (polygons only). */
  holes: Coord[][];
  description: string;
  /** Custom key/value attributes, in display order. */
  attrs: [string, string][];
  style: UserStyle;
  visible: boolean;
}

interface Snapshot {
  features: UserFeature[];
  selectedId: number | null;
}

/** At least 50 steps are kept, per the spec. */
export const HISTORY_LIMIT = 100;
/** Edits to the same field within this window merge into one undo step. */
export const COALESCE_MS = 1000;

interface UserLayerState {
  features: UserFeature[];
  visible: boolean;
  selectedId: number | null;
  past: Snapshot[];
  future: Snapshot[];

  select: (id: number | null) => void;
  setVisible: (visible: boolean) => void;
  add: (f: Omit<UserFeature, 'id'>) => number;
  /** Adds several features as a single undo step. */
  addMany: (fs: Omit<UserFeature, 'id'>[]) => number[];
  update: (id: number, patch: Partial<Omit<UserFeature, 'id'>>, coalesceKey?: string) => void;
  remove: (id: number) => void;
  clear: () => void;
  /** Vertex drags: the feature changes live but the whole drag is one undo step. */
  beginTransient: () => void;
  setTransient: (id: number, patch: Partial<Omit<UserFeature, 'id'>>) => void;
  endTransient: () => void;
  undo: () => void;
  redo: () => void;
}

let nextId = 1;
let lastKey: string | null = null;
let lastAt = 0;
let transientStart: Snapshot | null = null;

export const useUserLayer = create<UserLayerState>((set, get) => {
  /** Records the current state in history (unless coalescing) and applies the new features. */
  const commit = (features: UserFeature[], selectedId: number | null, key?: string) => {
    const s = get();
    const now = Date.now();
    const merge =
      key !== undefined && key === lastKey && now - lastAt < COALESCE_MS && s.past.length > 0;
    lastKey = key ?? null;
    lastAt = now;
    const past = merge
      ? s.past
      : [...s.past, { features: s.features, selectedId: s.selectedId }].slice(-HISTORY_LIMIT);
    set({ features, selectedId, past, future: [] });
  };

  return {
    features: [],
    visible: true,
    selectedId: null,
    past: [],
    future: [],

    select: (id) => set({ selectedId: id }),
    setVisible: (visible) => set({ visible }),

    add: (f) => {
      const id = nextId++;
      commit([...get().features, { ...f, id }], id);
      return id;
    },
    addMany: (fs) => {
      const created = fs.map((f) => ({ ...f, id: nextId++ }));
      commit([...get().features, ...created], created.at(-1)?.id ?? get().selectedId);
      return created.map((f) => f.id);
    },
    update: (id, patch, coalesceKey) => {
      const { features, selectedId } = get();
      if (!features.some((f) => f.id === id)) return;
      commit(
        features.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        selectedId,
        coalesceKey,
      );
    },
    remove: (id) => {
      const { features, selectedId } = get();
      commit(
        features.filter((f) => f.id !== id),
        selectedId === id ? null : selectedId,
      );
    },
    clear: () => commit([], null),

    beginTransient: () => {
      const { features, selectedId } = get();
      transientStart = { features, selectedId };
    },
    setTransient: (id, patch) =>
      set((s) => ({ features: s.features.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
    endTransient: () => {
      const start = transientStart;
      transientStart = null;
      if (!start || start.features === get().features) return;
      lastKey = null;
      set((s) => ({ past: [...s.past, start].slice(-HISTORY_LIMIT), future: [] }));
    },

    undo: () => {
      const { past, future, features, selectedId } = get();
      const prev = past.at(-1);
      if (!prev) return;
      lastKey = null;
      set({
        features: prev.features,
        selectedId: prev.features.some((f) => f.id === selectedId) ? selectedId : prev.selectedId,
        past: past.slice(0, -1),
        future: [...future, { features, selectedId }],
      });
    },
    redo: () => {
      const { past, future, features, selectedId } = get();
      const next = future.at(-1);
      if (!next) return;
      lastKey = null;
      set({
        features: next.features,
        selectedId: next.features.some((f) => f.id === selectedId) ? selectedId : next.selectedId,
        past: [...past, { features, selectedId }],
        future: future.slice(0, -1),
      });
    },
  };
});

/** Resets all state, including history (used by tests and when a project is closed). */
export function resetUserLayer() {
  nextId = 1;
  lastKey = null;
  transientStart = null;
  useUserLayer.setState({ features: [], selectedId: null, past: [], future: [], visible: true });
}
