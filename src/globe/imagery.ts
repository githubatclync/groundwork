// Creates Cesium imagery providers from basemap configs. Cesium-specific, so it lives in globe/.
import {
  IonImageryProvider,
  Rectangle,
  UrlTemplateImageryProvider,
  type ImageryProvider,
} from 'cesium';
import { buildTileUrl, type BasemapConfig, type Keys, type MbtilesEntry } from './basemaps';

export async function createImageryProvider(
  config: BasemapConfig,
  keys: Keys,
  mbtiles: MbtilesEntry[],
): Promise<ImageryProvider> {
  if (config.type === 'cesium-ion') {
    return IonImageryProvider.fromAssetId(Number(config.url.replace('ion://', '')));
  }
  const entry =
    config.type === 'mbtiles' ? mbtiles.find((m) => `mbtiles:${m.path}` === config.id) : undefined;
  const bounds = entry?.bounds;
  return new UrlTemplateImageryProvider({
    url: buildTileUrl(config, keys),
    maximumLevel: config.maxZoom,
    minimumLevel: entry?.minZoom,
    // Restricting to the file's bounds avoids requests for tiles that cannot exist.
    rectangle: bounds
      ? Rectangle.fromDegrees(bounds[0], bounds[1], bounds[2], bounds[3])
      : undefined,
    credit: config.attribution,
  });
}
