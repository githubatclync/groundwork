// Keeps the two kinds of selection exclusive: selecting a feature of an imported layer deselects
// the user-layer feature, and vice versa.
import { useUserLayer } from '../layers/userLayerStore';
import { useSelection } from './selectionStore';

export function linkSelections(): () => void {
  const a = useSelection.subscribe((s) => {
    if (s.selection && useUserLayer.getState().selectedId !== null)
      useUserLayer.getState().select(null);
  });
  const b = useUserLayer.subscribe((s, prev) => {
    if (
      s.selectedId !== null &&
      s.selectedId !== prev.selectedId &&
      useSelection.getState().selection
    ) {
      useSelection.getState().clear();
    }
  });
  return () => {
    a();
    b();
  };
}
