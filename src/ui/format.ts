// Display formatting for feature details (metric; unit options arrive with the measure tools in M4).
export function formatLength(meters: number): string {
  if (meters < 1000) return `${meters.toFixed(1)} m`;
  return `${(meters / 1000).toFixed(meters < 100_000 ? 2 : 1)} km`;
}

export function formatArea(m2: number): string {
  if (m2 < 10_000) return `${m2.toFixed(1)} m²`;
  if (m2 < 1_000_000) return `${(m2 / 10_000).toFixed(2)} ha`;
  return `${(m2 / 1_000_000).toFixed(m2 < 100_000_000 ? 2 : 1)} km²`;
}
