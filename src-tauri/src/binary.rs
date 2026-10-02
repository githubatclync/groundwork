// Compact binary geometry encoding sent to the frontend as raw bytes (no JSON).
//
// Little-endian layout, every section naturally aligned:
//   header   32 bytes: magic "GWG1" (u32), version (u32), parts, vertices, features (u32 each), 3 reserved u32
//   coords   f64 x (vertices * 3)   lon, lat, alt
//   offsets  u32 x (parts + 1)      start vertex of each part, plus the final vertex count
//   features u32 x parts            feature id of each part
//   folders  u32 x parts            folder id of each part's feature
//   styles   u32 x parts            index into the manifest's style list
//   types    u8  x parts            1 point, 2 line, 3 polygon outer ring, 4 polygon hole
//   flags    u8  x parts            bits 0-1 altitude mode, bit 2 extrude, bit 3 tessellate, bit 4 hidden
use crate::layer::{LayerData, FLAG_HIDDEN};

pub const MAGIC: u32 = 0x3147_5747; // "GWG1" read as little-endian bytes
pub const VERSION: u32 = 1;
pub const HEADER_BYTES: usize = 32;

pub fn encode_geometry(l: &LayerData) -> Vec<u8> {
    let parts = l.part_count();
    let verts = l.vertex_count();
    let mut out = Vec::with_capacity(HEADER_BYTES + verts * 24 + parts * 18 + 4 + 2);
    for v in [
        MAGIC,
        VERSION,
        parts as u32,
        verts as u32,
        l.features.len() as u32,
        0,
        0,
        0,
    ] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for c in &l.coords {
        out.extend_from_slice(&c.to_le_bytes());
    }
    for o in &l.part_offset {
        out.extend_from_slice(&o.to_le_bytes());
    }
    out.extend_from_slice(&(verts as u32).to_le_bytes());
    for f in &l.part_feature {
        out.extend_from_slice(&f.to_le_bytes());
    }
    for f in &l.part_feature {
        out.extend_from_slice(&l.features[*f as usize].folder.to_le_bytes());
    }
    for f in &l.part_feature {
        out.extend_from_slice(&l.feature_style[*f as usize].to_le_bytes());
    }
    out.extend_from_slice(&l.part_type);
    for (flags, f) in l.part_flags.iter().zip(&l.part_feature) {
        let hidden = if l.features[*f as usize].visible {
            0
        } else {
            FLAG_HIDDEN
        };
        out.push(flags | hidden);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::parse_kml_str;

    fn u32_at(b: &[u8], o: usize) -> u32 {
        u32::from_le_bytes(b[o..o + 4].try_into().unwrap())
    }
    fn f64_at(b: &[u8], o: usize) -> f64 {
        f64::from_le_bytes(b[o..o + 8].try_into().unwrap())
    }

    #[test]
    fn encodes_documented_layout() {
        let l = parse_kml_str(
            r#"<kml><Document>
              <Placemark><name>A</name><Point><coordinates>10,20,30</coordinates></Point></Placemark>
              <Folder><Placemark><LineString><coordinates>0,0 1,1 2,2</coordinates></LineString></Placemark></Folder>
            </Document></kml>"#,
        )
        .unwrap();
        let b = encode_geometry(&l);
        assert_eq!(u32_at(&b, 0), MAGIC);
        assert_eq!(&b[0..4], b"GWG1");
        assert_eq!(u32_at(&b, 4), VERSION);
        let (parts, verts, features) = (
            u32_at(&b, 8) as usize,
            u32_at(&b, 12) as usize,
            u32_at(&b, 16),
        );
        assert_eq!((parts, verts, features), (2, 4, 2));
        assert_eq!(f64_at(&b, 32), 10.0);
        assert_eq!(f64_at(&b, 40), 20.0);
        assert_eq!(f64_at(&b, 48), 30.0);
        let off = HEADER_BYTES + verts * 24;
        assert_eq!(
            [u32_at(&b, off), u32_at(&b, off + 4), u32_at(&b, off + 8)],
            [0, 1, 4]
        );
        let fe = off + (parts + 1) * 4;
        assert_eq!([u32_at(&b, fe), u32_at(&b, fe + 4)], [0, 1]);
        let fo = fe + parts * 4;
        assert_eq!([u32_at(&b, fo), u32_at(&b, fo + 4)], [0, 1]); // second feature is in folder 1
        let st = fo + parts * 4;
        let ty = st + parts * 4;
        assert_eq!(&b[ty..ty + 2], &[1, 2]);
        assert_eq!(b.len(), ty + parts * 2);
    }
}
