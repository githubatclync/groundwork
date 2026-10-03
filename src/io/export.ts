// Calls into the Rust exporters and the native save dialog, plus conversion between the user
// layer's features and the DTOs the exporters use.
import { invoke } from '@tauri-apps/api/core';
import type {
  UserFeature,
  UserFeatureKind,
  UserStyle,
  BuiltinIcon,
} from '../layers/userLayerStore';

export type ExportFormatId = 'kmz' | 'kml' | 'geojson';

export const EXPORT_FORMATS: { id: ExportFormatId; label: string; note: string }[] = [
  { id: 'kmz', label: 'KMZ', note: 'Google Earth; bundles icons and overlay images' },
  {
    id: 'kml',
    label: 'KML',
    note: 'Google Earth; custom icons and overlay images are not included',
  },
  { id: 'geojson', label: 'GeoJSON', note: 'Geometry and attributes only (no styles)' },
];

export interface ExportReport {
  path: string;
  features: number;
  notes: string[];
}

interface UserFeatureDto {
  name: string;
  description: string;
  kind: UserFeatureKind;
  coords: [number, number][];
  holes: [number, number][][];
  attrs: [string, string][];
  style: UserStyle;
  visible: boolean;
}

export const toDto = (f: UserFeature): UserFeatureDto => ({
  name: f.name,
  description: f.description,
  kind: f.kind,
  coords: f.coords,
  holes: f.holes,
  attrs: f.attrs,
  style: f.style,
  visible: f.visible,
});

/** Features as they come back from "Make editable copy" (no ids yet). */
export type NewUserFeature = Omit<UserFeature, 'id'>;

export const fromDto = (
  d: UserFeatureDto & { style: UserStyle & { icon: BuiltinIcon | null } },
): NewUserFeature => ({
  ...d,
});

/** Asks where to save; returns the chosen path (with the format's extension), or null if cancelled. */
export async function chooseExportPath(
  defaultName: string,
  format: ExportFormatId,
): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const info = EXPORT_FORMATS.find((f) => f.id === format) as (typeof EXPORT_FORMATS)[number];
  const safe = defaultName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'layer';
  const path = await save({
    defaultPath: `${safe}.${format}`,
    filters: [{ name: info.label, extensions: [format] }],
  });
  if (!path) return null;
  return path.toLowerCase().endsWith(`.${format}`) ? path : `${path}.${format}`;
}

export const exportImportedLayer = (layerId: string, path: string) =>
  invoke<ExportReport>('export_layer_file', { layerId, path });

export const exportUserLayer = (name: string, features: UserFeature[], path: string) =>
  invoke<ExportReport>('export_user_layer', { name, features: features.map(toDto), path });

export const layerToUser = (layerId: string) =>
  invoke<UserFeatureDto[]>('layer_to_user', { layerId }).then((list) => list.map(fromDto));
