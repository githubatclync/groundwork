// Decodes the compact binary geometry buffer produced by src-tauri/src/binary.rs.
// Layout (little-endian): 32-byte header, then coords (f64 lon/lat/alt triples), part offsets,
// feature ids, folder ids, style ids (u32 each), geometry types and flags (u8 each).
export const MAGIC = 0x31475747; // "GWG1"
export const HEADER_BYTES = 32;

export const GEOM_POINT = 1;
export const GEOM_LINE = 2;
export const GEOM_POLY_OUTER = 3;
export const GEOM_POLY_HOLE = 4;

export const FLAG_ALT_MASK = 0b11;
export const FLAG_EXTRUDE = 0b100;
export const FLAG_TESSELLATE = 0b1000;
export const FLAG_HIDDEN = 0b10000;

/** Altitude modes stored in the low bits of a part's flags. */
export const ALT_CLAMP = 0;
export const ALT_RELATIVE = 1;
export const ALT_ABSOLUTE = 2;

export interface GeometryBuffer {
  partCount: number;
  vertexCount: number;
  featureCount: number;
  /** lon, lat, alt per vertex. */
  coords: Float64Array;
  /** Part i spans vertices offsets[i] .. offsets[i + 1]. Length partCount + 1. */
  offsets: Uint32Array;
  featureIds: Uint32Array;
  folderIds: Uint32Array;
  styleIds: Uint32Array;
  types: Uint8Array;
  flags: Uint8Array;
}

export function decodeGeometry(buffer: ArrayBuffer): GeometryBuffer {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('Geometry buffer is too small');
  const header = new DataView(buffer);
  if (header.getUint32(0, true) !== MAGIC) throw new Error('Geometry buffer has a bad signature');
  const version = header.getUint32(4, true);
  if (version !== 1) throw new Error(`Unsupported geometry buffer version ${version}`);
  const partCount = header.getUint32(8, true);
  const vertexCount = header.getUint32(12, true);
  const featureCount = header.getUint32(16, true);

  const expected =
    HEADER_BYTES + vertexCount * 24 + (partCount + 1) * 4 + partCount * 3 * 4 + partCount * 2;
  if (buffer.byteLength !== expected) {
    throw new Error(`Geometry buffer is ${buffer.byteLength} bytes, expected ${expected}`);
  }

  let o = HEADER_BYTES;
  const coords = new Float64Array(buffer, o, vertexCount * 3);
  o += vertexCount * 24;
  const offsets = new Uint32Array(buffer, o, partCount + 1);
  o += (partCount + 1) * 4;
  const featureIds = new Uint32Array(buffer, o, partCount);
  o += partCount * 4;
  const folderIds = new Uint32Array(buffer, o, partCount);
  o += partCount * 4;
  const styleIds = new Uint32Array(buffer, o, partCount);
  o += partCount * 4;
  const types = new Uint8Array(buffer, o, partCount);
  o += partCount;
  const flags = new Uint8Array(buffer, o, partCount);
  return {
    partCount,
    vertexCount,
    featureCount,
    coords,
    offsets,
    featureIds,
    folderIds,
    styleIds,
    types,
    flags,
  };
}
