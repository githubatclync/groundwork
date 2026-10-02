// Thin wrappers over the Rust MBTiles commands and the native file picker.
import { invoke } from '@tauri-apps/api/core';
import type { MbtilesEntry } from '../globe/basemaps';

interface MbtilesInfo {
  id: string;
  name: string;
  format: string;
  minZoom: number;
  maxZoom: number;
  attribution: string | null;
  bounds: [number, number, number, number] | null;
}

export async function openMbtiles(path: string): Promise<MbtilesEntry> {
  const info = await invoke<MbtilesInfo>('open_mbtiles', { path });
  return {
    path,
    runtimeId: info.id,
    name: info.name,
    attribution: info.attribution ?? undefined,
    minZoom: info.minZoom,
    maxZoom: info.maxZoom,
    bounds: info.bounds ?? undefined,
  };
}

export async function closeMbtiles(runtimeId: string): Promise<void> {
  await invoke('close_mbtiles', { id: runtimeId });
}

/** Asks the user for a .mbtiles file; resolves to null when cancelled. */
export async function pickMbtilesFile(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: false,
    filters: [{ name: 'MBTiles', extensions: ['mbtiles'] }],
  });
  return typeof result === 'string' ? result : null;
}
