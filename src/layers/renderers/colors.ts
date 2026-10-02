// Parses the `rrggbbaa` hex colors that the Rust importer resolves from KML's `aabbggrr`.
export type Rgba = [r: number, g: number, b: number, a: number];

export function parseRgba(hex: string): Rgba {
  if (!/^[0-9a-fA-F]{8}$/.test(hex)) return [255, 255, 255, 255];
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
    parseInt(hex.slice(6, 8), 16),
  ];
}

/** KML's default point marker is a yellow pin, so an untinted (white) icon renders amber. */
export const DEFAULT_POINT_COLOR: Rgba = [255, 193, 7, 255];

export function pointColor(iconColor: string | undefined): Rgba {
  const c = iconColor ? parseRgba(iconColor) : DEFAULT_POINT_COLOR;
  return c[0] === 255 && c[1] === 255 && c[2] === 255
    ? [DEFAULT_POINT_COLOR[0], DEFAULT_POINT_COLOR[1], DEFAULT_POINT_COLOR[2], c[3]]
    : c;
}
