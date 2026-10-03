// Saving and opening projects. Opening replaces the workspace: layers are re-imported from their
// source files (a missing file triggers a "locate" prompt), then visibility, opacity, folder
// states, the user layer, the camera, and the basemap are restored.
import { invoke } from '@tauri-apps/api/core';
import { cameraState, setCameraState } from '../globe/camera';
import { openFile, removeAllLayers } from '../layers/layerManager';
import { useLayers } from '../layers/layerStore';
import { useUserLayer } from '../layers/userLayerStore';
import { useSelection } from '../selection/selectionStore';
import { useSettings } from '../settings/settingsStore';
import { useMeasure } from '../tools/measureStore';
import { useTool } from '../tools/toolStore';
import { usePrompts } from '../ui/promptStore';
import { basename } from './paths';
import {
  PROJECT_SUFFIX,
  buildProject,
  geoJsonToUserFeatures,
  parseProject,
  sourcePathOf,
} from './projectFile';
import { useProject } from './projectStore';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fail = (e: unknown) => useLayers.getState().addError(message(e));

const fileExists = (path: string) => invoke<boolean>('file_exists', { path });
const readText = (path: string) => invoke<string>('read_text_file', { path });
const writeText = (path: string, contents: string) =>
  invoke<void>('write_text_file', { path, contents });

async function chooseProjectPath(): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const current = useProject.getState().path;
  const path = await save({
    defaultPath: current ? basename(current) : `Project${PROJECT_SUFFIX}`,
    filters: [{ name: 'Groundwork project', extensions: ['json'] }],
  });
  if (!path) return null;
  return path.toLowerCase().endsWith(PROJECT_SUFFIX)
    ? path
    : path.replace(/\.json$/i, '') + PROJECT_SUFFIX;
}

/** Saves the workspace. With `saveAs` (or no current project) asks where. Returns true on success. */
export async function saveProject(saveAs = false): Promise<boolean> {
  try {
    const known = useProject.getState().path;
    const path = !saveAs && known ? known : await chooseProjectPath();
    if (!path) return false;
    const settings = useSettings.getState();
    const user = useUserLayer.getState();
    const project = buildProject({
      projectPath: path,
      layers: useLayers
        .getState()
        .layers.filter((l) => !l.derived)
        .map((l) => ({
          sourcePath: l.sourcePath,
          name: l.name,
          visible: l.visible,
          opacity: l.opacity,
          tree: l.tree,
          csv: l.csv,
        })),
      camera: cameraState(),
      basemapId: settings.basemapId,
      userFeatures: user.features,
      userLayerVisible: user.visible,
    });
    await writeText(path, JSON.stringify(project, null, 2));
    useProject.getState().setPath(path);
    await settings.addRecentProject(path);
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

/** Empties the workspace: layers, drawn features, selection, and any tool in progress. */
export function clearWorkspace() {
  useTool.getState().setTool('none');
  useMeasure.getState().reset();
  useSelection.getState().clear();
  removeAllLayers();
  useUserLayer.getState().load([], true);
}

function workspaceIsEmpty(): boolean {
  return useLayers.getState().layers.length === 0 && useUserLayer.getState().features.length === 0;
}

async function confirmReplace(): Promise<boolean> {
  if (workspaceIsEmpty()) return true;
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask('Opening a project replaces the layers and drawn features currently open. Continue?', {
    title: 'Open project',
    kind: 'warning',
  });
}

/** Opens a `.groundwork.json` project. */
export async function openProject(path: string): Promise<void> {
  let project;
  try {
    project = parseProject(await readText(path));
  } catch (e) {
    fail(e);
    void useSettings.getState().removeRecentProject(path);
    return;
  }
  if (!(await confirmReplace())) return;

  clearWorkspace();
  useProject.getState().setPath(path);

  for (const entry of project.layers) {
    let source = sourcePathOf(path, entry);
    if (!(await fileExists(source))) {
      const located = await usePrompts.getState().askLocate(source);
      if (!located) continue;
      source = located;
    }
    const id = await openFile(source, { csv: entry.csv });
    if (!id) continue;
    const layers = useLayers.getState();
    layers.setVisible(id, entry.visible);
    layers.setOpacity(id, entry.opacity);
    layers.applyFolderStates(id, entry.folders);
    if (entry.name) layers.patchLayer(id, { name: entry.name });
  }

  useUserLayer.getState().load(geoJsonToUserFeatures(project.userLayer), project.userLayerVisible);
  if (project.camera) setCameraState(project.camera);
  await useSettings.getState().update({ basemapId: project.basemapId });
  await useSettings.getState().addRecentProject(path);
}
