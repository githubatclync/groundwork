// Parses coordinates typed into the search box: decimal degrees, degrees/minutes/seconds, and UTM.
// Returns null when the text is not a coordinate (so it can be treated as a place name instead).
import { fromUtm } from '../globe/coords';

export interface ParsedCoordinate {
  lat: number;
  lon: number;
  format: 'dd' | 'dms' | 'utm';
}

const UTM =
  /^(?:zone\s*)?(\d{1,2})\s*([C-HJ-NP-X])\s*[,;]?\s*(\d+(?:\.\d+)?)\s*(?:m\s*)?E?\s*[,;]?\s*(\d+(?:\.\d+)?)\s*(?:m\s*)?N?$/i;

function parseUtm(text: string): ParsedCoordinate | null {
  const m = UTM.exec(text.trim());
  if (!m) return null;
  const zone = Number(m[1]);
  const band = m[2].toUpperCase();
  const easting = Number(m[3]);
  const northing = Number(m[4]);
  if (
    zone < 1 ||
    zone > 60 ||
    easting < 100_000 ||
    easting > 900_000 ||
    northing < 0 ||
    northing > 10_000_000
  ) {
    return null;
  }
  const r = fromUtm(zone, band >= 'N' ? 'N' : 'S', easting, northing);
  return r && Math.abs(r.lat) <= 90 ? { ...r, format: 'utm' } : null;
}

interface Part {
  nums: number[];
  hemi: string | null;
}

/** Degrees, minutes, seconds (any may be missing) to a signed decimal value. */
function toDegrees(p: Part, limit: number): number | null {
  if (p.nums.length === 0 || p.nums.length > 3) return null;
  const [d, m = 0, s = 0] = p.nums;
  if (m < 0 || m >= 60 || s < 0 || s >= 60) return null;
  if (p.nums.length > 1 && !Number.isInteger(d)) return null; // 40.5 26' is not a coordinate
  const negative = d < 0 || Object.is(d, -0) || p.hemi === 'S' || p.hemi === 'W';
  const value = (Math.abs(d) + m / 60 + s / 3600) * (negative ? -1 : 1);
  return Math.abs(value) <= limit ? value : null;
}

/** Splits the text into two coordinate parts, each with its numbers and optional N/S/E/W letter. */
function splitParts(raw: string): Part[] | null {
  const text = raw
    .toUpperCase()
    .replace(/[°º˚ʹ′’'ʺ″”"]/g, ' ')
    .replace(/\b(LAT(ITUDE)?|LON(G|GITUDE)?|LNG)\b[:=]?/g, ' ');
  if (/[^0-9NSEW\s.,;+\-/]/.test(text)) return null; // any other letter: it is a place name
  const sides = text
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const partOf = (chunk: string): Part | null => {
    const hemis = chunk.match(/[NSEW]/g) ?? [];
    const nums = (chunk.match(/[-+]?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (hemis.length > 1 || nums.length === 0) return null;
    return { nums, hemi: hemis[0] ?? null };
  };
  // Commas (or ; or /) separate the two coordinates, but a decimal comma such as "40,5 -74,2" is not supported.
  if (sides.length === 2) {
    const a = partOf(sides[0]);
    const b = partOf(sides[1]);
    return a && b ? [a, b] : null;
  }
  if (sides.length !== 1) return null;
  const tokens: string[] = sides[0].match(/[NSEW]|[-+]?\d+(?:\.\d+)?/g) ?? [];
  if (tokens.length === 0) return null;
  const letters = tokens.filter((t) => /[NSEW]/.test(t)).length;
  if (letters === 0) {
    // No hemisphere letters: 2, 4, or 6 numbers split evenly (D D / D M D M / D M S D M S).
    const nums = tokens.map(Number);
    if (![2, 4, 6].includes(nums.length)) return null;
    const half = nums.length / 2;
    return [
      { nums: nums.slice(0, half), hemi: null },
      { nums: nums.slice(half), hemi: null },
    ];
  }
  if (letters !== 2) return null;
  const parts: Part[] = [];
  const prefixStyle = /[NSEW]/.test(tokens[0]);
  let cur: Part = { nums: [], hemi: null };
  for (const t of tokens) {
    if (/[NSEW]/.test(t)) {
      if (prefixStyle) {
        if (cur.hemi !== null || cur.nums.length) parts.push(cur);
        cur = { nums: [], hemi: t };
      } else {
        cur.hemi = t;
        parts.push(cur);
        cur = { nums: [], hemi: null };
      }
    } else {
      cur.nums.push(Number(t));
    }
  }
  if (prefixStyle) parts.push(cur);
  else if (cur.nums.length) return null; // trailing numbers without a letter
  return parts.length === 2 ? parts : null;
}

export function parseCoordinates(text: string): ParsedCoordinate | null {
  const input = text.trim();
  if (!input) return null;
  const utm = parseUtm(input);
  if (utm) return utm;

  const parts = splitParts(input);
  if (!parts) return null;
  let [first, second] = parts;
  // Letters decide which is which: E/W first means longitude then latitude.
  const isLon = (p: Part) => p.hemi === 'E' || p.hemi === 'W';
  const isLat = (p: Part) => p.hemi === 'N' || p.hemi === 'S';
  if (isLon(first) || isLat(second)) {
    if (isLat(first) || isLon(second)) return null; // contradictory letters
    [first, second] = [second, first];
  }
  if (isLon(first)) return null; // two longitudes
  const lat = toDegrees(first, 90);
  const lon = toDegrees(second, 180);
  if (lat === null || lon === null) return null;
  const dms = first.nums.length > 1 || second.nums.length > 1;
  return { lat, lon, format: dms ? 'dms' : 'dd' };
}
