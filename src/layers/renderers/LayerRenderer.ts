// Renders one imported layer with Cesium's batched Primitive API (not entities), so layers with
// a million vertices stay interactive. Geometry is added in chunks across animation frames.
//   points   -> PointPrimitiveCollection / BillboardCollection (when an embedded icon exists)
//   lines    -> Primitive of PolylineGeometry instances (GroundPolylinePrimitive when clamped on terrain)
//   polygons -> Primitive of PolygonGeometry instances (GroundPrimitive when clamped), outlines as lines
//   overlays -> a handful of rectangle entities with image materials
// Line parts have levels of detail: coarser Douglas-Peucker copies are built on demand and shown
// when the camera is high enough that the lost detail is sub-pixel. Geometry is drawn in Z-order
// so chunks are spatially compact (Hilbert order) and off-screen chunks are culled.
// Every instance id is `{ layerId, featureId }` so picking can map back to the feature table.
import {
  ArcType,
  BillboardCollection,
  BlendOption,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  GroundPolylineGeometry,
  GroundPolylinePrimitive,
  GroundPrimitive,
  HeightReference,
  ImageMaterialProperty,
  Math as CesiumMath,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineColorAppearance,
  PolylineGeometry,
  Primitive,
  PrimitiveCollection,
  Rectangle,
  ShowGeometryInstanceAttribute,
  type Entity,
  type PerspectiveFrustum,
  type Viewer,
} from 'cesium';
import {
  ALT_CLAMP,
  FLAG_ALT_MASK,
  FLAG_EXTRUDE,
  FLAG_HIDDEN,
  FLAG_TESSELLATE,
  GEOM_LINE,
  GEOM_POINT,
  GEOM_POLY_OUTER,
  type GeometryBuffer,
} from '../../io/geometry';
import { layerResourceUrl } from '../../io/scheme';
import type { LayerManifest, Style } from '../../io/types';
import { effectiveFolderVisibility } from '../folderVisibility';
import { parseRgba, pointColor, type Rgba } from './colors';
import { polygonAt } from './partGroups';
import { MAX_SORTABLE_UNITS, drawUnits, spatiallySortedUnits } from './partOrder';
import { LOD_TOLERANCES_DEG, lodForPixelSize, pixelSizeDegrees, simplifyIndices } from './simplify';

/** Instances per Primitive; large layers are split so no single build freezes the UI. */
export const CHUNK_INSTANCES = 10_000;
/** Vertices converted per animation frame before yielding. */
const WORK_PER_FRAME = 150_000;
const CHUNK_VERTICES = 40_000;
/** Point layers above this size use small opaque dots: far cheaper to fill when heavily overlapped. */
const DENSE_POINT_COUNT = 50_000;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const toColor = (c: Rgba) => Color.fromBytes(c[0], c[1], c[2], c[3]);

interface Batch {
  instances: GeometryInstance[];
  vertices: number;
  translucent: boolean;
}

const newBatch = (): Batch => ({ instances: [], vertices: 0, translucent: false });
const isFull = (b: Batch) => b.instances.length >= CHUNK_INSTANCES || b.vertices >= CHUNK_VERTICES;

export interface BuildOptions {
  /** True when real terrain is loaded: clamped geometry then uses ground primitives. */
  terrain: boolean;
  onProgress?: (fraction: number) => void;
}

interface LineLevel {
  root: PrimitiveCollection;
  /** Resolves when every chunk of this level has been added. */
  done: Promise<void>;
  ready: boolean;
}

export class LayerRenderer {
  private root = new PrimitiveCollection();
  private entities: { entity: Entity; base: boolean }[] = [];
  private visible = true;
  private buildId = 0;
  private terrain = false;
  private order: Int32Array | null = null;
  private levels = new Map<number, LineLevel>();
  private shownLevel = -1;
  private cameraListening = false;

  constructor(
    private viewer: Viewer,
    readonly manifest: LayerManifest,
    private geom: GeometryBuffer,
  ) {
    viewer.scene.primitives.add(this.root);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.root.show = visible;
    for (const e of this.entities) e.entity.show = visible && e.base;
  }

  /** Removes everything this renderer added to the scene. */
  destroy() {
    this.buildId++;
    this.stopCameraListening();
    this.clear();
    if (!this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.root);
  }

  private clear() {
    this.root.removeAll();
    this.levels.clear();
    this.shownLevel = -1;
    if (!this.viewer.isDestroyed())
      for (const e of this.entities) this.viewer.entities.remove(e.entity);
    this.entities = [];
  }

  private positions(a: number, b: number, clamp: boolean, keep?: number[]): Cartesian3[] {
    const c = this.geom.coords;
    const n = keep ? keep.length : b - a;
    const out = new Array<Cartesian3>(n);
    for (let i = 0; i < n; i++) {
      const k = (a + (keep ? keep[i] : i)) * 3;
      out[i] = Cartesian3.fromDegrees(c[k], c[k + 1], clamp ? 0 : c[k + 2]);
    }
    return out;
  }

  // ---- level of detail ----

  private desiredLevel(): number {
    const camera = this.viewer.camera;
    const fovy = (camera.frustum as PerspectiveFrustum).fovy ?? Math.PI / 3;
    const px = pixelSizeDegrees(
      camera.positionCartographic.height,
      fovy,
      this.viewer.canvas.clientHeight,
    );
    return lodForPixelSize(px);
  }

  private onCameraChanged = () => {
    const level = this.desiredLevel();
    if (level === this.shownLevel) return;
    const id = this.buildId;
    void this.ensureLevel(level).then(() => {
      // Apply only if the build is current and this is still the level the camera wants.
      if (id === this.buildId && level === this.desiredLevel()) this.showLevel(level);
    });
  };

  private startCameraListening() {
    if (this.cameraListening) return;
    this.cameraListening = true;
    this.viewer.camera.percentageChanged = 0.05;
    this.viewer.camera.changed.addEventListener(this.onCameraChanged);
    this.viewer.camera.moveEnd.addEventListener(this.onCameraChanged);
  }

  private stopCameraListening() {
    if (!this.cameraListening || this.viewer.isDestroyed()) return;
    this.cameraListening = false;
    this.viewer.camera.changed.removeEventListener(this.onCameraChanged);
    this.viewer.camera.moveEnd.removeEventListener(this.onCameraChanged);
  }

  private showLevel(level: number) {
    for (const [k, l] of this.levels) l.root.show = k === level && l.ready;
    this.shownLevel = level;
  }

  /** Builds (once) the line primitives for a level of detail. */
  private ensureLevel(level: number): Promise<void> {
    const existing = this.levels.get(level);
    if (existing) return existing.done;
    const root = new PrimitiveCollection();
    root.show = false;
    this.root.add(root);
    const lvl: LineLevel = { root, ready: false, done: Promise.resolve() };
    this.levels.set(level, lvl);
    const id = this.buildId;
    lvl.done = this.pass(id, { base: false, level, target: root }).then(() => {
      if (id === this.buildId) lvl.ready = true;
    });
    return lvl.done;
  }

  // ---- building ----

  /** (Re)builds all geometry. Safe to call again, e.g. after terrain loads. */
  async build({ terrain, onProgress }: BuildOptions): Promise<void> {
    const id = ++this.buildId;
    this.clear();
    this.terrain = terrain;
    const g = this.geom;
    this.order = g.partCount <= MAX_SORTABLE_UNITS ? spatiallySortedUnits(g) : drawUnits(g.types);

    // Base content plus the line level the camera currently needs, in a single pass.
    const level = this.desiredLevel();
    const root = new PrimitiveCollection();
    root.show = false;
    this.root.add(root);
    const lvl: LineLevel = { root, ready: false, done: Promise.resolve() };
    this.levels.set(level, lvl);
    lvl.done = this.pass(id, { base: true, level, target: root, onProgress });
    await lvl.done;
    if (id !== this.buildId) return;
    lvl.ready = true;
    this.showLevel(level);
    this.addOverlays(effectiveFolderVisibility(this.manifest.tree));
    this.setVisible(this.visible);
    this.startCameraListening();
    onProgress?.(1);
  }

  /**
   * One walk over the drawable units. With `base`, draws points and polygons (plus their
   * outlines); lines are always drawn at `level` into `target`.
   */
  private async pass(
    id: number,
    opts: {
      base: boolean;
      level: number;
      target: PrimitiveCollection;
      onProgress?: (f: number) => void;
    },
  ): Promise<void> {
    const { base, level, target, onProgress } = opts;
    const g = this.geom;
    const m = this.manifest;
    const layerId = m.id;
    const terrain = this.terrain;
    const order = this.order ?? drawUnits(g.types);
    const folderVisible = effectiveFolderVisibility(m.tree);
    const groundLines = terrain && GroundPolylinePrimitive.isSupported(this.viewer.scene);
    // Ground classification is costly; on a plain ellipsoid, geometry at height 0 looks the same.
    const groundFills = terrain && GroundPrimitive.isSupported(this.viewer.scene);
    const tolerance = LOD_TOLERANCES_DEG[level] ?? 0;

    let dense = false;
    let points: PointPrimitiveCollection | undefined;
    let billboards: BillboardCollection | undefined;
    if (base) {
      let pointCount = 0;
      for (let k = 0; k < g.partCount; k++) if (g.types[k] === GEOM_POINT) pointCount++;
      dense = pointCount > DENSE_POINT_COUNT;
      const translucentPoints = m.styles.some(
        (s) => parseRgba(s.icon?.color ?? 'ffffffff')[3] < 255,
      );
      points = new PointPrimitiveCollection({
        blendOption:
          dense && !translucentPoints ? BlendOption.OPAQUE : BlendOption.OPAQUE_AND_TRANSLUCENT,
      });
      billboards = new BillboardCollection({ scene: this.viewer.scene });
      this.root.add(points);
      this.root.add(billboards);
    }

    const flushLines = (b: Batch, ground: boolean, into: PrimitiveCollection) => {
      if (!b.instances.length) return;
      const appearance = new PolylineColorAppearance({ translucent: b.translucent });
      into.add(
        ground
          ? new GroundPolylinePrimitive({
              geometryInstances: b.instances,
              appearance,
              asynchronous: true,
            })
          : new Primitive({
              geometryInstances: b.instances,
              appearance,
              asynchronous: true,
              releaseGeometryInstances: true,
            }),
      );
    };
    const flushFills = (b: Batch, ground: boolean) => {
      if (!b.instances.length) return;
      const appearance = new PerInstanceColorAppearance({
        translucent: b.translucent,
        closed: false,
        flat: true,
      });
      this.root.add(
        ground
          ? new GroundPrimitive({ geometryInstances: b.instances, appearance, asynchronous: true })
          : new Primitive({
              geometryInstances: b.instances,
              appearance,
              asynchronous: true,
              releaseGeometryInstances: true,
            }),
      );
    };

    // Line batches: `lod*` hold line parts (at this level); `edge*` hold polygon outlines (full detail).
    let lodLines = newBatch();
    let lodGround = newBatch();
    let edgeLines = newBatch();
    let edgeGround = newBatch();
    let fills = newBatch();
    let gFills = newBatch();

    const addLine = (
      a: number,
      b: number,
      flags: number,
      style: Style,
      featureId: number,
      show: boolean,
      simplify: boolean,
    ) => {
      const clamp = (flags & FLAG_ALT_MASK) === ALT_CLAMP;
      const ground = clamp && groundLines;
      const keep =
        simplify && tolerance > 0 ? simplifyIndices(g.coords, a, b, tolerance) : undefined;
      const positions = this.positions(a, b, clamp, keep);
      const color = parseRgba(style.line.color);
      const width = Math.max(1, style.line.width);
      const geometry = ground
        ? new GroundPolylineGeometry({ positions, width })
        : new PolylineGeometry({
            positions,
            width,
            vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
            arcType: flags & FLAG_TESSELLATE ? ArcType.GEODESIC : ArcType.NONE,
          });
      const batch = simplify ? (ground ? lodGround : lodLines) : ground ? edgeGround : edgeLines;
      batch.instances.push(
        new GeometryInstance({
          geometry,
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(toColor(color)),
            show: new ShowGeometryInstanceAttribute(show),
          },
          id: { layerId, featureId },
        }),
      );
      batch.vertices += positions.length;
      if (color[3] < 255) batch.translucent = true;
      if (isFull(batch)) {
        flushLines(batch, ground, simplify ? target : this.root);
        const fresh = newBatch();
        if (simplify) {
          if (ground) lodGround = fresh;
          else lodLines = fresh;
        } else if (ground) edgeGround = fresh;
        else edgeLines = fresh;
      }
      return b - a;
    };

    let work = 0;
    for (let u = 0; u < order.length; u++) {
      if (id !== this.buildId) return; // superseded by a newer build or destroyed
      const i = order[u];
      const type = g.types[i];
      if (type !== GEOM_LINE && !base) continue;
      const flags = g.flags[i];
      const featureId = g.featureIds[i];
      const style = m.styles[g.styleIds[i]] ?? m.styles[0];
      const show = !(flags & FLAG_HIDDEN) && (folderVisible.get(g.folderIds[i]) ?? true);
      const a = g.offsets[i];
      const b = g.offsets[i + 1];
      const clamp = (flags & FLAG_ALT_MASK) === ALT_CLAMP;

      if (type === GEOM_POINT && points && billboards) {
        const k = a * 3;
        const alt = clamp ? 0 : g.coords[k + 2];
        const position = Cartesian3.fromDegrees(g.coords[k], g.coords[k + 1], alt);
        const icon = style.icon;
        if (icon && icon.href && !icon.remote) {
          billboards.add({
            position,
            image: layerResourceUrl(layerId, icon.href),
            scale: icon.scale,
            rotation: -CesiumMath.toRadians(icon.heading),
            color: toColor(parseRgba(icon.color)),
            heightReference:
              clamp && terrain ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
            show,
            id: { layerId, featureId },
          });
        } else {
          points.add({
            position,
            pixelSize: dense ? 4 : Math.min(16, 6 + 2 * (icon?.scale ?? 1)),
            color: toColor(pointColor(icon?.color)),
            outlineColor: Color.BLACK,
            outlineWidth: dense ? 0 : 1,
            show,
            id: { layerId, featureId },
          });
        }
        work += 4;
      } else if (type === GEOM_LINE) {
        work += addLine(a, b, flags, style, featureId, show, true);
      } else if (type === GEOM_POLY_OUTER && base) {
        const poly = polygonAt(g.types, i);
        const ground = clamp && groundFills;
        if (style.poly.fill) {
          const outer = this.positions(a, b, clamp);
          const holes = poly.holes.map(
            (h) => new PolygonHierarchy(this.positions(g.offsets[h], g.offsets[h + 1], clamp)),
          );
          const color = parseRgba(style.poly.color);
          const geometry = new PolygonGeometry({
            polygonHierarchy: new PolygonHierarchy(outer, holes),
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
            ...(ground || clamp
              ? {}
              : { perPositionHeight: true, extrudedHeight: flags & FLAG_EXTRUDE ? 0 : undefined }),
          });
          const batch = ground ? gFills : fills;
          batch.instances.push(
            new GeometryInstance({
              geometry,
              attributes: {
                color: ColorGeometryInstanceAttribute.fromColor(toColor(color)),
                show: new ShowGeometryInstanceAttribute(show),
              },
              id: { layerId, featureId },
            }),
          );
          let ringVerts = b - a;
          for (const h of poly.holes) ringVerts += g.offsets[h + 1] - g.offsets[h];
          batch.vertices += ringVerts;
          if (color[3] < 255) batch.translucent = true;
          if (isFull(batch)) {
            flushFills(batch, ground);
            if (ground) gFills = newBatch();
            else fills = newBatch();
          }
        }
        if (style.poly.outline) {
          addLine(a, b, flags, style, featureId, show, false);
          for (const h of poly.holes)
            addLine(g.offsets[h], g.offsets[h + 1], flags, style, featureId, show, false);
        }
        for (let p = i; p < poly.next; p++) work += g.offsets[p + 1] - g.offsets[p];
      }

      if (work >= WORK_PER_FRAME) {
        work = 0;
        onProgress?.(u / order.length);
        await nextFrame();
      }
    }
    if (id !== this.buildId) return;
    flushLines(lodLines, false, target);
    flushLines(lodGround, true, target);
    flushLines(edgeLines, false, this.root);
    flushLines(edgeGround, true, this.root);
    flushFills(fills, false);
    flushFills(gFills, true);
    if (base) this.setVisible(this.visible);
  }

  private addOverlays(folderVisible: Map<number, boolean>) {
    for (const o of this.manifest.overlays) {
      const alpha = parseRgba(o.color)[3] / 255;
      const rotation = CesiumMath.toRadians(o.rotation);
      const entity = this.viewer.entities.add({
        name: o.name,
        rectangle: {
          coordinates: Rectangle.fromDegrees(o.west, o.south, o.east, o.north),
          // KML and Cesium both measure rotation counter-clockwise from north.
          rotation,
          stRotation: rotation,
          material: new ImageMaterialProperty({
            image: layerResourceUrl(this.manifest.id, o.href),
            transparent: true,
            color: Color.WHITE.withAlpha(alpha),
          }),
        },
      });
      this.entities.push({ entity, base: o.visible && (folderVisible.get(o.folder) ?? true) });
    }
  }
}
