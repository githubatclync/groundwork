// Pure logic for the PNG export: output size within GPU limits, "nice" scale-bar lengths, and
// legend contents. No Cesium or DOM dependency, so it is unit-tested.
import type { Style } from '../io/types';
import type { UserFeature } from '../layers/userLayerStore';
import type { UnitSystem } from './units';

export interface SizeLimits {
  /** Largest width or height the GPU can render. */
  maxDim: number;
  /** Cap on total pixels, to keep memory sane. */
  maxPixels: number;
}

export const DEFAULT_LIMITS: SizeLimits = { maxDim: 16384, maxPixels: 120_000_000 };

export interface OutputSize {
  width: number;
  height: number;
  /** The resolution scale actually used (below the requested one when clamped). */
  effectiveScale: number;
  clamped: boolean;
}

/**
 * Size of the exported image for a view of `cssW` x `cssH` CSS pixels on a display with the given
 * pixel ratio, at `scale`x the screen resolution. Shrinks the scale when the GPU or memory cannot
 * hold the full size.
 */
export function outputSize(
  cssW: number,
  cssH: number,
  dpr: number,
  scale: number,
  limits: SizeLimits = DEFAULT_LIMITS,
): OutputSize {
  const rawW = cssW * dpr * scale;
  const rawH = cssH * dpr * scale;
  const shrink = Math.min(
    1,
    limits.maxDim / rawW,
    limits.maxDim / rawH,
    Math.sqrt(limits.maxPixels / (rawW * rawH)),
  );
  const effectiveScale = scale * shrink;
  return {
    width: Math.max(1, Math.floor(cssW * dpr * effectiveScale)),
    height: Math.max(1, Math.floor(cssH * dpr * effectiveScale)),
    effectiveScale,
    clamped: shrink < 1,
  };
}

interface Unit {
  name: string;
  meters: number;
}

const UNITS: Record<UnitSystem, Unit[]> = {
  metric: [
    { name: 'm', meters: 1 },
    { name: 'km', meters: 1000 },
  ],
  imperial: [
    { name: 'ft', meters: 0.3048 },
    { name: 'mi', meters: 1609.344 },
  ],
  nautical: [
    { name: 'm', meters: 1 },
    { name: 'nmi', meters: 1852 },
  ],
};

/** The largest 1, 2, or 5 times a power of ten that does not exceed `x`. */
export function niceNumber(x: number): number {
  if (!(x > 0)) return 0;
  const pow = 10 ** Math.floor(Math.log10(x));
  const m = x / pow;
  return pow * (m >= 5 ? 5 : m >= 2 ? 2 : 1);
}

export interface ScaleBar {
  lengthM: number;
  label: string;
}

/** A round-numbered scale-bar length no longer than `maxMeters`, labelled in the chosen units. */
export function niceScaleBar(maxMeters: number, system: UnitSystem): ScaleBar | null {
  if (!(maxMeters > 0) || !Number.isFinite(maxMeters)) return null;
  const units = UNITS[system];
  const unit = [...units].reverse().find((u) => u.meters <= maxMeters) ?? units[0];
  const n = niceNumber(maxMeters / unit.meters);
  if (n <= 0) return null;
  return { lengthM: n * unit.meters, label: `${n} ${unit.name}` };
}

// ---- legend ----

export type SwatchKind = 'point' | 'line' | 'area';

export interface Swatch {
  kind: SwatchKind;
  /** CSS colors; `fill` is only used by areas and points. */
  stroke: string;
  fill: string | null;
}

export interface LegendEntry {
  label: string;
  swatches: Swatch[];
}

/** `rrggbbaa` to a CSS rgba() string. */
export function rgbaCss(hex: string): string {
  if (!/^[0-9a-fA-F]{8}$/.test(hex)) return 'rgba(255,255,255,1)';
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${n(0)},${n(2)},${n(4)},${(n(6) / 255).toFixed(3)})`;
}

export interface LegendLayer {
  name: string;
  visible: boolean;
  styles: Style[];
  geometryCounts: { points: number; lines: number; polygons: number };
}

/**
 * Legend rows for the visible layers: the layer name with one swatch per kind of geometry it
 * holds, colored from its most representative style (the first non-default one).
 */
export function layerLegendEntries(layers: LegendLayer[]): LegendEntry[] {
  return layers
    .filter((l) => l.visible)
    .map((l) => {
      const s = l.styles[1] ?? l.styles[0];
      const swatches: Swatch[] = [];
      if (s) {
        if (l.geometryCounts.points > 0) {
          swatches.push({
            kind: 'point',
            stroke: 'rgba(0,0,0,0.8)',
            fill: s.icon
              ? rgbaCss(s.icon.color.replace(/^ffffff/i, 'ffc107'))
              : rgbaCss('ffc107ff'),
          });
        }
        if (l.geometryCounts.lines > 0) {
          swatches.push({ kind: 'line', stroke: rgbaCss(s.line.color), fill: null });
        }
        if (l.geometryCounts.polygons > 0) {
          swatches.push({
            kind: 'area',
            stroke: rgbaCss(s.line.color),
            fill: s.poly.fill ? rgbaCss(s.poly.color) : null,
          });
        }
      }
      return { label: l.name, swatches };
    });
}

/** Most user-layer features listed individually before the rest are summarized. */
export const LEGEND_USER_LIMIT = 6;

export function userLegendEntries(features: UserFeature[], visible: boolean): LegendEntry[] {
  if (!visible || features.length === 0) return [];
  const shown = features.filter((f) => f.visible).slice(0, LEGEND_USER_LIMIT);
  const entries: LegendEntry[] = shown.map((f) => ({
    label: f.name,
    swatches: [
      {
        kind: f.kind === 'point' ? 'point' : f.kind === 'line' ? 'line' : 'area',
        stroke: f.style.color,
        fill:
          f.kind === 'polygon'
            ? hexAlpha(f.style.color, f.style.fillOpacity)
            : f.kind === 'point'
              ? f.style.color
              : null,
      },
    ],
  }));
  const rest = features.filter((f) => f.visible).length - shown.length;
  if (rest > 0) entries.push({ label: `+${rest} more in My Places`, swatches: [] });
  return entries;
}

/** `#rrggbb` plus an opacity (0-1) as a CSS rgba() string. */
export function hexAlpha(color: string, alpha: number): string {
  const c = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return `rgba(255,152,0,${alpha})`;
  const n = (i: number) => parseInt(c.slice(i, i + 2), 16);
  return `rgba(${n(0)},${n(2)},${n(4)},${alpha})`;
}
