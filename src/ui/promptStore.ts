// Promise-based prompts that dialogs resolve: asking the user to locate a missing project file,
// and confirming the latitude/longitude columns of a CSV. Callers `await` the answer.
import { create } from 'zustand';
import type { CsvInspection } from '../io/import';

export interface CsvChoice {
  latCol: number;
  lonCol: number;
}

interface PromptState {
  locate: { path: string; resolve: (located: string | null) => void } | null;
  csv: {
    path: string;
    inspection: CsvInspection;
    resolve: (choice: CsvChoice | null) => void;
  } | null;
  /** Resolves to the located file's path, or null if the user skips it. */
  askLocate: (missingPath: string) => Promise<string | null>;
  /** Resolves to the confirmed columns, or null if the user cancels. */
  askCsv: (path: string, inspection: CsvInspection) => Promise<CsvChoice | null>;
  closeLocate: () => void;
  closeCsv: () => void;
}

export const usePrompts = create<PromptState>((set) => ({
  locate: null,
  csv: null,
  askLocate: (path) => new Promise((resolve) => set({ locate: { path, resolve } })),
  askCsv: (path, inspection) =>
    new Promise((resolve) => set({ csv: { path, inspection, resolve } })),
  closeLocate: () => set({ locate: null }),
  closeCsv: () => set({ csv: null }),
}));
