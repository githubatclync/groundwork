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

/** The user-layer feature id for a pick of one of its entities (ids look like "user:12"), else null. */
export function userFeatureFromPick(picked: unknown): number | null {
  const id = (picked as { id?: { id?: unknown } } | null | undefined)?.id?.id;
  if (typeof id !== 'string') return null;
  const m = /^user:(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** Calls `onPick` with the clicked feature, or null when empty space was clicked. */
export function installPicking(
  viewer: Viewer,
  onPick: (feature: PickedFeature | null) => void,
  enabled: () => boolean = () => true,
  onPickUser: (id: number) => void = () => undefined,
): () => void {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((click: { position: Cartesian2 }) => {
    if (!enabled()) return;
    const picked = viewer.scene.pick(click.position);
    const user = userFeatureFromPick(picked);
    if (user !== null) onPickUser(user);
    else onPick(featureFromPick(picked));
  }, ScreenSpaceEventType.LEFT_CLICK);
  return () => handler.destroy();
}
