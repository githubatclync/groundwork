// MBTiles support: opens raster .mbtiles files and serves tiles through the custom
// `mbtiles://<id>/{z}/{x}/{y}` URI protocol. MBTiles stores rows in TMS order, so the
// XYZ y coordinate requested by the globe is flipped here.
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use tauri::{Manager, State};

#[derive(Debug, thiserror::Error)]
pub enum MbtilesError {
    #[error("Could not open \"{0}\": {1}")]
    Open(String, String),
    #[error("\"{0}\" is not a valid MBTiles file (missing tiles table)")]
    NotMbtiles(String),
    #[error("\"{0}\" contains {1} tiles; only raster (png/jpg/webp) MBTiles are supported")]
    UnsupportedFormat(String, String),
    #[error("Unknown MBTiles id \"{0}\"")]
    UnknownId(String),
}

impl Serialize for MbtilesError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Metadata returned to the frontend after a file is opened.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MbtilesInfo {
    pub id: String,
    pub name: String,
    pub format: String,
    pub min_zoom: u32,
    pub max_zoom: u32,
    pub attribution: Option<String>,
    /// west, south, east, north in degrees, when present in the metadata.
    pub bounds: Option<[f64; 4]>,
}

struct Source {
    conn: Connection,
    format: String,
}

/// Open MBTiles files keyed by id; managed as Tauri state.
#[derive(Default)]
pub struct MbtilesState(Mutex<HashMap<String, Source>>);

/// Converts an XYZ (top-left origin) row to the TMS row MBTiles stores (and back).
pub fn flip_y(z: u32, y: u32) -> u32 {
    (1u32 << z) - 1 - y
}

/// Splits `/<id>/<z>/<x>/<y>[.ext]` into its parts.
pub fn parse_tile_path(path: &str) -> Option<(String, u32, u32, u32)> {
    let mut parts = path.trim_matches('/').split('/');
    let id = parts.next()?.to_string();
    let z: u32 = parts.next()?.parse().ok()?;
    let x = parts.next()?.parse().ok()?;
    let y = parts.next()?.split('.').next()?.parse().ok()?;
    if parts.next().is_some() || id.is_empty() || z > 30 {
        return None;
    }
    Some((id, z, x, y))
}

fn mime_for(format: &str, data: &[u8]) -> &'static str {
    if data.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if data.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if data.len() > 12 && &data[8..12] == b"WEBP" {
        "image/webp"
    } else {
        match format {
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            _ => "image/png",
        }
    }
}

fn meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM metadata WHERE name = ?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

fn id_for_path(path: &str) -> String {
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn open(path: &str) -> Result<(MbtilesInfo, Source), MbtilesError> {
    let file_name = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string());
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| MbtilesError::Open(file_name.clone(), e.to_string()))?;
    conn.query_row("SELECT 1 FROM tiles LIMIT 1", [], |_| Ok(()))
        .optional()
        .map_err(|_| MbtilesError::NotMbtiles(file_name.clone()))?;

    let format = meta(&conn, "format").unwrap_or_else(|| "png".into()).to_lowercase();
    if format == "pbf" || format == "mvt" {
        return Err(MbtilesError::UnsupportedFormat(file_name, format));
    }
    let zoom_range: (u32, u32) = conn
        .query_row("SELECT MIN(zoom_level), MAX(zoom_level) FROM tiles", [], |r| {
            Ok((
                r.get::<_, Option<u32>>(0)?.unwrap_or(0),
                r.get::<_, Option<u32>>(1)?.unwrap_or(0),
            ))
        })
        .unwrap_or((0, 0));
    let min_zoom = meta(&conn, "minzoom").and_then(|v| v.parse().ok()).unwrap_or(zoom_range.0);
    let max_zoom = meta(&conn, "maxzoom").and_then(|v| v.parse().ok()).unwrap_or(zoom_range.1);
    let bounds = meta(&conn, "bounds").and_then(|b| {
        let v: Vec<f64> = b.split(',').filter_map(|s| s.trim().parse().ok()).collect();
        (v.len() == 4).then(|| [v[0], v[1], v[2], v[3]])
    });
    let info = MbtilesInfo {
        id: id_for_path(path),
        name: meta(&conn, "name").unwrap_or(file_name),
        format: format.clone(),
        min_zoom,
        max_zoom,
        attribution: meta(&conn, "attribution"),
        bounds,
    };
    Ok((info, Source { conn, format }))
}

fn read_tile(
    state: &MbtilesState,
    id: &str,
    z: u32,
    x: u32,
    y: u32,
) -> Option<(Vec<u8>, &'static str)> {
    let sources = state.0.lock().ok()?;
    let src = sources.get(id)?;
    let data: Vec<u8> = src
        .conn
        .query_row(
            "SELECT tile_data FROM tiles WHERE zoom_level = ?1 AND tile_column = ?2 AND tile_row = ?3",
            (z, x, flip_y(z, y)),
            |r| r.get(0),
        )
        .optional()
        .ok()??;
    let mime = mime_for(&src.format, &data);
    Some((data, mime))
}

#[tauri::command]
pub fn open_mbtiles(
    path: String,
    state: State<'_, MbtilesState>,
) -> Result<MbtilesInfo, MbtilesError> {
    let (info, source) = open(&path)?;
    if let Ok(mut sources) = state.0.lock() {
        sources.insert(info.id.clone(), source);
    }
    Ok(info)
}

#[tauri::command]
pub fn close_mbtiles(id: String, state: State<'_, MbtilesState>) -> Result<(), MbtilesError> {
    let mut sources = state.0.lock().map_err(|_| MbtilesError::UnknownId(id.clone()))?;
    sources.remove(&id).map(|_| ()).ok_or(MbtilesError::UnknownId(id))
}

/// Handler for the `mbtiles://` URI scheme.
pub fn handle_request<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let builder = tauri::http::Response::builder().header("Access-Control-Allow-Origin", "*");
    let state = ctx.app_handle().state::<MbtilesState>();
    let tile = parse_tile_path(request.uri().path())
        .and_then(|(id, z, x, y)| read_tile(&state, &id, z, x, y));
    match tile {
        Some((data, mime)) => builder
            .header("Content-Type", mime)
            .header("Cache-Control", "max-age=3600")
            .body(data),
        None => builder.status(404).body(Vec::new()),
    }
    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_MAGIC: &str = "X'89504E470D0A1A0A'";

    #[test]
    fn y_flip_converts_xyz_to_tms() {
        assert_eq!(flip_y(0, 0), 0);
        assert_eq!(flip_y(1, 0), 1);
        assert_eq!(flip_y(1, 1), 0);
        assert_eq!(flip_y(3, 2), 5);
        assert_eq!(flip_y(3, flip_y(3, 2)), 2);
    }

    #[test]
    fn parses_tile_paths() {
        assert_eq!(parse_tile_path("/abc/3/4/5"), Some(("abc".into(), 3, 4, 5)));
        assert_eq!(parse_tile_path("/abc/3/4/5.png"), Some(("abc".into(), 3, 4, 5)));
        assert_eq!(parse_tile_path("/abc/3/4"), None);
        assert_eq!(parse_tile_path("/abc/x/4/5"), None);
        assert_eq!(parse_tile_path("/abc/3/4/5/6"), None);
    }

    fn temp_db(name: &str) -> String {
        let path = std::env::temp_dir()
            .join(format!("groundwork-test-{name}-{}.mbtiles", std::process::id()));
        let _ = std::fs::remove_file(&path);
        path.to_string_lossy().into_owned()
    }

    fn make_db(path: &str, format: &str, tiles: &str) {
        let c = Connection::open(path).unwrap();
        c.execute_batch(&format!(
            "CREATE TABLE metadata (name TEXT, value TEXT);
             CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
             INSERT INTO metadata VALUES ('name','Test'),('format','{format}'),('bounds','-10,-5,10,5');
             {tiles}"
        ))
        .unwrap();
    }

    #[test]
    fn serves_flipped_row_from_file() {
        let path = temp_db("flip");
        // XYZ tile z=2 x=1 y=0 is stored at TMS row 3.
        make_db(&path, "png", &format!("INSERT INTO tiles VALUES (2, 1, 3, {PNG_MAGIC});"));
        let (info, source) = open(&path).unwrap();
        assert_eq!(info.name, "Test");
        assert_eq!(info.max_zoom, 2);
        assert_eq!(info.bounds, Some([-10.0, -5.0, 10.0, 5.0]));
        let state = MbtilesState::default();
        state.0.lock().unwrap().insert(info.id.clone(), source);
        let (data, mime) = read_tile(&state, &info.id, 2, 1, 0).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(data.len(), 8);
        assert!(read_tile(&state, &info.id, 2, 1, 3).is_none());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_vector_tiles_and_non_mbtiles() {
        let path = temp_db("pbf");
        make_db(&path, "pbf", "");
        assert!(matches!(open(&path), Err(MbtilesError::UnsupportedFormat(..))));
        let _ = std::fs::remove_file(&path);

        let path = temp_db("empty");
        Connection::open(&path).unwrap().execute_batch("CREATE TABLE x (a)").unwrap();
        assert!(matches!(open(&path), Err(MbtilesError::NotMbtiles(_))));
        let _ = std::fs::remove_file(&path);
    }
}
