// Draws the user layer ("My Places") with the Entity API, plus the selection emphasis and, in edit
// mode, the vertex and midpoint handles. Entity ids encode what they are so picking can tell:
//   user:<id>          a feature        h:<ring>:<index>   a vertex handle
//   m:<ring>:<index>   a midpoint handle (click to insert a vertex)
import { ArcType, Cartesian3, Color, HeightReference, type Entity, type Viewer } from 'cesium';
import { useUserLayer, type UserFeature } from '../layers/userLayerStore';
import { getRing, midpointHandles, ringCount } from '../tools/editOps';
import { useTool } from '../tools/toolStore';

const SELECT = Color.fromCssColorString('#00e5ff');

export function installUserLayerOverlay(viewer: Viewer): () => void {
  let entities: Entity[] = [];

  const flat = (coords: [number, number][]) => coords.flat();

  const addFeature = (f: UserFeature, selected: boolean) => {
    if (f.coords.length === 0) return;
    const color = Color.fromCssColorString(f.style.color);
    if (f.kind === 'point') {
      const position = Cartesian3.fromDegrees(f.coords[0][0], f.coords[0][1]);
      entities.push(
        viewer.entities.add({
          id: `user:${f.id}`,
          name: f.name,
          position,
          ...(f.style.icon
            ? {
                billboard: {
                  image: `/builtin-icons/${f.style.icon}.png`,
                  color,
                  scale: f.style.scale,
                  heightReference: HeightReference.NONE,
                },
              }
            : {
                point: {
                  pixelSize: 9 * f.style.scale,
                  color,
                  outlineColor: Color.WHITE,
                  outlineWidth: 2,
                },
              }),
        }),
      );
      if (selected) {
        entities.push(
          viewer.entities.add({
            position,
            point: {
              pixelSize: 9 * f.style.scale + 14,
              color: SELECT.withAlpha(0.25),
              outlineColor: SELECT,
              outlineWidth: 3,
            },
          }),
        );
      }
      return;
    }
    const ring = f.kind === 'polygon' ? [...f.coords, f.coords[0]] : f.coords;
    entities.push(
      viewer.entities.add({
        id: `user:${f.id}`,
        name: f.name,
        polyline: {
          positions: Cartesian3.fromDegreesArray(flat(ring)),
          arcType: ArcType.GEODESIC,
          width: f.style.width,
          material: color,
        },
        polygon:
          f.kind === 'polygon' && f.coords.length >= 3 && f.style.fillOpacity > 0
            ? {
                hierarchy: {
                  positions: Cartesian3.fromDegreesArray(flat(f.coords)),
                  holes: f.holes
                    .filter((h) => h.length >= 3)
                    .map((h) => ({ positions: Cartesian3.fromDegreesArray(flat(h)), holes: [] })),
                },
                arcType: ArcType.GEODESIC,
                material: color.withAlpha(f.style.fillOpacity),
              }
            : undefined,
      }),
    );
    for (const holeRing of f.kind === 'polygon' ? f.holes : []) {
      if (holeRing.length < 3) continue;
      entities.push(
        viewer.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(flat([...holeRing, holeRing[0]])),
            arcType: ArcType.GEODESIC,
            width: f.style.width,
            material: color,
          },
        }),
      );
    }
    if (selected) {
      entities.push(
        viewer.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(flat(ring)),
            arcType: ArcType.GEODESIC,
            width: f.style.width + 6,
            material: SELECT.withAlpha(0.45),
          },
        }),
      );
    }
  };

  const addHandles = (f: UserFeature) => {
    for (let r = 0; r < ringCount(f); r++) {
      getRing(f, r).forEach((p, i) => {
        entities.push(
          viewer.entities.add({
            id: `h:${r}:${i}`,
            position: Cartesian3.fromDegrees(p[0], p[1]),
            point: {
              pixelSize: 12,
              color: Color.WHITE,
              outlineColor: Color.fromCssColorString('#ff6d00'),
              outlineWidth: 3,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          }),
        );
      });
    }
    for (const m of midpointHandles(f)) {
      entities.push(
        viewer.entities.add({
          id: `m:${m.ring}:${m.index}`,
          position: Cartesian3.fromDegrees(m.pos[0], m.pos[1]),
          point: {
            pixelSize: 8,
            color: Color.WHITE.withAlpha(0.6),
            outlineColor: Color.fromCssColorString('#ff6d00').withAlpha(0.8),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    }
  };

  const render = () => {
    for (const e of entities) viewer.entities.remove(e);
    entities = [];
    const { features, visible, selectedId } = useUserLayer.getState();
    if (!visible) return;
    for (const f of features) if (f.visible) addFeature(f, f.id === selectedId);
    const selected = features.find((f) => f.id === selectedId);
    if (selected && useTool.getState().tool === 'edit') addHandles(selected);
  };

  render();
  const unsubLayer = useUserLayer.subscribe(render);
  const unsubTool = useTool.subscribe((s, p) => {
    if (s.tool !== p.tool) render();
  });
  return () => {
    unsubLayer();
    unsubTool();
    if (!viewer.isDestroyed()) for (const e of entities) viewer.entities.remove(e);
  };
}
