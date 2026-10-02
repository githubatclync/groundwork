// The currently selected feature. `source` records where the selection came from so the other
// side can react appropriately (the table scrolls to globe picks; the camera flies to table picks).
import { create } from 'zustand';

export type SelectionSource = 'globe' | 'table';

export interface Selection {
  layerId: string;
  featureId: number;
  source: SelectionSource;
}

interface SelectionState {
  selection: Selection | null;
  select: (layerId: string, featureId: number, source: SelectionSource) => void;
  clear: () => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selection: null,
  select: (layerId, featureId, source) => set({ selection: { layerId, featureId, source } }),
  clear: () => set({ selection: null }),
}));
