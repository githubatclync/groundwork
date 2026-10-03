// Mouse handling for the draw tools. Point: one click creates a point. Line / polygon: click adds
// vertices, a double-click (or Enter, handled in tools/useToolKeys) finishes.
import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
  type Viewer,
} from 'cesium';
import { createFeature, finishDraft } from '../tools/createFeature';
import { drawKindOf, useDraft } from '../tools/draftStore';
import { useTool } from '../tools/toolStore';
import { lonLatAt } from './lonLat';

export function installDrawInteraction(viewer: Viewer): () => void {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction((click: { position: Cartesian2 }) => {
    const kind = drawKindOf(useTool.getState().tool);
    if (!kind) return;
    const p = lonLatAt(viewer, click.position);
    if (!p) return;
    if (kind === 'point') createFeature('point', [p]);
    else useDraft.getState().addPoint(p);
  }, ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction((move: { endPosition: Cartesian2 }) => {
    const kind = drawKindOf(useTool.getState().tool);
    if (!kind || kind === 'point' || useDraft.getState().points.length === 0) return;
    useDraft.getState().setCursor(lonLatAt(viewer, move.endPosition));
  }, ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction(() => {
    const kind = drawKindOf(useTool.getState().tool);
    if (!kind || kind === 'point') return;
    // The two clicks of the double-click each added a vertex at the same spot; drop one.
    useDraft.getState().popPoint();
    finishDraft(kind);
  }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  return () => handler.destroy();
}
