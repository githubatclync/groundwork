// The active tool. Switching tools abandons any measurement in progress.
import { create } from 'zustand';
import type { MeasureMode } from './measure';
import { useMeasure } from './measureStore';

export type Tool =
  | 'none'
  | 'measure-distance'
  | 'measure-path'
  | 'measure-area'
  | 'draw-point'
  | 'draw-line'
  | 'draw-polygon'
  | 'edit';

interface ToolState {
  tool: Tool;
  setTool: (tool: Tool) => void;
}

export const useTool = create<ToolState>((set, get) => ({
  tool: 'none',
  setTool: (tool) => {
    if (tool === get().tool) return;
    useMeasure.getState().reset();
    set({ tool });
  },
}));

/** The measurement mode of a tool, or null when it is not a measure tool. */
export function measureModeOf(tool: Tool): MeasureMode | null {
  switch (tool) {
    case 'measure-distance':
      return 'distance';
    case 'measure-path':
      return 'path';
    case 'measure-area':
      return 'area';
    default:
      return null;
  }
}
