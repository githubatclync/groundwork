// The marker dropped by a search (coordinates or a place), shown until the next search or Escape.
import { create } from 'zustand';

export interface SearchMarker {
  lon: number;
  lat: number;
  label: string;
}

interface SearchState {
  marker: SearchMarker | null;
  setMarker: (m: SearchMarker | null) => void;
}

export const useSearch = create<SearchState>((set) => ({
  marker: null,
  setMarker: (marker) => set({ marker }),
}));
