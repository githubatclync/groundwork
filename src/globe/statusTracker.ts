// Feeds the status store from a Cesium viewer: cursor lat/lon/elevation, camera height, FPS.
// Updates are coalesced to one per animation frame so mouse moves never flood React.
import {
  Cartographic,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
  type Viewer,
} from 'cesium';
import { useSettings } from '../settings/settingsStore';
import { useStatus } from './statusStore';

export function trackStatus(viewer: Viewer): () => void {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  let pending: Cartesian2 | null = null;
  let raf = 0;

  const flush = () => {
    raf = 0;
    const pos = pending;
    pending = null;
    if (!pos) return;
    const ray = viewer.camera.getPickRay(pos);
    const hit = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
    if (!hit) {
      useStatus.getState().set({ cursor: null, elevation: null });
      return;
    }
    const c = Cartographic.fromCartesian(hit);
    const { terrainLoaded } = useStatus.getState();
    useStatus.getState().set({
      cursor: { lat: CesiumMath.toDegrees(c.latitude), lon: CesiumMath.toDegrees(c.longitude) },
      elevation: terrainLoaded ? c.height : null,
    });
  };

  handler.setInputAction((m: { endPosition: Cartesian2 }) => {
    pending = m.endPosition.clone();
    if (!raf) raf = requestAnimationFrame(flush);
  }, ScreenSpaceEventType.MOUSE_MOVE);

  let frames = 0;
  let lastFpsTime = performance.now();
  let lastHeightTime = 0;
  const onPostRender = () => {
    const now = performance.now();
    frames++;
    if (now - lastFpsTime >= 1000) {
      const showFps = useSettings.getState().showFps;
      useStatus.getState().set({ fps: showFps ? Math.round((frames * 1000) / (now - lastFpsTime)) : null });
      frames = 0;
      lastFpsTime = now;
    }
    if (now - lastHeightTime >= 250) {
      lastHeightTime = now;
      const h = viewer.camera.positionCartographic.height;
      const prev = useStatus.getState().cameraHeight;
      if (prev === null || Math.abs(prev - h) > Math.max(0.5, h * 0.002)) {
        useStatus.getState().set({ cameraHeight: h });
      }
    }
  };
  viewer.scene.postRender.addEventListener(onPostRender);

  return () => {
    if (raf) cancelAnimationFrame(raf);
    viewer.scene.postRender.removeEventListener(onPostRender);
    handler.destroy();
  };
}
