// Mouse handling for the measure tools: click adds a point, moving shows the rubber band, and a
// double-click finishes a path or area. Keyboard handling (Enter/Escape) lives in tools/useToolKeys.
import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
  type Viewer,
} from 'cesium';
import { useMeasure } from '../tools/measureStore';
import { measureModeOf, useTool } from '../tools/toolStore';
import { lonLatAt } from './lonLat';

export function installMeasureInteraction(viewer: Viewer): () => void {
  // Cesium zooms in on double-click by default; the tools use it to finish a measurement.
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

  handler.setInputAction((click: { position: Cartesian2 }) => {
    const mode = measureModeOf(useTool.getState().tool);
    if (!mode) return;
    const p = lonLatAt(viewer, click.position);
    if (p) useMeasure.getState().addPoint(mode, { lon: p[0], lat: p[1] });
  }, ScreenSpaceEventType.LEFT_CLICK);

  handler.setInputAction((move: { endPosition: Cartesian2 }) => {
    const mode = measureModeOf(useTool.getState().tool);
    const m = useMeasure.getState();
    if (!mode || m.finished || m.points.length === 0) return;
    const p = lonLatAt(viewer, move.endPosition);
    m.setCursor(p ? { lon: p[0], lat: p[1] } : null);
  }, ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction(() => {
    const mode = measureModeOf(useTool.getState().tool);
    const m = useMeasure.getState();
    if (!mode || m.finished) return;
    // The two clicks of the double-click each added a point at the same spot; drop one.
    m.popPoint();
    useMeasure.getState().finish(mode);
  }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  return () => handler.destroy();
}
