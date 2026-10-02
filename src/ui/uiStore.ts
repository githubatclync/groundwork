// Layout state: the attribute table drawer and the feature details panel.
import { create } from 'zustand';

interface UiState {
  tableOpen: boolean;
  /** Height of the table drawer in CSS pixels. */
  tableHeight: number;
  detailsOpen: boolean;
  setTableOpen: (open: boolean) => void;
  setTableHeight: (px: number) => void;
  setDetailsOpen: (open: boolean) => void;
}

export const TABLE_MIN_HEIGHT = 120;

export const useUi = create<UiState>((set) => ({
  tableOpen: false,
  tableHeight: 280,
  detailsOpen: false,
  setTableOpen: (tableOpen) => set({ tableOpen }),
  setTableHeight: (px) => set({ tableHeight: Math.max(TABLE_MIN_HEIGHT, Math.round(px)) }),
  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
}));
