// Renders one imported layer with Cesium's batched Primitive API (not entities), so layers with
// a million vertices stay interactive. Geometry is added in chunks across animation frames.
//   points   -> PointPrimitiveCollection / BillboardCollection (when an embedded icon exists)
//   lines    -> Primitive of PolylineGeometry instances (GroundPolylinePrimitive when clamped on terrain)
//   polygons -> Primitive of PolygonGeometry instances (GroundPrimitive when clamped), outlines as lines
//   overlays -> a handful of rectangle entities with image materials
// Line parts have levels of detail: coarser Douglas-Peucker copies are built on demand and shown
// when the camera is high enough that the lost detail is sub-pixel. Geometry is drawn in Hilbert
// order so chunks are spatially compact and off-screen chunks are culled.
// Folder visibility and layer opacity are applied live by updating per-instance attributes (no
// rebuild); a rebuild is only needed the first time opacity drops below 1 (translucent pass).
// A rebuild draws into a fresh scene graph and swaps it in when ready, so the layer never blanks.
// Every instance id is `{ layerId, featureId }` so picking can map back to the feature table.
import {
  ArcType,
  BillboardCollection,
  BlendOption,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ConstantProperty,
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
  type Billboard,
  type Entity,
  type PerspectiveFrustum,
  type PointPrimitive,
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
import type { FolderNode, LayerManifest, Style } from '../../io/types';
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
const HIGHLIGHT: Rgba = [0, 229, 255, 255];

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type AnyPrimitive = Primitive | GroundPolylinePrimitive | GroundPrimitive;

interface Batch {
  instances: GeometryInstance[];
  /** Instance id objects and source parts, in instance order (for live attribute updates). */
  ids: object[];
  parts: number[];
  vertices: number;
  translucent: boolean;
}

const newBatch = (): Batch => ({
  instances: [],
  ids: [],
  parts: [],
  vertices: 0,
  translucent: false,
});
const isFull = (b: Batch) => b.instances.length >= CHUNK_INSTANCES || b.vertices >= CHUNK_VERTICES;

export interface BuildOptions {
  /** True when real terrain is loaded: clamped geometry then uses ground primitives. */
  terrain: boolean;
  onProgress?: (fraction: number) => void;
}

interface Chunk {
  prim: AnyPrimitive;
  ids: object[];
  parts: number[];
  kind: 'line' | 'fill';
}

interface PointItem {
  obj: PointPrimitive | Billboard;
  part: number;
  base: Rgba;
}

interface LineLevel {
  root: PrimitiveCollection;
  /** Resolves when every chunk of this level has been added. */
  done: Promise<void>;
  ready: boolean;
}

interface OverlayItem {
  entity: Entity;
  index: number;
}

/** One complete scene graph for the layer; rebuilds create a new one and swap it in. */
interface Content {
  root: PrimitiveCollection;
  levels: Map<number, LineLevel>;
  chunks: Chunk[];
  items: PointItem[];
  overlays: OverlayItem[];
  shownLevel: number;
}

export class LayerRenderer {
  private live: Content | null = null;
  private pending: Content | null = null;
  private highlightRoot = new PrimitiveCollection();
  private visible = true;
  private opacity = 1;
  private translucent = false;
  private tree: FolderNode;
  private buildId = 0;
  private terrain = false;
  private order: Int32Array | null = null;
  private cameraListening = false;
  private retry = 0;
  private lineBase: Rgba[];
  private fillBase: Rgba[];

  constructor(
    private viewer: Viewer,
    readonly manifest: LayerManifest,
    private geom: GeometryBuffer,
  ) {
    this.tree = manifest.tree;
    this.lineBase = manifest.styles.map((s) => parseRgba(s.line.color));
    this.fillBase = manifest.styles.map((s) => parseRgba(s.poly.color));
    viewer.scene.primitives.add(this.highlightRoot);
  }

  // ---- public state ----

  setVisible(visible: boolean) {
    this.visible = visible;
    this.highlightRoot.show = visible;
    if (this.live) this.applyShown(this.live);
  }

  /** Applies a new folder tree (visibility checkboxes) without rebuilding. */
  applyVisibility(tree: FolderNode) {
    this.tree = tree;
    if (this.live) this.applyState(this.live);
  }

  /** Sets layer opacity (0..1). The first drop below 1 rebuilds once to enable translucency. */
  setOpacity(opacity: number) {
    this.opacity = opacity;
    if (opacity < 1 && !this.translucent) {
      this.translucent = true;
      if (this.live) void this.build({ terrain: this.terrain });
      return;
    }
    if (this.live) this.applyState(this.live);
  }

  /** Removes everything this renderer added to the scene. */
  destroy() {
    this.buildId++;
    this.stopCameraListening();
    if (this.pending) this.disposeContent(this.pending);
    if (this.live) this.disposeContent(this.live);
    this.pending = this.live = null;
    if (!this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.highlightRoot);
  }

  private disposeContent(c: Content) {
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(c.root);
    for (const o of c.overlays) this.viewer.entities.remove(o.entity);
  }

  private tint(c: Rgba): Color {
    return Color.fromBytes(c[0], c[1], c[2], Math.round(c[3] * this.opacity));
  }

  private positions(a: number, b: number, clamp: boolean, keep?: number[], lift = 0): Cartesian3[] {
    const c = this.geom.coords;
    const n = keep ? keep.length : b - a;
    const out = new Array<Cartesian3>(n);
    for (let i = 0; i < n; i++) {
      const k = (a + (keep ? keep[i] : i)) * 3;
      out[i] = Cartesian3.fromDegrees(c[k], c[k + 1], (clamp ? 0 : c[k + 2]) + lift);
    }
    return out;
  }

  private partShown(part: number, folderVisible: Map<number, boolean>): boolean {
    return (
      !(this.geom.flags[part] & FLAG_HIDDEN) &&
      (folderVisible.get(this.geom.folderIds[part]) ?? true)
    );
  }

  // ---- live attribute updates (visibility, opacity) ----

  private applyShown(c: Content) {
    c.root.show = this.visible;
    this.applyState(c);
  }

  /** Pushes current folder visibility and opacity into every instance of a scene graph. */
  private applyState(c: Content) {
    const folderVisible = effectiveFolderVisibility(this.tree);
    let notReady = 0;
    for (const ch of c.chunks) {
      if (!ch.prim.ready) {
        notReady++;
        continue;
      }
      const bases = ch.kind === 'line' ? this.lineBase : this.fillBase;
      for (let k = 0; k < ch.ids.length; k++) {
        const attrs = ch.prim.getGeometryInstanceAttributes(ch.ids[k]);
        if (!attrs) continue;
        const part = ch.parts[k];
        attrs.show = ShowGeometryInstanceAttribute.toValue(
          this.partShown(part, folderVisible),
          attrs.show,
        );
        attrs.color = ColorGeometryInstanceAttribute.toValue(
          this.tint(bases[this.geom.styleIds[part]] ?? bases[0]),
          attrs.color,
        );
      }
    }
    for (const it of c.items) {
      it.obj.show = this.partShown(it.part, folderVisible);
      it.obj.color = this.tint(it.base);
    }
    for (const o of c.overlays) {
      const def = this.manifest.overlays[o.index];
      o.entity.show = this.visible && def.visible && (folderVisible.get(def.folder) ?? true);
      const mat = o.entity.rectangle?.material;
      if (mat instanceof ImageMaterialProperty) {
        mat.color = new ConstantProperty(
          Color.WHITE.withAlpha((parseRgba(def.color)[3] / 255) * this.opacity),
        );
      }
    }
    // Primitives still being created by workers can't be updated yet: try again shortly.
    if (notReady > 0 && this.retry++ < 40) {
      setTimeout(() => {
        if (this.live === c) this.applyState(c);
      }, 250);
    } else if (notReady === 0) {
      this.retry = 0;
    }
  }

  // ---- highlight ----

  /** Parts [start, end) belonging to a feature (parts are stored in feature order). */
  private partsOfFeature(feature: number): [number, number] {
    const ids = this.geom.featureIds;
    let lo = 0;
    let hi = ids.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ids[mid] < feature) lo = mid + 1;
      else hi = mid;
    }
    const start = lo;
    hi = ids.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ids[mid] <= feature) lo = mid + 1;
      else hi = mid;
    }
    return [start, lo];
  }

  /** Draws an emphasis overlay for one feature (or clears it with null). */
  setHighlight(featureId: number | null) {
    this.highlightRoot.removeAll();
    if (featureId === null) return;
    const g = this.geom;
    const [start, end] = this.partsOfFeature(featureId);
    const color = ColorGeometryInstanceAttribute.fromColor(
      Color.fromBytes(HIGHLIGHT[0], HIGHLIGHT[1], HIGHLIGHT[2], HIGHLIGHT[3]),
    );
    const points = new PointPrimitiveCollection();
    const lines: GeometryInstance[] = [];
    const groundLines: GeometryInstance[] = [];
    const ground = this.terrain && GroundPolylinePrimitive.isSupported(this.viewer.scene);
    for (let p = start; p < end; p++) {
      const a = g.offsets[p];
      const b = g.offsets[p + 1];
      const flags = g.flags[p];
      const clamp = (flags & FLAG_ALT_MASK) === ALT_CLAMP;
      const style = this.manifest.styles[g.styleIds[p]] ?? this.manifest.styles[0];
      if (g.types[p] === GEOM_POINT) {
        const k = a * 3;
        points.add({
          position: Cartesian3.fromDegrees(
            g.coords[k],
            g.coords[k + 1],
            clamp ? 0 : g.coords[k + 2],
          ),
          pixelSize: 16,
          color: Color.fromBytes(HIGHLIGHT[0], HIGHLIGHT[1], HIGHLIGHT[2], 70),
          outlineColor: Color.fromBytes(HIGHLIGHT[0], HIGHLIGHT[1], HIGHLIGHT[2], 255),
          outlineWidth: 3,
        });
      } else {
        const width = Math.max(1, style.line.width) + 4;
        if (clamp && ground) {
          groundLines.push(
            new GeometryInstance({
              geometry: new GroundPolylineGeometry({
                positions: this.positions(a, b, true),
                width,
              }),
              attributes: { color },
            }),
          );
        } else {
          lines.push(
            new GeometryInstance({
              geometry: new PolylineGeometry({
                // Lifted a little so the emphasis line does not z-fight the layer's own line.
                positions: this.positions(a, b, clamp, undefined, 5),
                width,
                vertexFormat: PolylineColorAppearance.VERTEX_FORMAT,
                arcType: flags & FLAG_TESSELLATE ? ArcType.GEODESIC : ArcType.NONE,
              }),
              attributes: { color },
            }),
          );
        }
      }
    }
    this.highlightRoot.add(points);
    const appearance = () => new PolylineColorAppearance({ translucent: false });
    if (lines.length) {
      this.highlightRoot.add(
        new Primitive({
          geometryInstances: lines,
          appearance: appearance(),
          asynchronous: false,
          allowPicking: false,
        }),
      );
    }
    if (groundLines.length) {
      this.highlightRoot.add(
        new GroundPolylinePrimitive({
          geometryInstances: groundLines,
          appearance: appearance(),
          asynchronous: false,
          allowPicking: false,
        }),
      );
    }
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
    const c = this.live;
    if (!c) return;
    const level = this.desiredLevel();
    if (level === c.shownLevel) return;
    const id = this.buildId;
    void this.ensureLevel(c, level).then(() => {
      // Apply only if nothing was rebuilt meanwhile and this is still the level the camera wants.
      if (id === this.buildId && this.live === c && level === this.desiredLevel()) {
        void this.showLevel(c, level);
      }
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

  /** Waits (bounded) for a scene graph's primitives to finish their worker-side creation. */
  private async whenReady(c: Content, maxFrames = 600) {
    for (let i = 0; i < maxFrames; i++) {
      if (c.chunks.every((ch) => ch.prim.ready)) return;
      await nextFrame();
    }
  }

  /** Makes a level visible, and hides the others once the new one has finished creating. */
  private async showLevel(c: Content, level: number) {
    const target = c.levels.get(level);
    if (!target?.ready) return;
    target.root.show = true;
    c.shownLevel = level;
    await this.whenReady(c, 180);
    if (this.live !== c || c.shownLevel !== level) return;
    for (const [k, l] of c.levels) l.root.show = k === level;
    this.applyState(c);
  }

  /** Builds (once) the line primitives for a level of detail. */
  private ensureLevel(c: Content, level: number): Promise<void> {
    const existing = c.levels.get(level);
    if (existing) return existing.done;
    const root = new PrimitiveCollection();
    root.show = false;
    c.root.add(root);
    const lvl: LineLevel = { root, ready: false, done: Promise.resolve() };
    c.levels.set(level, lvl);
    const id = this.buildId;
    lvl.done = this.pass(id, c, { base: false, level, target: root }).then(() => {
      if (id === this.buildId) lvl.ready = true;
    });
    return lvl.done;
  }

  // ---- building ----

  /** (Re)builds all geometry into a fresh scene graph and swaps it in. */
  async build({ terrain, onProgress }: BuildOptions): Promise<void> {
    const id = ++this.buildId;
    if (this.pending) this.disposeContent(this.pending);
    this.terrain = terrain;
    const g = this.geom;
    this.order = g.partCount <= MAX_SORTABLE_UNITS ? spatiallySortedUnits(g) : drawUnits(g.types);

    const c: Content = {
      root: new PrimitiveCollection(),
      levels: new Map(),
      chunks: [],
      items: [],
      overlays: [],
      shownLevel: -1,
    };
    c.root.show = false;
    this.viewer.scene.primitives.add(c.root);
    this.pending = c;

    // Base content plus the line level the camera currently needs, in a single pass.
    const level = this.desiredLevel();
    const lroot = new PrimitiveCollection();
    c.root.add(lroot);
    const lvl: LineLevel = { root: lroot, ready: false, done: Promise.resolve() };
    c.levels.set(level, lvl);
    lvl.done = this.pass(id, c, { base: true, level, target: lroot, onProgress });
    await lvl.done;
    if (id !== this.buildId) return;
    lvl.ready = true;
    c.shownLevel = level;

    // Show the new scene graph (this starts primitive creation), then retire the old one.
    this.addOverlays(c);
    c.root.show = this.visible;
    await this.whenReady(c);
    if (id !== this.buildId) return; // a newer build disposed this one
    this.pending = null;
    const old = this.live;
    this.live = c;
    if (old) this.disposeContent(old);
    this.applyState(c);
    this.startCameraListening();
    onProgress?.(1);
  }

  /**
   * One walk over the drawable units. With `base`, draws points and polygons (plus their
   * outlines); lines are always drawn at `level` into `target`.
   */
  private async pass(
    id: number,
    content: Content,
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
    const folderVisible = effectiveFolderVisibility(this.tree);
    const groundLines = terrain && GroundPolylinePrimitive.isSupported(this.viewer.scene);
    // Ground classification is costly; on a plain ellipsoid, geometry at height 0 looks the same.
    const groundFills = terrain && GroundPrimitive.isSupported(this.viewer.scene);
    const tolerance = LOD_TOLERANCES_DEG[level] ?? 0;
    const edgeRoot = content.root;

    let dense = false;
    let points: PointPrimitiveCollection | undefined;
    let billboards: BillboardCollection | undefined;
    if (base) {
      let pointCount = 0;
      for (let k = 0; k < g.partCount; k++) if (g.types[k] === GEOM_POINT) pointCount++;
      dense = pointCount > DENSE_POINT_COUNT;
      const translucentPoints =
        this.translucent || m.styles.some((s) => parseRgba(s.icon?.color ?? 'ffffffff')[3] < 255);
      points = new PointPrimitiveCollection({
        blendOption:
          dense && !translucentPoints ? BlendOption.OPAQUE : BlendOption.OPAQUE_AND_TRANSLUCENT,
      });
      billboards = new BillboardCollection({ scene: this.viewer.scene });
      edgeRoot.add(points);
      edgeRoot.add(billboards);
    }

    const flushLines = (b: Batch, ground: boolean, into: PrimitiveCollection) => {
      if (!b.instances.length) return;
      const appearance = new PolylineColorAppearance({
        translucent: b.translucent || this.translucent,
      });
      const prim: AnyPrimitive = ground
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
          });
      into.add(prim);
      content.chunks.push({ prim, ids: b.ids, parts: b.parts, kind: 'line' });
    };
    const flushFills = (b: Batch, ground: boolean) => {
      if (!b.instances.length) return;
      const appearance = new PerInstanceColorAppearance({
        translucent: b.translucent || this.translucent,
        closed: false,
        flat: true,
      });
      const prim: AnyPrimitive = ground
        ? new GroundPrimitive({ geometryInstances: b.instances, appearance, asynchronous: true })
        : new Primitive({
            geometryInstances: b.instances,
            appearance,
            asynchronous: true,
            releaseGeometryInstances: true,
          });
      edgeRoot.add(prim);
      content.chunks.push({ prim, ids: b.ids, parts: b.parts, kind: 'fill' });
    };

    // Line batches: `lod*` hold line parts (at this level); `edge*` hold polygon outlines (full detail).
    let lodLines = newBatch();
    let lodGround = newBatch();
    let edgeLines = newBatch();
    let edgeGround = newBatch();
    let fills = newBatch();
    let gFills = newBatch();

    const addLine = (
      part: number,
      a: number,
      b: number,
      flags: number,
      style: Style,
      featureId: number,
      simplify: boolean,
    ) => {
      const clamp = (flags & FLAG_ALT_MASK) === ALT_CLAMP;
      const ground = clamp && groundLines;
      const keep =
        simplify && tolerance > 0 ? simplifyIndices(g.coords, a, b, tolerance) : undefined;
      const positions = this.positions(a, b, clamp, keep);
      const color = this.lineBase[g.styleIds[part]] ?? parseRgba(style.line.color);
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
      const idObj = { layerId, featureId };
      batch.instances.push(
        new GeometryInstance({
          geometry,
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(this.tint(color)),
            show: new ShowGeometryInstanceAttribute(this.partShown(part, folderVisible)),
          },
          id: idObj,
        }),
      );
      batch.ids.push(idObj);
      batch.parts.push(part);
      batch.vertices += positions.length;
      if (color[3] < 255) batch.translucent = true;
      if (isFull(batch)) {
        flushLines(batch, ground, simplify ? target : edgeRoot);
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
      const show = this.partShown(i, folderVisible);
      const a = g.offsets[i];
      const b = g.offsets[i + 1];
      const clamp = (flags & FLAG_ALT_MASK) === ALT_CLAMP;

      if (type === GEOM_POINT && points && billboards) {
        const k = a * 3;
        const alt = clamp ? 0 : g.coords[k + 2];
        const position = Cartesian3.fromDegrees(g.coords[k], g.coords[k + 1], alt);
        const icon = style.icon;
        if (icon && icon.href && !icon.remote) {
          const baseColor = parseRgba(icon.color);
          const bb = billboards.add({
            position,
            image: layerResourceUrl(layerId, icon.href),
            scale: icon.scale,
            rotation: -CesiumMath.toRadians(icon.heading),
            color: this.tint(baseColor),
            heightReference:
              clamp && terrain ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
            show,
            id: { layerId, featureId },
          });
          content.items.push({ obj: bb, part: i, base: baseColor });
        } else {
          const baseColor = pointColor(icon?.color);
          const pp = points.add({
            position,
            pixelSize: dense ? 4 : Math.min(16, 6 + 2 * (icon?.scale ?? 1)),
            color: this.tint(baseColor),
            outlineColor: Color.BLACK,
            outlineWidth: dense ? 0 : 1,
            show,
            id: { layerId, featureId },
          });
          content.items.push({ obj: pp, part: i, base: baseColor });
        }
        work += 4;
      } else if (type === GEOM_LINE) {
        work += addLine(i, a, b, flags, style, featureId, true);
      } else if (type === GEOM_POLY_OUTER && base) {
        const poly = polygonAt(g.types, i);
        const ground = clamp && groundFills;
        if (style.poly.fill) {
          const outer = this.positions(a, b, clamp);
          const holes = poly.holes.map(
            (h) => new PolygonHierarchy(this.positions(g.offsets[h], g.offsets[h + 1], clamp)),
          );
          const color = this.fillBase[g.styleIds[i]] ?? parseRgba(style.poly.color);
          const geometry = new PolygonGeometry({
            polygonHierarchy: new PolygonHierarchy(outer, holes),
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
            ...(ground || clamp
              ? {}
              : { perPositionHeight: true, extrudedHeight: flags & FLAG_EXTRUDE ? 0 : undefined }),
          });
          const batch = ground ? gFills : fills;
          const idObj = { layerId, featureId };
          batch.instances.push(
            new GeometryInstance({
              geometry,
              attributes: {
                color: ColorGeometryInstanceAttribute.fromColor(this.tint(color)),
                show: new ShowGeometryInstanceAttribute(show),
              },
              id: idObj,
            }),
          );
          batch.ids.push(idObj);
          batch.parts.push(i);
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
          addLine(i, a, b, flags, style, featureId, false);
          for (const h of poly.holes)
            addLine(h, g.offsets[h], g.offsets[h + 1], flags, style, featureId, false);
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
    flushLines(edgeLines, false, edgeRoot);
    flushLines(edgeGround, true, edgeRoot);
    flushFills(fills, false);
    flushFills(gFills, true);
  }

  private addOverlays(c: Content) {
    this.manifest.overlays.forEach((o, index) => {
      const rotation = CesiumMath.toRadians(o.rotation);
      const entity = this.viewer.entities.add({
        name: o.name,
        show: false,
        rectangle: {
          coordinates: Rectangle.fromDegrees(o.west, o.south, o.east, o.north),
          // KML and Cesium both measure rotation counter-clockwise from north.
          rotation,
          stRotation: rotation,
          material: new ImageMaterialProperty({
            image: layerResourceUrl(this.manifest.id, o.href),
            transparent: true,
            color: Color.WHITE.withAlpha((parseRgba(o.color)[3] / 255) * this.opacity),
          }),
        },
      });
      c.overlays.push({ entity, index });
    });
    const folderVisible = effectiveFolderVisibility(this.tree);
    for (const o of c.overlays) {
      const def = this.manifest.overlays[o.index];
      o.entity.show = this.visible && def.visible && (folderVisible.get(def.folder) ?? true);
    }
  }
}
