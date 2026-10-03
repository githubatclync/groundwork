// Creates a user feature from drawn points and selects it. Shared by the draw interaction
// (click / double-click) and the Enter key.
import {
  DEFAULT_STYLE,
  useUserLayer,
  type Coord,
  type UserFeatureKind,
} from '../layers/userLayerStore';
import { useSelection } from '../selection/selectionStore';
import { DRAW_MIN_POINTS, useDraft, type DrawKind } from './draftStore';

const LABEL: Record<UserFeatureKind, string> = { point: 'Point', line: 'Line', polygon: 'Polygon' };

/** "Line 3": the next unused number for that kind of feature. */
export function nextName(kind: UserFeatureKind): string {
  const existing = useUserLayer.getState().features.filter((f) => f.kind === kind).length;
  return `${LABEL[kind]} ${existing + 1}`;
}

export function createFeature(kind: DrawKind, coords: Coord[]): number {
  const id = useUserLayer.getState().add({
    name: nextName(kind),
    kind,
    coords,
    holes: [],
    description: '',
    attrs: [],
    style: { ...DEFAULT_STYLE, fillOpacity: kind === 'polygon' ? 0.25 : 0 },
    visible: true,
  });
  useSelection.getState().clear();
  return id;
}

/** Finishes the draft as a feature if it has enough points; returns whether it did. */
export function finishDraft(kind: DrawKind): boolean {
  const { points, reset } = useDraft.getState();
  if (points.length < DRAW_MIN_POINTS[kind]) return false;
  createFeature(kind, points);
  reset();
  return true;
}
