// Unit systems and formatting for distances and areas (metric, imperial, nautical; auto/ha/acres).
export type UnitSystem = 'metric' | 'imperial' | 'nautical';
/** Area display: pick the unit automatically, or force hectares or acres. */
export type AreaUnit = 'auto' | 'hectares' | 'acres';

const FOOT_M = 0.3048;
const MILE_M = 1609.344;
const NAUTICAL_MILE_M = 1852;
const HECTARE_M2 = 10_000;
const ACRE_M2 = 4046.8564224;
const SQ_FOOT_M2 = FOOT_M * FOOT_M;
const SQ_MILE_M2 = MILE_M * MILE_M;
const SQ_KM_M2 = 1_000_000;

const num = (v: number, digits: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatDistance(meters: number, system: UnitSystem): string {
  if (system === 'imperial') {
    const ft = meters / FOOT_M;
    return ft < 1000 ? `${num(ft, 1)} ft` : `${num(meters / MILE_M, 3)} mi`;
  }
  if (system === 'nautical') return `${num(meters / NAUTICAL_MILE_M, 3)} nmi`;
  return meters < 1000 ? `${num(meters, meters < 10 ? 2 : 1)} m` : `${num(meters / 1000, 3)} km`;
}

export function formatArea(m2: number, system: UnitSystem, areaUnit: AreaUnit = 'auto'): string {
  if (areaUnit === 'hectares') return `${num(m2 / HECTARE_M2, 2)} ha`;
  if (areaUnit === 'acres') return `${num(m2 / ACRE_M2, 2)} ac`;
  if (system === 'imperial') {
    if (m2 < ACRE_M2) return `${num(m2 / SQ_FOOT_M2, 0)} ft²`;
    return m2 < 640 * ACRE_M2 ? `${num(m2 / ACRE_M2, 2)} ac` : `${num(m2 / SQ_MILE_M2, 3)} mi²`;
  }
  if (m2 < HECTARE_M2) return `${num(m2, 1)} m²`;
  return m2 < SQ_KM_M2 ? `${num(m2 / HECTARE_M2, 2)} ha` : `${num(m2 / SQ_KM_M2, 3)} km²`;
}

export const UNIT_SYSTEMS: { id: UnitSystem; label: string }[] = [
  { id: 'metric', label: 'Metric (m, km)' },
  { id: 'imperial', label: 'Imperial (ft, mi)' },
  { id: 'nautical', label: 'Nautical (nmi)' },
];

export const AREA_UNITS: { id: AreaUnit; label: string }[] = [
  { id: 'auto', label: 'Area: automatic' },
  { id: 'hectares', label: 'Area: hectares' },
  { id: 'acres', label: 'Area: acres' },
];
