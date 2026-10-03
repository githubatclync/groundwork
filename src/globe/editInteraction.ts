// Edit mode: drag a vertex handle to move it, click a midpoint handle to insert a vertex (and drag
// it), Alt-click a vertex handle to delete it, click a feature to select it. A whole drag is one
// undo step. While dragging, camera input is paused so the map does not pan.
import {
  KeyboardEventModifier,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
  type Viewer,
} from 'cesium';
import { useUserLayer } from '../layers/userLayerStore';
import { deleteVertex, getRing, insertVertex, midpoint, moveVertex } from '../tools/editOps';
import { useTool } from '../tools/toolStore';
import { lonLatAt } from './lonLat';

interface Drag {
  featureId: number;
  ring: number;
  index: number;
}

/** What was hit: an entity id like "h:0:2", or null. */
function pickedEntityId(viewer: Viewer, position: Cartesian2): string | null {
  const picked = viewer.scene.pick(position) as { id?: { id?: unknown } } | undefined;
  const id = picked?.id?.id;
  return typeof id === 'string' ? id : null;
}

function parseHandle(id: string): { kind: 'h' | 'm'; ring: number; index: number } | null {
  const m = /^([hm]):(\d+):(\d+)$/.exec(id);
  return m ? { kind: m[1] as 'h' | 'm', ring: Number(m[2]), index: Number(m[3]) } : null;
}

export function installEditInteraction(viewer: Viewer): () => void {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  const controller = viewer.scene.screenSpaceCameraController;
  let drag: Drag | null = null;

  const selected = () => {
    const { features, selectedId } = useUserLayer.getState();
    return features.find((f) => f.id === selectedId) ?? null;
  };

  const startDrag = (d: Drag) => {
    drag = d;
    controller.enableInputs = false;
    useUserLayer.getState().beginTransient();
  };

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    controller.enableInputs = true;
    useUserLayer.getState().endTransient();
  };

  handler.setInputAction((down: { position: Cartesian2 }) => {
    if (useTool.getState().tool !== 'edit') return;
    const id = pickedEntityId(viewer, down.position);
    if (!id) return;
    const store = useUserLayer.getState();
    if (id.startsWith('user:')) {
      store.select(Number(id.slice(5)));
      return;
    }
    const h = parseHandle(id);
    const f = selected();
    if (!h || !f) return;
    if (h.kind === 'h') {
      startDrag({ featureId: f.id, ring: h.ring, index: h.index });
    } else {
      // Insert a vertex at the midpoint and keep dragging it.
      const pts = getRing(f, h.ring);
      const pos = midpoint(pts[h.index], pts[(h.index + 1) % pts.length]);
      const inserted = insertVertex(f, h.ring, h.index, pos);
      startDrag({ featureId: f.id, ring: h.ring, index: h.index + 1 });
      store.setTransient(f.id, { coords: inserted.coords, holes: inserted.holes });
    }
  }, ScreenSpaceEventType.LEFT_DOWN);

  // Alt-click deletes a vertex.
  handler.setInputAction(
    (down: { position: Cartesian2 }) => {
      if (useTool.getState().tool !== 'edit') return;
      const h = parseHandle(pickedEntityId(viewer, down.position) ?? '');
      const f = selected();
      if (!h || h.kind !== 'h' || !f) return;
      const next = deleteVertex(f, h.ring, h.index);
      if (next) useUserLayer.getState().update(f.id, { coords: next.coords, holes: next.holes });
    },
    ScreenSpaceEventType.LEFT_DOWN,
    KeyboardEventModifier.ALT,
  );

  handler.setInputAction((move: { endPosition: Cartesian2 }) => {
    if (!drag) return;
    const pos = lonLatAt(viewer, move.endPosition);
    const f = useUserLayer.getState().features.find((x) => x.id === drag?.featureId);
    if (!pos || !f) return;
    const next = moveVertex(f, drag.ring, drag.index, pos);
    useUserLayer.getState().setTransient(f.id, { coords: next.coords, holes: next.holes });
  }, ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction(endDrag, ScreenSpaceEventType.LEFT_UP);

  // Clicking empty space in edit mode deselects.
  handler.setInputAction((click: { position: Cartesian2 }) => {
    if (useTool.getState().tool !== 'edit') return;
    if (!pickedEntityId(viewer, click.position)) useUserLayer.getState().select(null);
  }, ScreenSpaceEventType.LEFT_CLICK);

  return () => {
    endDrag();
    handler.destroy();
  };
}
