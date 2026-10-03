// Layout state: the attribute table drawer, the feature details panel, and which modal dialog
// (if any) is open.
import { create } from 'zustand';

export type DialogId = 'settings' | 'export' | 'image' | 'shortcuts';

interface UiState {
  tableOpen: boolean;
  /** Height of the table drawer in CSS pixels. */
  tableHeight: number;
  detailsOpen: boolean;
  dialog: DialogId | null;
  setTableOpen: (open: boolean) => void;
  setTableHeight: (px: number) => void;
  setDetailsOpen: (open: boolean) => void;
  setDialog: (dialog: DialogId | null) => void;
}

export const TABLE_MIN_HEIGHT = 120;

export const useUi = create<UiState>((set) => ({
  tableOpen: false,
  tableHeight: 280,
  detailsOpen: false,
  dialog: null,
  setTableOpen: (tableOpen) => set({ tableOpen }),
  setTableHeight: (px) => set({ tableHeight: Math.max(TABLE_MIN_HEIGHT, Math.round(px)) }),
  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
  setDialog: (dialog) => set({ dialog }),
}));
