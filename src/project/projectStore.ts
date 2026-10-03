// The project file currently open (null for an unsaved workspace).
import { create } from 'zustand';

interface ProjectState {
  path: string | null;
  setPath: (path: string | null) => void;
}

export const useProject = create<ProjectState>((set) => ({
  path: null,
  setPath: (path) => set({ path }),
}));
