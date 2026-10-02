// Click-to-select on the globe. Layer geometry carries `{ layerId, featureId }` as its pick id
// (on the geometry instance, or on the point/billboard itself).
import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
  type Viewer,
} from 'cesium';

export interface PickedFeature {
  layerId: string;
  featureId: number;
}

function asFeature(id: unknown): PickedFeature | null {
  if (id && typeof id === 'object' && 'layerId' in id && 'featureId' in id) {
    const { layerId, featureId } = id as { layerId: unknown; featureId: unknown };
    if (typeof layerId === 'string' && typeof featureId === 'number') return { layerId, featureId };
  }
  return null;
}

/** Resolves what Cesium's pick result refers to (instances expose `id`; points expose `primitive.id`). */
export function featureFromPick(picked: unknown): PickedFeature | null {
  if (!picked || typeof picked !== 'object') return null;
  const p = picked as { id?: unknown; primitive?: { id?: unknown } };
  return asFeature(p.id) ?? asFeature(p.primitive?.id);
}

/** Calls `onPick` with the clicked feature, or null when empty space was clicked. */
export function installPicking(
  viewer: Viewer,
  onPick: (feature: PickedFeature | null) => void,
  enabled: () => boolean = () => true,
): () => void {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click: { position: Cartesian2 }) => {
    if (enabled()) onPick(featureFromPick(viewer.scene.pick(click.position)));
  }, ScreenSpaceEventType.LEFT_CLICK);
  return () => handler.destroy();
}
