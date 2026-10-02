// Draws the user layer ("My Places") with the Entity API. M5 adds styles, editing handles, and
// picking; for now it displays saved measurements.
import { ArcType, Cartesian3, Color, type Entity, type Viewer } from 'cesium';
import { useUserLayer } from '../layers/userLayerStore';

const COLOR = Color.fromCssColorString('#ff9800');

export function installUserLayerOverlay(viewer: Viewer): () => void {
  let entities: Entity[] = [];

  const render = () => {
    for (const e of entities) viewer.entities.remove(e);
    entities = [];
    const { features, visible } = useUserLayer.getState();
    if (!visible) return;
    for (const f of features) {
      if (f.coords.length === 0) continue;
      const flat = f.coords.flat();
      if (f.kind === 'point') {
        entities.push(
          viewer.entities.add({
            name: f.name,
            position: Cartesian3.fromDegrees(f.coords[0][0], f.coords[0][1]),
            point: { pixelSize: 9, color: COLOR, outlineColor: Color.WHITE, outlineWidth: 2 },
          }),
        );
      } else {
        const ring = f.kind === 'polygon' ? [...flat, flat[0], flat[1]] : flat;
        entities.push(
          viewer.entities.add({
            name: f.name,
            polyline: {
              positions: Cartesian3.fromDegreesArray(ring),
              arcType: ArcType.GEODESIC,
              width: 3,
              material: COLOR,
            },
            polygon:
              f.kind === 'polygon' && f.coords.length >= 3
                ? {
                    hierarchy: Cartesian3.fromDegreesArray(flat),
                    arcType: ArcType.GEODESIC,
                    material: COLOR.withAlpha(0.25),
                  }
                : undefined,
          }),
        );
      }
    }
  };

  render();
  const unsub = useUserLayer.subscribe(render);
  return () => {
    unsub();
    if (!viewer.isDestroyed()) for (const e of entities) viewer.entities.remove(e);
  };
}
