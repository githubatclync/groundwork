// The single entry point for "open these files": routes projects, CSV files (which need a column
// confirmation), and everything else to the right importer.
import { inspectCsv } from '../io/import';
import { isProjectPath } from '../project/projectFile';
import { openProject } from '../project/projectManager';
import { usePrompts } from '../ui/promptStore';
import { openFile } from './layerManager';
import { useLayers } from './layerStore';

async function openCsv(path: string): Promise<void> {
  try {
    const inspection = await inspectCsv(path);
    const choice = await usePrompts.getState().askCsv(path, inspection);
    if (choice) await openFile(path, { csv: choice });
  } catch (e) {
    useLayers.getState().addError(e instanceof Error ? e.message : String(e));
  }
}

export async function openPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    if (isProjectPath(path)) await openProject(path);
    else if (/\.csv$/i.test(path)) await openCsv(path);
    else await openFile(path);
  }
}
