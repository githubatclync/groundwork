// Converts a finished measurement into a feature of the user layer ("Save as feature").
import type { UserFeature } from '../layers/userLayerStore';
import { compassPoint } from './geodesy';
import type { Measurement } from './measure';
import { formatArea, formatDistance, type AreaUnit, type UnitSystem } from './units';

const round = (v: number, digits: number) => String(Number(v.toFixed(digits)));

export function measurementToFeature(
  m: Measurement,
  system: UnitSystem,
  areaUnit: AreaUnit,
): Omit<UserFeature, 'id'> {
  const coords = m.points.map((p): [number, number] => [p.lon, p.lat]);
  const attrs: Record<string, string> = {};
  const lines: string[] = [];

  if (m.mode === 'area') {
    attrs.area_m2 = round(m.areaM2 ?? 0, 2);
    attrs.perimeter_m = round(m.perimeterM ?? 0, 2);
    lines.push(`Area: ${formatArea(m.areaM2 ?? 0, system, areaUnit)}`);
    lines.push(`Perimeter: ${formatDistance(m.perimeterM ?? 0, system)}`);
  } else {
    attrs.length_m = round(m.totalM, 2);
    lines.push(`Length: ${formatDistance(m.totalM, system)}`);
    if (m.initialAzimuth !== null) {
      attrs.initial_heading_deg = round(m.initialAzimuth, 2);
      lines.push(`Heading: ${m.initialAzimuth.toFixed(1)}° ${compassPoint(m.initialAzimuth)}`);
    }
  }

  const headline =
    m.mode === 'area'
      ? formatArea(m.areaM2 ?? 0, system, areaUnit)
      : formatDistance(m.totalM, system);
  const label = { distance: 'Distance', path: 'Path', area: 'Area' }[m.mode];
  return {
    name: `${label} ${headline}`,
    kind: m.mode === 'area' ? 'polygon' : 'line',
    coords,
    description: lines.join('\n'),
    attrs,
  };
}
