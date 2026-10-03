// Types mirroring the JSON the Rust side sends in a layer manifest.
export interface IconStyle {
  href: string;
  remote: boolean;
  scale: number;
  heading: number;
  color: string; // rrggbbaa
}

export interface Style {
  icon: IconStyle | null;
  label: { color: string; scale: number } | null;
  line: { color: string; width: number };
  poly: { color: string; fill: boolean; outline: boolean };
}

export interface FolderNode {
  id: number;
  name: string;
  open: boolean;
  visible: boolean;
  featureCount: number;
  children: FolderNode[];
}

export interface Warning {
  kind: string;
  message: string;
  count: number;
}

export interface Column {
  name: string;
  type: 'string' | 'number' | 'bool';
}

export interface Overlay {
  name: string;
  href: string;
  north: number;
  south: number;
  east: number;
  west: number;
  rotation: number;
  color: string;
  visible: boolean;
  folder: number;
}

export type Bounds = [west: number, south: number, east: number, north: number];

export interface LayerManifest {
  id: string;
  name: string;
  sourcePath: string;
  format: 'kml' | 'kmz' | 'geojson' | 'gpx' | 'csv';
  featureCount: number;
  partCount: number;
  vertexCount: number;
  geometryCounts: { points: number; lines: number; polygons: number };
  bounds: Bounds | null;
  tree: FolderNode;
  styles: Style[];
  columns: Column[];
  warnings: Warning[];
  overlays: Overlay[];
  /** Local files this layer links to (KML NetworkLink); each is imported as a child layer. */
  links: { name: string; path: string }[];
  elapsedMs: number;
}
