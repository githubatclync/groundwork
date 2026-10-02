// The user-drawn layer ("My Places"). It uses the Entity API (small, editable) rather than the
// batched renderer. M4 only adds features (from measurements); drawing, editing, undo/redo, and
// saving to KML/KMZ arrive in M5.
import { create } from 'zustand';

export type UserFeatureKind = 'point' | 'line' | 'polygon';

export interface UserFeature {
  id: number;
  name: string;
  kind: UserFeatureKind;
  /** [lon, lat] vertices; polygons are not repeated at the closing vertex. */
  coords: [number, number][];
  description: string;
  /** Custom key/value attributes (e.g. measured length and area). */
  attrs: Record<string, string>;
}

interface UserLayerState {
  features: UserFeature[];
  visible: boolean;
  addFeature: (f: Omit<UserFeature, 'id'>) => number;
  removeFeature: (id: number) => void;
  clear: () => void;
  setVisible: (visible: boolean) => void;
}

let nextId = 1;

export const useUserLayer = create<UserLayerState>((set) => ({
  features: [],
  visible: true,
  addFeature: (f) => {
    const id = nextId++;
    set((s) => ({ features: [...s.features, { ...f, id }] }));
    return id;
  },
  removeFeature: (id) => set((s) => ({ features: s.features.filter((f) => f.id !== id) })),
  clear: () => set({ features: [] }),
  setVisible: (visible) => set({ visible }),
}));
