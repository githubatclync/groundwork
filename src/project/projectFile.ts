// The `.groundwork.json` project format: which files are open (relative to the project when
// possible), their visibility, opacity, and folder visibility, plus the camera, the basemap, and the
// user-drawn layer stored inline as GeoJSON. `parseProject` validates and sanitizes untrusted input.
import type { FolderNode } from '../io/types';
import {
  BUILTIN_ICONS,
  DEFAULT_STYLE,
  type BuiltinIcon,
  type Coord,
  type UserFeature,
  type UserFeatureKind,
  type UserStyle,
} from '../layers/userLayerStore';
import { relativeTo, resolveSource } from './paths';

export const PROJECT_FORMAT = 'groundwork-project';
export const PROJECT_VERSION = 1;
export const PROJECT_SUFFIX = '.groundwork.json';

export const isProjectPath = (p: string) => p.toLowerCase().endsWith(PROJECT_SUFFIX);

export interface ProjectLayer {
  /** Relative to the project file when `relative` is true, otherwise absolute. */
  source: string;
  relative: boolean;
  name: string;
  visible: boolean;
  opacity: number;
  /** Current visibility of every folder, by folder id (ids are stable for a given file). */
  folders: Record<string, boolean>;
  /** Column choices for CSV layers, so reopening needs no dialog. */
  csv?: { latCol: number; lonCol: number };
}

export interface ProjectCamera {
  lon: number;
  lat: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
}

export interface GeoJsonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
  layers: ProjectLayer[];
  camera: ProjectCamera | null;
  basemapId: string;
  userLayer: { type: 'FeatureCollection'; features: GeoJsonFeature[] };
  userLayerVisible: boolean;
}

// ---- user layer <-> GeoJSON ----

const closeRing = (ring: Coord[]): Coord[] => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return ring.length > 0 && (first[0] !== last[0] || first[1] !== last[1])
    ? [...ring, first]
    : ring;
};

const openRing = (ring: Coord[]): Coord[] => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return ring.length > 3 && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
};

export function userFeaturesToGeoJson(features: UserFeature[]): ProjectFile['userLayer'] {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      properties: {
        name: f.name,
        description: f.description,
        attrs: f.attrs,
        style: f.style,
        visible: f.visible,
        kind: f.kind,
      },
      geometry:
        f.kind === 'point'
          ? { type: 'Point', coordinates: f.coords[0] ?? [0, 0] }
          : f.kind === 'line'
            ? { type: 'LineString', coordinates: f.coords }
            : { type: 'Polygon', coordinates: [closeRing(f.coords), ...f.holes.map(closeRing)] },
    })),
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCoord = (v: unknown): v is Coord =>
  Array.isArray(v) &&
  v.length >= 2 &&
  isNum(v[0]) &&
  isNum(v[1]) &&
  Math.abs(v[0]) <= 180 &&
  Math.abs(v[1]) <= 90;
const coordList = (v: unknown): Coord[] | null =>
  Array.isArray(v) && v.every(isCoord) ? v.map((c) => [c[0], c[1]] as Coord) : null;

function sanitizeStyle(raw: unknown): UserStyle {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const color =
    typeof s.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.color)
      ? s.color
      : DEFAULT_STYLE.color;
  const clamp = (v: unknown, lo: number, hi: number, d: number) =>
    isNum(v) ? Math.min(hi, Math.max(lo, v)) : d;
  return {
    color,
    width: clamp(s.width, 1, 12, DEFAULT_STYLE.width),
    fillOpacity: clamp(s.fillOpacity, 0, 1, DEFAULT_STYLE.fillOpacity),
    icon: (BUILTIN_ICONS as readonly unknown[]).includes(s.icon) ? (s.icon as BuiltinIcon) : null,
    scale: clamp(s.scale, 0.3, 4, DEFAULT_STYLE.scale),
  };
}

/** Features from a project's inline GeoJSON; malformed entries are skipped. */
export function geoJsonToUserFeatures(fc: unknown): Omit<UserFeature, 'id'>[] {
  const list = (fc as { features?: unknown })?.features;
  if (!Array.isArray(list)) return [];
  const out: Omit<UserFeature, 'id'>[] = [];
  for (const raw of list) {
    const f = raw as {
      properties?: Record<string, unknown>;
      geometry?: { type?: string; coordinates?: unknown };
    };
    const p = f?.properties ?? {};
    const g = f?.geometry;
    let kind: UserFeatureKind;
    let coords: Coord[] | null = null;
    let holes: Coord[][] = [];
    if (g?.type === 'Point' && isCoord(g.coordinates)) {
      kind = 'point';
      coords = [[g.coordinates[0], g.coordinates[1]]];
    } else if (g?.type === 'LineString') {
      kind = 'line';
      coords = coordList(g.coordinates);
      if (coords && coords.length < 2) coords = null;
    } else if (g?.type === 'Polygon' && Array.isArray(g.coordinates)) {
      kind = 'polygon';
      const rings = g.coordinates.map(coordList);
      if (rings.length > 0 && rings.every((r) => r && r.length >= 4)) {
        const open = (rings as Coord[][]).map(openRing);
        coords = open[0];
        holes = open.slice(1);
      }
    } else continue;
    if (!coords) continue;
    const attrs: [string, string][] = Array.isArray(p.attrs)
      ? p.attrs
          .filter((a): a is [unknown, unknown] => Array.isArray(a) && a.length === 2)
          .map(([k, v]) => [String(k), String(v)] as [string, string])
      : [];
    out.push({
      name: typeof p.name === 'string' ? p.name : '',
      kind,
      coords,
      holes,
      description: typeof p.description === 'string' ? p.description : '',
      attrs,
      style: sanitizeStyle(p.style),
      visible: p.visible !== false,
    });
  }
  return out;
}

// ---- building and parsing ----

export interface LayerForProject {
  sourcePath: string;
  name: string;
  visible: boolean;
  opacity: number;
  tree: FolderNode;
  csv?: { latCol: number; lonCol: number };
}

function folderStates(tree: FolderNode): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const walk = (n: FolderNode) => {
    out[String(n.id)] = n.visible;
    n.children.forEach(walk);
  };
  walk(tree);
  return out;
}

export interface ProjectInput {
  projectPath: string;
  layers: LayerForProject[];
  camera: ProjectCamera | null;
  basemapId: string;
  userFeatures: UserFeature[];
  userLayerVisible: boolean;
  now?: Date;
}

export function buildProject(input: ProjectInput): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: (input.now ?? new Date()).toISOString(),
    layers: input.layers.map((l) => {
      const rel = relativeTo(input.projectPath, l.sourcePath);
      return {
        source: rel ?? l.sourcePath.replace(/\\/g, '/'),
        relative: rel !== null,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        folders: folderStates(l.tree),
        ...(l.csv ? { csv: l.csv } : {}),
      };
    }),
    camera: input.camera,
    basemapId: input.basemapId,
    userLayer: userFeaturesToGeoJson(input.userFeatures),
    userLayerVisible: input.userLayerVisible,
  };
}

/** Parses and validates project text; throws an Error with a readable message. */
export function parseProject(text: string): ProjectFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a valid project file (it is not JSON).');
  }
  const p = raw as Partial<ProjectFile> | null;
  if (!p || typeof p !== 'object' || p.format !== PROJECT_FORMAT) {
    throw new Error('This file is not a Groundwork project.');
  }
  if (!isNum(p.version) || p.version > PROJECT_VERSION) {
    throw new Error(
      `This project was saved by a newer version of Groundwork (format ${String(p.version)}).`,
    );
  }
  const layers: ProjectLayer[] = (Array.isArray(p.layers) ? p.layers : [])
    .filter(
      (l): l is ProjectLayer =>
        !!l && typeof l === 'object' && typeof (l as ProjectLayer).source === 'string',
    )
    .map((l) => ({
      source: l.source,
      relative: l.relative === true,
      name: typeof l.name === 'string' ? l.name : '',
      visible: l.visible !== false,
      opacity: isNum(l.opacity) ? Math.min(1, Math.max(0, l.opacity)) : 1,
      folders:
        l.folders && typeof l.folders === 'object'
          ? Object.fromEntries(Object.entries(l.folders).filter(([, v]) => typeof v === 'boolean'))
          : {},
      ...(l.csv && isNum(l.csv.latCol) && isNum(l.csv.lonCol)
        ? { csv: { latCol: l.csv.latCol, lonCol: l.csv.lonCol } }
        : {}),
    }));
  const c = p.camera;
  const camera =
    c && [c.lon, c.lat, c.height, c.heading, c.pitch, c.roll].every(isNum) && Math.abs(c.lat) <= 90
      ? {
          lon: c.lon,
          lat: c.lat,
          height: c.height,
          heading: c.heading,
          pitch: c.pitch,
          roll: c.roll,
        }
      : null;
  const features = geoJsonToUserFeatures(p.userLayer);
  return {
    format: PROJECT_FORMAT,
    version: p.version,
    savedAt: typeof p.savedAt === 'string' ? p.savedAt : '',
    layers,
    camera,
    basemapId: typeof p.basemapId === 'string' ? p.basemapId : 'osm',
    userLayer: userFeaturesToGeoJson(features.map((f, i) => ({ ...f, id: i + 1 }))),
    userLayerVisible: p.userLayerVisible !== false,
  };
}

/** Absolute path to open for a project layer entry. */
export const sourcePathOf = (projectPath: string, layer: ProjectLayer) =>
  layer.relative ? resolveSource(projectPath, layer.source) : layer.source;
