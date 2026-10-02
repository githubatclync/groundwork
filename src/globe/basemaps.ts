// Basemap provider registry and URL helpers. Keys are never hardcoded: providers that need one
// reference a setting name and the key is substituted into `{key}` at runtime.
export type KeySetting = 'ionToken' | 'esriKey' | 'mapboxToken';

export interface BasemapConfig {
  id: string;
  name: string;
  type: 'xyz' | 'wmts' | 'cesium-ion' | 'mbtiles';
  url: string;
  requiresKey: boolean;
  attribution: string;
  maxZoom: number;
  /** Which setting holds this provider's key/token. */
  keySetting?: KeySetting;
  /** Shown in the UI next to the provider (license or usage notes). */
  note?: string;
}

export const OSM_ID = 'osm';

export const BASEMAPS: BasemapConfig[] = [
  {
    id: OSM_ID,
    name: 'OpenStreetMap',
    type: 'xyz',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    requiresKey: false,
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    note: 'Default. Per the OSM tile policy, tiles are not prefetched or cached offline.',
  },
  {
    id: 'cesium-ion',
    name: 'Cesium ion imagery + World Terrain',
    type: 'cesium-ion',
    url: 'ion://2',
    requiresKey: true,
    keySetting: 'ionToken',
    attribution: 'Cesium ion · Imagery © Microsoft Bing Maps',
    maxZoom: 19,
    note: 'Needs your own free Cesium ion token. Terrain and elevation readouts use the same token.',
  },
  {
    id: 'esri-imagery',
    name: 'Esri World Imagery',
    type: 'xyz',
    url: 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token={key}',
    requiresKey: true,
    keySetting: 'esriKey',
    attribution:
      'Powered by Esri · Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
    note: 'Needs your own ArcGIS API key.',
  },
  {
    id: 'mapbox-satellite',
    name: 'Mapbox Satellite',
    type: 'xyz',
    url: 'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token={key}',
    requiresKey: true,
    keySetting: 'mapboxToken',
    attribution: '© Mapbox © OpenStreetMap contributors © Maxar',
    maxZoom: 19,
    note: 'Needs your own Mapbox token.',
  },
  {
    id: 'eox-s2cloudless',
    name: 'Sentinel-2 cloudless (EOX, 2016)',
    type: 'wmts',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2016_3857/default/g/{z}/{y}/{x}.jpg',
    requiresKey: false,
    attribution:
      'Sentinel-2 cloudless – s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)',
    maxZoom: 13,
    note: 'The 2016 vintage is CC BY 4.0. Later vintages are non-commercial only.',
  },
];

export interface MbtilesEntry {
  path: string;
  /** Runtime id assigned by the Rust side; absent while the file is not open. */
  runtimeId?: string;
  name: string;
  attribution?: string;
  minZoom: number;
  maxZoom: number;
  /** west, south, east, north */
  bounds?: [number, number, number, number];
}

export const mbtilesBasemapId = (path: string) => `mbtiles:${path}`;

/** Tile URL template for the custom protocol; Windows webviews serve custom schemes over http. */
export function mbtilesUrlTemplate(
  runtimeId: string,
  isWindows = /Windows/i.test(navigator.userAgent),
) {
  return isWindows
    ? `http://mbtiles.localhost/${runtimeId}/{z}/{x}/{y}`
    : `mbtiles://localhost/${runtimeId}/{z}/{x}/{y}`;
}

export function mbtilesBasemap(entry: MbtilesEntry): BasemapConfig {
  return {
    id: mbtilesBasemapId(entry.path),
    name: `${entry.name} (MBTiles)`,
    type: 'mbtiles',
    url: entry.runtimeId ? mbtilesUrlTemplate(entry.runtimeId) : '',
    requiresKey: false,
    attribution: entry.attribution ?? entry.name,
    maxZoom: entry.maxZoom,
  };
}

export type Keys = Record<KeySetting, string>;

export interface Availability {
  available: boolean;
  reason?: string;
}

export function availability(config: BasemapConfig, keys: Keys): Availability {
  if (config.requiresKey && config.keySetting && !keys[config.keySetting].trim()) {
    return { available: false, reason: 'key required' };
  }
  if (config.type === 'mbtiles' && !config.url) {
    return { available: false, reason: 'file not open' };
  }
  return { available: true };
}

/** Fills the `{key}` placeholder; the z/x/y placeholders are left for Cesium. */
export function buildTileUrl(config: BasemapConfig, keys: Keys): string {
  const key = config.keySetting ? encodeURIComponent(keys[config.keySetting].trim()) : '';
  return config.url.replace('{key}', key);
}
