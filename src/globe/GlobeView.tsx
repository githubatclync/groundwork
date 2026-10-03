// Mounts the Cesium viewer and keeps its imagery and terrain in sync with the settings store.
// Cesium-specific code is kept inside src/globe/.
import { useEffect, useRef, useState } from 'react';
import {
  createOsmBuildingsAsync,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  Terrain,
  Viewer,
} from 'cesium';
import { buildTileUrl } from './basemaps';
import { useSettings, resolveActiveBasemap } from '../settings/settingsStore';
import { createImageryProvider } from './imagery';
import { useStatus } from './statusStore';
import { useLayers } from '../layers/layerStore';
import { useSelection } from '../selection/selectionStore';
import { useUi } from '../ui/uiStore';
import { useTool } from '../tools/toolStore';
import { useUserLayer } from '../layers/userLayerStore';
import { installDraftOverlay } from './draftOverlay';
import { installDrawInteraction } from './drawInteraction';
import { installEditInteraction } from './editInteraction';
import { installMeasureInteraction } from './measureInteraction';
import { installSearchOverlay } from './searchOverlay';
import { installMeasureOverlay } from './measureOverlay';
import { installPicking } from './picking';
import { installUserLayerOverlay } from './userLayerOverlay';
import { trackStatus } from './statusTracker';
import { setViewer as registerViewer } from './viewerRegistry';

export function GlobeView() {
  const ref = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const loaded = useSettings((s) => s.loaded);
  const basemapId = useSettings((s) => s.basemapId);
  const mbtiles = useSettings((s) => s.mbtiles);
  const ionToken = useSettings((s) => s.ionToken);
  const osmBuildings = useSettings((s) => s.osmBuildings);
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
    const stopMeasure = installMeasureInteraction(v);
    const stopMeasureOverlay = installMeasureOverlay(v);
    const stopUserLayer = installUserLayerOverlay(v);
    const stopDraw = installDrawInteraction(v);
    const stopDraft = installDraftOverlay(v);
    const stopEdit = installEditInteraction(v);
    const stopSearch = installSearchOverlay(v);
    const stopPicking = installPicking(
      v,
      (feature) => {
        if (!feature) {
          useSelection.getState().clear();
          return;
        }
        useSelection.getState().select(feature.layerId, feature.featureId, 'globe');
        useLayers.getState().setActiveLayer(feature.layerId);
        useUi.getState().setDetailsOpen(true);
      },
      // Clicks belong to the active tool, not to feature picking.
      () => useTool.getState().tool === 'none',
      (userId) => useUserLayer.getState().select(userId),
    );
    setViewer(v);
    registerViewer(v);
    // Dev-only hook so automated checks can drive the camera (never present in production builds).
    if (import.meta.env.DEV) (window as unknown as { __viewer?: Viewer }).__viewer = v;
    return () => {
      registerViewer(null);
      stopTracking();
      stopPicking();
      stopMeasure();
      stopMeasureOverlay();
      stopUserLayer();
      stopDraw();
      stopDraft();
      stopEdit();
      stopSearch();
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

  // Optional 3D buildings (3D Tiles); online only, so failures become a notice, not an error.
  useEffect(() => {
    if (!viewer || !loaded || !osmBuildings || !ionToken) return;
    let cancelled = false;
    let tileset: Awaited<ReturnType<typeof createOsmBuildingsAsync>> | null = null;
    Ion.defaultAccessToken = ionToken;
    createOsmBuildingsAsync()
      .then((t) => {
        if (cancelled) {
          t.destroy();
          return;
        }
        tileset = t;
        viewer.scene.primitives.add(t);
      })
      .catch((e: unknown) => {
        useStatus.getState().set({
          notice: `3D buildings: ${e instanceof Error ? e.message : String(e)}`,
        });
      });
    return () => {
      cancelled = true;
      if (tileset) {
        viewer.scene.primitives.remove(tileset);
        tileset = null;
      }
    };
  }, [viewer, loaded, osmBuildings, ionToken]);

  return <div ref={ref} className="globe" />;
}
