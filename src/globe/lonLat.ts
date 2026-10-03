// Screen position -> ground position, shared by the measure, draw, and edit tools.
import { Math as CesiumMath, Cartographic, type Cartesian2, type Viewer } from 'cesium';
import type { Coord } from '../layers/userLayerStore';

/** The [lon, lat] under a screen point (terrain-aware), or null over empty space. */
export function lonLatAt(viewer: Viewer, position: Cartesian2): Coord | null {
  const ray = viewer.camera.getPickRay(position);
  const hit = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
  if (!hit) return null;
  const c = Cartographic.fromCartesian(hit);
  return [CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)];
}
