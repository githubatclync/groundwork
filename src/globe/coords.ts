// Coordinate formatting for the status bar: decimal degrees (DD), degrees/minutes/seconds (DMS),
// and UTM. Pure functions, no Cesium dependency.
export type CoordFormat = 'dd' | 'dms' | 'utm';

export function formatDD(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

function dmsPart(value: number, pos: string, neg: string): string {
  const tenths = Math.round(Math.abs(value) * 36000); // tenths of an arcsecond avoids 60" carry bugs
  const deg = Math.floor(tenths / 36000);
  const min = Math.floor((tenths % 36000) / 600);
  const sec = (tenths % 600) / 10;
  const secText = sec.toFixed(1).padStart(4, '0');
  return `${deg}°${String(min).padStart(2, '0')}'${secText}"${value < 0 ? neg : pos}`;
}

export function formatDMS(lat: number, lon: number): string {
  return `${dmsPart(lat, 'N', 'S')} ${dmsPart(lon, 'E', 'W')}`;
}

export interface Utm {
  zone: number;
  band: string;
  hemisphere: 'N' | 'S';
  easting: number;
  northing: number;
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';

export function utmZone(lat: number, lon: number): number {
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32; // Norway
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31; // Svalbard
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return Math.min(60, Math.max(1, zone));
}

/** WGS84 lat/lon to UTM (Krüger series). Returns null outside 80°S–84°N. */
export function toUtm(lat: number, lon: number): Utm | null {
  if (!(lat >= -80 && lat <= 84) || !Number.isFinite(lon)) return null;
  const zone = utmZone(lat, lon);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64);
  const alpha = [
    n / 2 - (2 * n * n) / 3 + (5 * n ** 3) / 16,
    (13 * n * n) / 48 - (3 * n ** 3) / 5,
    (61 * n ** 3) / 240,
  ];
  const phi = lat * (Math.PI / 180);
  let dl = lon * (Math.PI / 180) - lon0;
  dl = Math.atan2(Math.sin(dl), Math.cos(dl));
  const c = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let E = eta;
  let N = xi;
  alpha.forEach((al, i) => {
    const j = 2 * (i + 1);
    E += al * Math.cos(j * xi) * Math.sinh(j * eta);
    N += al * Math.sin(j * xi) * Math.cosh(j * eta);
  });
  const hemisphere = lat >= 0 ? 'N' : 'S';
  return {
    zone,
    band: BANDS[Math.min(19, Math.floor((lat + 80) / 8))],
    hemisphere,
    easting: 500000 + k0 * A * E,
    northing: (hemisphere === 'S' ? 10000000 : 0) + k0 * A * N,
  };
}

export function formatUTM(lat: number, lon: number): string {
  const u = toUtm(lat, lon);
  if (!u) return 'UTM n/a';
  return `${u.zone}${u.band} ${Math.round(u.easting)} E ${Math.round(u.northing)} N`;
}

export function formatCoords(format: CoordFormat, lat: number, lon: number): string {
  if (format === 'dms') return formatDMS(lat, lon);
  if (format === 'utm') return formatUTM(lat, lon);
  return formatDD(lat, lon);
}
