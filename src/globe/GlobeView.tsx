// Mounts the Cesium viewer and keeps its imagery and terrain in sync with the settings store.
// Cesium-specific code is kept inside src/globe/.
import { useEffect, useRef, useState } from 'react';
import { EllipsoidTerrainProvider, ImageryLayer, Ion, Terrain, Viewer } from 'cesium';
import { buildTileUrl } from './basemaps';
import { useSettings, resolveActiveBasemap } from '../settings/settingsStore';
import { createImageryProvider } from './imagery';
import { useStatus } from './statusStore';
import { trackStatus } from './statusTracker';

export function GlobeView() {
  const ref = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const loaded = useSettings((s) => s.loaded);
  const basemapId = useSettings((s) => s.basemapId);
  const mbtiles = useSettings((s) => s.mbtiles);
  const ionToken = useSettings((s) => s.ionToken);
  const esriKey = useSettings((s) => s.esriKey);
  const mapboxToken = useSettings((s) => s.mapboxToken);

  useEffect(() => {
    if (!ref.current) return;
    const v = new Viewer(ref.current, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      timeline: false,
      animation: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      // Credits are shown by our own attribution widget instead.
      creditContainer: document.createElement('div'),
    });
    const stopTracking = trackStatus(v);
    setViewer(v);
    return () => {
      stopTracking();
      v.destroy();
      setViewer(null);
    };
  }, []);

  // Imagery: rebuild the base layer only when the effective basemap (or the key it uses) changes.
  const keys = { ionToken, esriKey, mapboxToken };
  const config = resolveActiveBasemap(basemapId, mbtiles, keys);
  const configUrl = buildTileUrl(config, keys);
  const imageryToken = config.type === 'cesium-ion' ? ionToken : '';
  useEffect(() => {
    if (!viewer || !loaded) return;
    let cancelled = false;
    let layer: ImageryLayer | undefined;
    if (imageryToken) Ion.defaultAccessToken = imageryToken;
    createImageryProvider(config, keys, mbtiles)
      .then((provider) => {
        if (cancelled || viewer.isDestroyed()) return;
        provider.errorEvent.addEventListener((err) => {
          useStatus.getState().set({ notice: `${config.name}: ${err.message}` });
          err.retry = false;
        });
        layer = new ImageryLayer(provider);
        viewer.imageryLayers.add(layer, 0);
        useStatus.getState().set({ notice: null });
      })
      .catch((e: unknown) => {
        useStatus.getState().set({
          notice: `${config.name}: ${e instanceof Error ? e.message : String(e)}`,
        });
      });
    return () => {
      cancelled = true;
      if (layer && !viewer.isDestroyed()) viewer.imageryLayers.remove(layer, true);
    };
    // config/keys/mbtiles are derived from the values below; depending on them directly would
    // rebuild the layer when an unrelated key is edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, loaded, config.id, configUrl, imageryToken]);

  // Terrain: Cesium World Terrain when an ion token is set, otherwise a smooth ellipsoid.
  useEffect(() => {
    if (!viewer || !loaded) return;
    if (!ionToken) {
      viewer.scene.terrainProvider = new EllipsoidTerrainProvider();
      useStatus.getState().set({ terrainLoaded: false, elevation: null });
      return;
    }
    Ion.defaultAccessToken = ionToken;
    const terrain = Terrain.fromWorldTerrain();
    const onReady = () => useStatus.getState().set({ terrainLoaded: true });
    const onError = (e: Error) => {
      useStatus.getState().set({ terrainLoaded: false, notice: `World Terrain: ${e.message}` });
    };
    terrain.readyEvent.addEventListener(onReady);
    terrain.errorEvent.addEventListener(onError);
    viewer.scene.setTerrain(terrain);
    return () => {
      terrain.readyEvent.removeEventListener(onReady);
      terrain.errorEvent.removeEventListener(onError);
    };
  }, [viewer, loaded, ionToken]);

  return <div ref={ref} className="globe" />;
}
