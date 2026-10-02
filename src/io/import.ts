// Calls into the Rust importer, the native file picker, and window drag-and-drop.
import { invoke } from '@tauri-apps/api/core';
import { decodeGeometry, type GeometryBuffer } from './geometry';
import type { LayerManifest } from './types';

export const GEODATA_EXTENSIONS = ['kml', 'kmz', 'geojson', 'json', 'gpx'];

export const importFile = (path: string) => invoke<LayerManifest>('import_file', { path });

export async function fetchGeometry(layerId: string): Promise<GeometryBuffer> {
  const bytes = await invoke<ArrayBuffer>('get_geometry', { layerId });
  return decodeGeometry(bytes);
}

export const getLaunchFiles = () =>
  '__TAURI_INTERNALS__' in window ? invoke<string[]>('get_launch_files') : Promise.resolve([]);

export const removeLayerData = (layerId: string) => invoke<void>('remove_layer', { layerId });

/** Opens the native file picker; resolves to the chosen paths (empty if cancelled). */
export async function pickGeodataFiles(): Promise<string[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: true,
    filters: [{ name: 'Geodata', extensions: GEODATA_EXTENSIONS }],
  });
  return Array.isArray(result) ? result : typeof result === 'string' ? [result] : [];
}

/** Listens for files dropped on the window. Returns an unsubscribe function. */
export async function listenForDrops(
  onDrop: (paths: string[]) => void,
  onHover: (hovering: boolean) => void,
): Promise<() => void> {
  if (!('__TAURI_INTERNALS__' in window)) return () => undefined;
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === 'enter' || p.type === 'over') onHover(true);
    else if (p.type === 'leave') onHover(false);
    else if (p.type === 'drop') {
      onHover(false);
      onDrop(p.paths);
    }
  });
}
