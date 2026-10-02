// Basemap provider registry. M0 ships only OSM; keyed providers and MBTiles arrive in M1.
export interface BasemapConfig {
  id: string;
  name: string;
  type: 'xyz' | 'wmts' | 'cesium-ion' | 'mbtiles';
  url: string;
  requiresKey: boolean;
  attribution: string;
  maxZoom: number;
}

export const BASEMAPS: BasemapConfig[] = [
  {
    id: 'osm',
    name: 'OpenStreetMap',
    type: 'xyz',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    requiresKey: false,
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
];

export const DEFAULT_BASEMAP = BASEMAPS[0];
