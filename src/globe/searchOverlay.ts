// Draws the search result marker on the globe.
import { Cartesian3, Color, LabelStyle, VerticalOrigin, type Entity, type Viewer } from 'cesium';
import { useSearch } from '../search/searchStore';

export function installSearchOverlay(viewer: Viewer): () => void {
  let entity: Entity | null = null;

  const render = () => {
    if (entity) viewer.entities.remove(entity);
    entity = null;
    const m = useSearch.getState().marker;
    if (!m) return;
    entity = viewer.entities.add({
      position: Cartesian3.fromDegrees(m.lon, m.lat),
      point: {
        pixelSize: 14,
        color: Color.fromCssColorString('#d81b60'),
        outlineColor: Color.WHITE,
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: m.label,
        font: '13px system-ui, sans-serif',
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: { x: 0, y: -16 } as never,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  };

  const unsub = useSearch.subscribe(render);
  render();
  return () => {
    unsub();
    if (entity && !viewer.isDestroyed()) viewer.entities.remove(entity);
  };
}
