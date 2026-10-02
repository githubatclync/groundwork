// Calls into the Rust attribute engine (paged, sorted, filtered rows; feature details).
import { invoke } from '@tauri-apps/api/core';
import type { Bounds } from './types';

export interface SortSpec {
  column: string;
  desc: boolean;
}

export type FilterOp = 'contains' | 'eq' | 'gt' | 'lt';

export interface ColumnFilter {
  column: string;
  op: FilterOp;
  value: string;
}

/** Which rows the table shows and in what order; evaluated in Rust. */
export interface ViewSpec {
  sort: SortSpec | null;
  global: string | null;
  filters: ColumnFilter[];
  bounds: Bounds | null;
}

export const EMPTY_VIEW: ViewSpec = { sort: null, global: null, filters: [], bounds: null };

export interface AttrRow {
  featureId: number;
  /** Name first, then one cell per attribute column (manifest order). */
  cells: (string | null)[];
}

export interface AttributePage {
  total: number;
  rows: AttrRow[];
}

export interface GeometrySummary {
  kind: string;
  vertexCount: number;
  pointCount: number;
  lineCount: number;
  polygonCount: number;
  holeCount: number;
  lengthM: number | null;
  perimeterM: number | null;
  areaM2: number | null;
}

export interface FeatureDetail {
  id: number;
  name: string;
  description: string | null;
  visible: boolean;
  folder: number;
  attrs: [string, string][];
  geometry: GeometrySummary;
  bounds: Bounds | null;
}

export const getAttributes = (layerId: string, spec: ViewSpec, offset: number, limit: number) =>
  invoke<AttributePage>('get_attributes', { layerId, spec, offset, limit });

export const findRow = (layerId: string, spec: ViewSpec, featureId: number) =>
  invoke<number | null>('find_row', { layerId, spec, featureId });

export const getFeature = (layerId: string, featureId: number) =>
  invoke<FeatureDetail>('get_feature', { layerId, featureId });

/** Stable string for a view spec, used as a cache/effect key. */
export const viewKey = (spec: ViewSpec) => JSON.stringify(spec);
