// Draws the line or polygon being drawn: vertices and a rubber band that follows the cursor.
import { ArcType, Cartesian3, Color, type Entity, type Viewer } from 'cesium';
import { drawKindOf, useDraft } from '../tools/draftStore';
import { useTool } from '../tools/toolStore';

const COLOR = Color.fromCssColorString('#ff9800');

export function installDraftOverlay(viewer: Viewer): () => void {
  let entities: Entity[] = [];

  const render = () => {
    for (const e of entities) viewer.entities.remove(e);
    entities = [];
    const kind = drawKindOf(useTool.getState().tool);
    if (!kind || kind === 'point') return;
    const { points, cursor } = useDraft.getState();
    const path = cursor ? [...points, cursor] : points;
    for (const p of points) {
      entities.push(
        viewer.entities.add({
          position: Cartesian3.fromDegrees(p[0], p[1]),
          point: { pixelSize: 9, color: Color.WHITE, outlineColor: COLOR, outlineWidth: 3 },
        }),
      );
    }
    if (path.length >= 2) {
      const closed = kind === 'polygon' && path.length >= 3 ? [...path, path[0]] : path;
      entities.push(
        viewer.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(closed.flat()),
            arcType: ArcType.GEODESIC,
            width: 3,
            material: COLOR.withAlpha(0.9),
          },
        }),
      );
    }
    if (kind === 'polygon' && path.length >= 3) {
      entities.push(
        viewer.entities.add({
          polygon: {
            hierarchy: Cartesian3.fromDegreesArray(path.flat()),
            arcType: ArcType.GEODESIC,
            material: COLOR.withAlpha(0.2),
          },
        }),
      );
    }
  };

  const unsubDraft = useDraft.subscribe(render);
  const unsubTool = useTool.subscribe(render);
  return () => {
    unsubDraft();
    unsubTool();
    if (!viewer.isDestroyed()) for (const e of entities) viewer.entities.remove(e);
  };
}
