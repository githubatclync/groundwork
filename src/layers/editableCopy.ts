// "Make editable copy": converts an imported layer into features of the user layer (Rust does the
// conversion and enforces the 10,000-feature limit).
import { zoomToBounds } from '../globe/camera';
import { layerToUser } from '../io/export';
import { useTool } from '../tools/toolStore';
import { useLayers } from './layerStore';
import { useUserLayer } from './userLayerStore';

export async function makeEditableCopy(layerId: string): Promise<void> {
  const layer = useLayers.getState().layers.find((l) => l.id === layerId);
  try {
    const features = await layerToUser(layerId);
    if (features.length === 0) {
      useLayers.getState().addError(`"${layer?.name ?? 'The layer'}" has no features to copy.`);
      return;
    }
    const user = useUserLayer.getState();
    user.addMany(features);
    user.setVisible(true);
    useTool.getState().setTool('edit');
    zoomToBounds(layer?.bounds ?? null);
  } catch (e) {
    useLayers.getState().addError(e instanceof Error ? e.message : String(e));
  }
}
