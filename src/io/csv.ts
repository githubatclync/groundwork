// CSV export of the attribute table, and saving the exported PNG, via the native save dialog.
import { invoke } from '@tauri-apps/api/core';
import type { ViewSpec } from './attributes';

export interface CsvReport {
  path: string;
  rows: number;
}

async function chooseSavePath(
  defaultName: string,
  ext: string,
  label: string,
): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const safe = defaultName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';
  const path = await save({
    defaultPath: `${safe}.${ext}`,
    filters: [{ name: label, extensions: [ext] }],
  });
  if (!path) return null;
  return path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`;
}

export const chooseCsvPath = (name: string) => chooseSavePath(name, 'csv', 'CSV');
export const choosePngPath = (name: string) => chooseSavePath(name, 'png', 'PNG image');

/** Exports the rows of `spec`'s view, or every row when `spec` is null. */
export const exportCsv = (layerId: string, spec: ViewSpec | null, path: string) =>
  invoke<CsvReport>('export_csv', { layerId, spec, path });

/** Sends the PNG as a raw binary payload (images are too large for JSON). */
export async function savePng(blob: Blob, path: string): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await invoke('save_png', bytes, { headers: { path: encodeURIComponent(path) } });
}
