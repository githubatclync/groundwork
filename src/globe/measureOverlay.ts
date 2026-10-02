// Draws the measurement in progress: vertices, the geodesic path, and the area polygon.
import { ArcType, Cartesian3, Color, type Entity, type Viewer } from 'cesium';
import { useMeasure } from '../tools/measureStore';
import { measureModeOf, useTool } from '../tools/toolStore';

const LINE = Color.fromCssColorString('#ff9800');

export function installMeasureOverlay(viewer: Viewer): () => void {
  let entities: Entity[] = [];

  const render = () => {
    for (const e of entities) viewer.entities.remove(e);
    entities = [];
    const mode = measureModeOf(useTool.getState().tool);
    if (!mode) return;
    const { points, cursor, finished } = useMeasure.getState();
    const path = finished || !cursor ? points : [...points, cursor];

    for (const p of points) {
      entities.push(
        viewer.entities.add({
          position: Cartesian3.fromDegrees(p.lon, p.lat),
          point: { pixelSize: 9, color: LINE, outlineColor: Color.WHITE, outlineWidth: 2 },
        }),
      );
    }
    if (path.length >= 2) {
      const flat = path.flatMap((p) => [p.lon, p.lat]);
      const closed =
        mode === 'area' && path.length >= 3 ? [...flat, path[0].lon, path[0].lat] : flat;
      entities.push(
        viewer.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(closed),
            arcType: ArcType.GEODESIC,
            width: 3,
            material: LINE,
          },
        }),
      );
    }
    if (mode === 'area' && path.length >= 3) {
      entities.push(
        viewer.entities.add({
          polygon: {
            hierarchy: Cartesian3.fromDegreesArray(path.flatMap((p) => [p.lon, p.lat])),
            arcType: ArcType.GEODESIC,
            material: LINE.withAlpha(0.25),
          },
        }),
      );
    }
  };

  const unsubMeasure = useMeasure.subscribe(render);
  const unsubTool = useTool.subscribe(render);
  return () => {
    unsubMeasure();
    unsubTool();
    if (!viewer.isDestroyed()) for (const e of entities) viewer.entities.remove(e);
  };
}
