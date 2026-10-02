// Tauri commands for importing layers, plus the `kmz://` URI protocol that serves embedded
// icons and overlay images. Imported layers live in `LayerStore`; the frontend fetches a
// light JSON manifest first, then the geometry as raw bytes.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::{ipc::Response, Manager, State};

use crate::attributes::{self, AttributePage, FeatureDetail, ViewSpec};
use crate::binary::encode_geometry;
use crate::import::{import_path, ImportError};
use crate::layer::{mime_for_path, LayerData, LayerManifest};

#[derive(Clone, Default)]
pub struct LayerStore {
    layers: Arc<Mutex<HashMap<String, Arc<LayerData>>>>,
    next: Arc<AtomicU32>,
}

impl LayerStore {
    pub fn add(&self, data: LayerData, elapsed_ms: u64) -> LayerManifest {
        let id = format!("L{}", self.next.fetch_add(1, Ordering::Relaxed) + 1);
        let manifest = data.manifest(&id, elapsed_ms);
        if let Ok(mut m) = self.layers.lock() {
            m.insert(id, Arc::new(data));
        }
        manifest
    }
    pub fn get(&self, id: &str) -> Option<Arc<LayerData>> {
        self.layers.lock().ok()?.get(id).cloned()
    }
    pub fn remove(&self, id: &str) {
        if let Ok(mut m) = self.layers.lock() {
            m.remove(id);
        }
    }
}

fn join_error(e: tauri::Error) -> ImportError {
    ImportError::Io {
        file: "import task".into(),
        message: e.to_string(),
    }
}

#[tauri::command]
pub async fn import_file(
    path: String,
    store: State<'_, LayerStore>,
) -> Result<LayerManifest, ImportError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let t = Instant::now();
        let data = import_path(&path)?;
        Ok(store.add(data, t.elapsed().as_millis() as u64))
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn get_geometry(
    layer_id: String,
    store: State<'_, LayerStore>,
) -> Result<Response, ImportError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let layer = store
            .get(&layer_id)
            .ok_or(ImportError::UnknownLayer(layer_id))?;
        Ok(Response::new(encode_geometry(&layer)))
    })
    .await
    .map_err(join_error)?
}

/// One page of the attribute table for a sorted/filtered view of a layer.
#[tauri::command]
pub async fn get_attributes(
    layer_id: String,
    spec: ViewSpec,
    offset: usize,
    limit: usize,
    store: State<'_, LayerStore>,
) -> Result<AttributePage, ImportError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let layer = store
            .get(&layer_id)
            .ok_or(ImportError::UnknownLayer(layer_id))?;
        let view = attributes::view_for(&layer, &spec);
        Ok(attributes::page(&layer, &view, offset, limit.min(1000)))
    })
    .await
    .map_err(join_error)?
}

/// Row index of a feature within a view (None if the view does not contain it).
#[tauri::command]
pub async fn find_row(
    layer_id: String,
    spec: ViewSpec,
    feature_id: u32,
    store: State<'_, LayerStore>,
) -> Result<Option<usize>, ImportError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let layer = store
            .get(&layer_id)
            .ok_or(ImportError::UnknownLayer(layer_id))?;
        let view = attributes::view_for(&layer, &spec);
        Ok(attributes::row_of(&view, feature_id))
    })
    .await
    .map_err(join_error)?
}

/// Full details of one feature: attributes, description, and geometry summary.
#[tauri::command]
pub fn get_feature(
    layer_id: String,
    feature_id: u32,
    store: State<'_, LayerStore>,
) -> Result<FeatureDetail, ImportError> {
    let layer = store
        .get(&layer_id)
        .ok_or_else(|| ImportError::UnknownLayer(layer_id.clone()))?;
    attributes::feature_detail(&layer, feature_id).ok_or(ImportError::UnknownLayer(format!(
        "{layer_id} feature {feature_id}"
    )))
}

/// Supported files passed on the command line (e.g. via "Open with" or a terminal).
#[tauri::command]
pub fn get_launch_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| {
            let lower = a.to_ascii_lowercase();
            [".kml", ".kmz", ".geojson", ".json", ".gpx"]
                .iter()
                .any(|e| lower.ends_with(e))
                && std::path::Path::new(a).is_file()
        })
        .collect()
}

#[tauri::command]
pub fn remove_layer(layer_id: String, store: State<'_, LayerStore>) {
    store.remove(&layer_id);
}

fn percent_decode(s: &str) -> String {
    fn hex(b: u8) -> Option<u8> {
        (b as char).to_digit(16).map(|d| d as u8)
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Handler for `kmz://<layer_id>/<relative path>`.
pub fn handle_kmz<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let builder = tauri::http::Response::builder().header("Access-Control-Allow-Origin", "*");
    let store = ctx.app_handle().state::<LayerStore>();
    let path = percent_decode(request.uri().path());
    let mut parts = path.trim_start_matches('/').splitn(2, '/');
    let found = match (parts.next(), parts.next()) {
        (Some(id), Some(rel)) => store.get(id).and_then(|l| {
            let mime = mime_for_path(rel)?;
            l.resources.read(rel).map(|bytes| (bytes, mime))
        }),
        _ => None,
    };
    match found {
        Some((bytes, mime)) => builder
            .header("Content-Type", mime)
            .header("Cache-Control", "max-age=3600")
            .body(bytes),
        None => builder.status(404).body(Vec::new()),
    }
    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decodes() {
        assert_eq!(
            percent_decode("/L1/files/my%20icon.png"),
            "/L1/files/my icon.png"
        );
        assert_eq!(percent_decode("/a%2"), "/a%2");
        assert_eq!(percent_decode("/a%"), "/a%");
        assert_eq!(percent_decode("/%C3%A9"), "/é");
    }
}
