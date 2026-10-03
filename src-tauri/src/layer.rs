// Layer model shared by all importers. `LayerBuilder` accumulates a feature table plus flat
// geometry buffers while a file streams through; `finish` resolves styles and produces the
// immutable `LayerData`, from which the JSON manifest and binary geometry are derived.
use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

use crate::style::{Style, StyleDef};

/// Where a parse failure happened: a byte offset (XML) or a 1-based line (JSON).
#[derive(Debug, Clone, Copy)]
pub enum Loc {
    Byte(u64),
    Line(u64),
}

pub const GEOM_POINT: u8 = 1;
pub const GEOM_LINE: u8 = 2;
pub const GEOM_POLY_OUTER: u8 = 3;
/// A hole belonging to the closest preceding `GEOM_POLY_OUTER` part.
pub const GEOM_POLY_HOLE: u8 = 4;

/// Part flags: bits 0-1 altitude mode (0 clamp, 1 relative, 2 absolute), then extrude, tessellate.
pub const FLAG_ALT_MASK: u8 = 0b11;
pub const FLAG_EXTRUDE: u8 = 0b100;
pub const FLAG_TESSELLATE: u8 = 0b1000;
/// Set on parts whose own feature has visibility 0 (folder visibility is separate, via the tree).
pub const FLAG_HIDDEN: u8 = 0b1_0000;

/// Reference to a style from a feature or a StyleMap pair.
#[derive(Debug, Clone)]
pub enum StyleRef {
    Url(String),
    Inline(StyleDef),
}

#[derive(Debug, Default, Clone)]
pub struct StyleMapDef {
    pub normal: Option<StyleRef>,
    pub highlight: Option<StyleRef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ColumnType {
    String,
    Number,
    Bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: ColumnType,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Warning {
    pub kind: String,
    pub message: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub name: String,
    /// Relative path inside the KMZ / next to the KML (empty when the image is remote).
    pub href: String,
    pub north: f64,
    pub south: f64,
    pub east: f64,
    pub west: f64,
    /// Degrees, counter-clockwise per the KML spec.
    pub rotation: f64,
    pub color: String,
    pub visible: bool,
    pub folder: u32,
}

/// A KML NetworkLink to another local file, imported as a child layer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRef {
    pub name: String,
    /// The href as written in the file until resolved, then an absolute path to an existing file.
    pub path: String,
}

/// Decodes %XX sequences (used for hrefs and custom-scheme paths).
pub fn percent_decode(s: &str) -> String {
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

#[derive(Debug, Clone)]
pub struct FeatureRec {
    pub name: String,
    pub description: Option<String>,
    pub visible: bool,
    pub folder: u32,
    pub attrs: Vec<(u16, Box<str>)>,
}

#[derive(Debug, Clone)]
pub struct FolderRec {
    pub name: String,
    pub open: bool,
    pub visible: bool,
    pub parent: Option<u32>,
}

/// Where embedded resources (icons, overlay images) come from.
pub enum Resources {
    None,
    Dir(PathBuf),
    Zip(Mutex<zip::ZipArchive<File>>),
}

impl Resources {
    /// Reads a resource by relative path; only image-like files are served.
    pub fn read(&self, rel: &str) -> Option<Vec<u8>> {
        use std::io::Read;
        let rel = crate::style::normalize_href(rel);
        if rel.is_empty() || mime_for_path(&rel).is_none() {
            return None;
        }
        match self {
            Resources::None => None,
            Resources::Dir(dir) => std::fs::read(dir.join(&rel)).ok(),
            Resources::Zip(zip) => {
                let mut zip = zip.lock().ok()?;
                let name = if zip.by_name(&rel).is_ok() {
                    rel.clone()
                } else {
                    let lower = rel.to_lowercase();
                    zip.file_names()
                        .find(|n| n.to_lowercase() == lower)?
                        .to_string()
                };
                let mut f = zip.by_name(&name).ok()?;
                let mut buf = Vec::with_capacity(f.size() as usize);
                f.read_to_end(&mut buf).ok()?;
                Some(buf)
            }
        }
    }
}

pub fn mime_for_path(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// A finished, immutable layer.
pub struct LayerData {
    pub name: String,
    pub source_path: String,
    pub format: &'static str,
    pub features: Vec<FeatureRec>,
    pub feature_style: Vec<u32>,
    pub folders: Vec<FolderRec>,
    pub coords: Vec<f64>,
    /// Start vertex of each part; part i spans `part_offset[i]..part_offset[i+1]` (last: coords end).
    pub part_offset: Vec<u32>,
    pub part_feature: Vec<u32>,
    pub part_type: Vec<u8>,
    pub part_flags: Vec<u8>,
    pub columns: Vec<Column>,
    pub styles: Vec<Style>,
    pub warnings: Vec<Warning>,
    pub overlays: Vec<Overlay>,
    pub bounds: Option<[f64; 4]>,
    pub resources: Resources,
    /// west, south, east, north per feature; all NaN for features without geometry.
    pub feature_bounds: Vec<[f64; 4]>,
    /// Local files this layer links to (KML NetworkLink), resolved after import.
    pub links: Vec<LinkRef>,
    /// The most recently built attribute-table view (sorted/filtered feature ids), keyed by its spec.
    pub view_cache: Mutex<Option<(String, std::sync::Arc<Vec<u32>>)>>,
}

impl std::fmt::Debug for LayerData {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LayerData")
            .field("name", &self.name)
            .field("features", &self.features.len())
            .field("parts", &self.part_count())
            .finish()
    }
}

impl LayerData {
    pub fn vertex_count(&self) -> usize {
        self.coords.len() / 3
    }
    pub fn part_count(&self) -> usize {
        self.part_type.len()
    }

    /// Range of part indices belonging to a feature (parts are stored in feature order).
    pub fn parts_of(&self, feature: u32) -> std::ops::Range<usize> {
        let start = self.part_feature.partition_point(|&f| f < feature);
        let end = self.part_feature.partition_point(|&f| f <= feature);
        start..end
    }

    /// Vertex coordinates (lon, lat, alt triples) of one part.
    pub fn part_coords(&self, part: usize) -> &[f64] {
        let start = self.part_offset[part] as usize * 3;
        let end = self
            .part_offset
            .get(part + 1)
            .map(|&o| o as usize * 3)
            .unwrap_or(self.coords.len());
        &self.coords[start..end]
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderNode {
    pub id: u32,
    pub name: String,
    pub open: bool,
    pub visible: bool,
    /// Features directly in this folder (not counting subfolders).
    pub feature_count: u32,
    pub children: Vec<FolderNode>,
}

/// How many geometries of each kind a layer holds (used for the image legend).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryCounts {
    pub points: usize,
    pub lines: usize,
    pub polygons: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerManifest {
    pub id: String,
    pub name: String,
    pub source_path: String,
    pub format: &'static str,
    pub feature_count: usize,
    pub part_count: usize,
    pub vertex_count: usize,
    pub geometry_counts: GeometryCounts,
    pub bounds: Option<[f64; 4]>,
    pub tree: FolderNode,
    pub styles: Vec<Style>,
    pub columns: Vec<Column>,
    pub warnings: Vec<Warning>,
    pub overlays: Vec<Overlay>,
    pub links: Vec<LinkRef>,
    pub elapsed_ms: u64,
}

impl LayerData {
    pub fn manifest(&self, id: &str, elapsed_ms: u64) -> LayerManifest {
        let mut counts = vec![0u32; self.folders.len()];
        for f in &self.features {
            counts[f.folder as usize] += 1;
        }
        let mut children: Vec<Vec<u32>> = vec![Vec::new(); self.folders.len()];
        for (i, f) in self.folders.iter().enumerate() {
            if let Some(p) = f.parent {
                children[p as usize].push(i as u32);
            }
        }
        LayerManifest {
            id: id.to_string(),
            name: self.name.clone(),
            source_path: self.source_path.clone(),
            format: self.format,
            feature_count: self.features.len(),
            part_count: self.part_count(),
            vertex_count: self.vertex_count(),
            geometry_counts: GeometryCounts {
                points: self.part_type.iter().filter(|&&t| t == GEOM_POINT).count(),
                lines: self.part_type.iter().filter(|&&t| t == GEOM_LINE).count(),
                polygons: self
                    .part_type
                    .iter()
                    .filter(|&&t| t == GEOM_POLY_OUTER)
                    .count(),
            },
            bounds: self.bounds,
            tree: build_node(0, &self.folders, &counts, &children),
            styles: self.styles.clone(),
            columns: self.columns.clone(),
            warnings: self.warnings.clone(),
            overlays: self.overlays.clone(),
            links: self.links.clone(),
            elapsed_ms,
        }
    }
}

fn build_node(id: u32, folders: &[FolderRec], counts: &[u32], children: &[Vec<u32>]) -> FolderNode {
    let f = &folders[id as usize];
    FolderNode {
        id,
        name: f.name.clone(),
        open: f.open,
        visible: f.visible,
        feature_count: counts[id as usize],
        children: children[id as usize]
            .iter()
            .map(|&c| build_node(c, folders, counts, children))
            .collect(),
    }
}

pub struct LayerBuilder {
    name: String,
    folders: Vec<FolderRec>,
    folder_stack: Vec<u32>,
    features: Vec<FeatureRec>,
    raw_styles: Vec<Option<StyleRef>>,
    coords: Vec<f64>,
    part_offset: Vec<u32>,
    part_feature: Vec<u32>,
    part_type: Vec<u8>,
    part_flags: Vec<u8>,
    pub style_defs: HashMap<String, StyleDef>,
    pub style_maps: HashMap<String, StyleMapDef>,
    columns: Vec<String>,
    column_index: HashMap<String, u16>,
    declared_types: HashMap<String, ColumnType>,
    warnings: BTreeMap<String, (String, u32)>,
    overlays: Vec<Overlay>,
    links: Vec<LinkRef>,
    bounds: Option<[f64; 4]>,
    current: Option<u32>,
}

impl LayerBuilder {
    pub fn new(name: &str) -> Self {
        LayerBuilder {
            name: name.to_string(),
            folders: vec![FolderRec {
                name: name.to_string(),
                open: true,
                visible: true,
                parent: None,
            }],
            folder_stack: vec![0],
            features: Vec::new(),
            raw_styles: Vec::new(),
            coords: Vec::new(),
            part_offset: Vec::new(),
            part_feature: Vec::new(),
            part_type: Vec::new(),
            part_flags: Vec::new(),
            style_defs: HashMap::new(),
            style_maps: HashMap::new(),
            columns: Vec::new(),
            column_index: HashMap::new(),
            declared_types: HashMap::new(),
            warnings: BTreeMap::new(),
            overlays: Vec::new(),
            links: Vec::new(),
            bounds: None,
            current: None,
        }
    }

    // ---- folders ----
    pub fn current_folder(&self) -> u32 {
        *self.folder_stack.last().unwrap_or(&0)
    }
    pub fn push_folder(&mut self, name: &str) -> u32 {
        let id = self.folders.len() as u32;
        let parent = self.current_folder();
        self.folders.push(FolderRec {
            name: name.to_string(),
            open: false,
            visible: true,
            parent: Some(parent),
        });
        self.folder_stack.push(id);
        id
    }
    pub fn pop_folder(&mut self) {
        if self.folder_stack.len() > 1 {
            self.folder_stack.pop();
        }
    }
    pub fn set_folder_name(&mut self, name: &str) {
        let id = self.current_folder() as usize;
        self.folders[id].name = name.to_string();
        if id == 0 {
            self.name = name.to_string();
        }
    }
    pub fn set_folder_open(&mut self, open: bool) {
        let id = self.current_folder() as usize;
        self.folders[id].open = open;
    }
    pub fn set_folder_visible(&mut self, visible: bool) {
        let id = self.current_folder() as usize;
        self.folders[id].visible = visible;
    }

    // ---- warnings ----
    pub fn warn(&mut self, kind: &str, message: &str) {
        self.warn_n(kind, message, 1);
    }
    pub fn warn_n(&mut self, kind: &str, message: &str, n: u32) {
        let e = self
            .warnings
            .entry(kind.to_string())
            .or_insert_with(|| (message.to_string(), 0));
        e.1 += n;
    }

    // ---- features ----
    pub fn begin_feature(
        &mut self,
        name: String,
        description: Option<String>,
        visible: bool,
        style: Option<StyleRef>,
    ) -> u32 {
        let id = self.features.len() as u32;
        self.features.push(FeatureRec {
            name,
            description,
            visible,
            folder: self.current_folder(),
            attrs: Vec::new(),
        });
        self.raw_styles.push(style);
        self.current = Some(id);
        id
    }

    /// Adds a geometry part to the current feature. `coords` is lon, lat, alt triples.
    pub fn add_part(&mut self, ty: u8, coords: &[f64], flags: u8) {
        let Some(feature) = self.current else { return };
        self.part_offset.push((self.coords.len() / 3) as u32);
        self.part_feature.push(feature);
        self.part_type.push(ty);
        self.part_flags.push(flags);
        self.coords.extend_from_slice(coords);
        for v in coords.chunks_exact(3) {
            self.extend_bounds(v[0], v[1]);
        }
    }

    pub fn extend_bounds(&mut self, lon: f64, lat: f64) {
        match &mut self.bounds {
            Some(b) => {
                b[0] = b[0].min(lon);
                b[1] = b[1].min(lat);
                b[2] = b[2].max(lon);
                b[3] = b[3].max(lat);
            }
            None => self.bounds = Some([lon, lat, lon, lat]),
        }
    }

    pub fn declare_column_type(&mut self, name: &str, ty: ColumnType) {
        self.declared_types.insert(name.to_string(), ty);
    }

    pub fn add_attr(&mut self, column: &str, value: String) {
        let Some(feature) = self.current else { return };
        let idx = match self.column_index.get(column) {
            Some(&i) => i,
            None => {
                if self.columns.len() >= u16::MAX as usize {
                    return;
                }
                let i = self.columns.len() as u16;
                self.columns.push(column.to_string());
                self.column_index.insert(column.to_string(), i);
                i
            }
        };
        let attrs = &mut self.features[feature as usize].attrs;
        // A repeated column keeps the last value.
        if let Some(slot) = attrs.iter_mut().find(|(c, _)| *c == idx) {
            slot.1 = value.into_boxed_str();
        } else {
            attrs.push((idx, value.into_boxed_str()));
        }
    }

    pub fn end_feature(&mut self) {
        self.current = None;
    }

    pub fn add_overlay(&mut self, overlay: Overlay) {
        self.extend_bounds(overlay.west, overlay.south);
        self.extend_bounds(overlay.east, overlay.north);
        self.overlays.push(overlay);
    }

    pub fn add_link(&mut self, name: String, href: String) {
        self.links.push(LinkRef { name, path: href });
    }

    pub fn feature_count(&self) -> usize {
        self.features.len()
    }

    // ---- finishing ----
    fn lookup(&self, r: &StyleRef, depth: u8) -> Option<StyleDef> {
        match r {
            StyleRef::Inline(d) => Some(d.clone()),
            StyleRef::Url(id) => {
                if let Some(d) = self.style_defs.get(id) {
                    return Some(d.clone());
                }
                let normal = self.style_maps.get(id)?.normal.as_ref()?;
                if depth >= 4 {
                    return None;
                }
                self.lookup(normal, depth + 1)
            }
        }
    }

    pub fn finish(
        mut self,
        source_path: &str,
        format: &'static str,
        resources: Resources,
    ) -> LayerData {
        // Resolve styles, de-duplicating identical resolved styles. Index 0 is the default.
        let mut styles = vec![Style::default()];
        let mut seen: HashMap<String, u32> = HashMap::new();
        seen.insert(serde_json::to_string(&styles[0]).unwrap_or_default(), 0);
        let mut feature_style = Vec::with_capacity(self.features.len());
        let mut remote_icons = 0u32;
        let mut missing_styles = 0u32;
        let mut url_cache: HashMap<String, u32> = HashMap::new();
        for raw in &self.raw_styles {
            let idx = match raw {
                None => 0,
                Some(StyleRef::Url(id)) if url_cache.contains_key(id) => url_cache[id],
                Some(r) => {
                    let idx = match self.lookup(r, 0) {
                        None => {
                            missing_styles += 1;
                            0
                        }
                        Some(def) => {
                            let style = def.resolve();
                            if style.icon.as_ref().is_some_and(|i| i.remote) {
                                remote_icons += 1;
                            }
                            let key = serde_json::to_string(&style).unwrap_or_default();
                            *seen.entry(key).or_insert_with(|| {
                                styles.push(style);
                                (styles.len() - 1) as u32
                            })
                        }
                    };
                    if let StyleRef::Url(id) = r {
                        url_cache.insert(id.clone(), idx);
                    }
                    idx
                }
            };
            feature_style.push(idx);
        }
        if remote_icons > 0 {
            self.warn_n(
                "Remote icons",
                "Icons hosted online are not downloaded (offline-first); features use a plain marker instead",
                remote_icons,
            );
        }
        if missing_styles > 0 {
            self.warn_n(
                "Missing style",
                "A styleUrl pointed at a style that does not exist in this file",
                missing_styles,
            );
        }

        // Column types: declared by a Schema, else inferred from the values.
        let mut inferred: Vec<(bool, bool, bool)> = vec![(true, true, false); self.columns.len()]; // (all number, all bool, any value)
        for f in &self.features {
            for (c, v) in &f.attrs {
                let e = &mut inferred[*c as usize];
                let t = v.trim();
                if t.is_empty() {
                    continue;
                }
                e.2 = true;
                if e.0 && t.parse::<f64>().is_err() {
                    e.0 = false;
                }
                if e.1 && !matches!(t.to_ascii_lowercase().as_str(), "true" | "false") {
                    e.1 = false;
                }
            }
        }
        let columns = self
            .columns
            .iter()
            .enumerate()
            .map(|(i, name)| {
                let ty = self
                    .declared_types
                    .get(name)
                    .copied()
                    .unwrap_or(match inferred[i] {
                        (_, true, true) => ColumnType::Bool,
                        (true, _, true) => ColumnType::Number,
                        _ => ColumnType::String,
                    });
                Column {
                    name: name.clone(),
                    ty,
                }
            })
            .collect();

        let warnings = self
            .warnings
            .iter()
            .map(|(k, (m, n))| Warning {
                kind: k.clone(),
                message: m.clone(),
                count: *n,
            })
            .collect();

        let mut feature_bounds = vec![[f64::NAN; 4]; self.features.len()];
        for (p, &f) in self.part_feature.iter().enumerate() {
            let start = self.part_offset[p] as usize * 3;
            let end = self
                .part_offset
                .get(p + 1)
                .map(|&o| o as usize * 3)
                .unwrap_or(self.coords.len());
            let b = &mut feature_bounds[f as usize];
            for v in self.coords[start..end].chunks_exact(3) {
                if b[0].is_nan() {
                    *b = [v[0], v[1], v[0], v[1]];
                } else {
                    b[0] = b[0].min(v[0]);
                    b[1] = b[1].min(v[1]);
                    b[2] = b[2].max(v[0]);
                    b[3] = b[3].max(v[1]);
                }
            }
        }

        LayerData {
            name: self.name,
            source_path: source_path.to_string(),
            format,
            features: self.features,
            feature_style,
            folders: self.folders,
            coords: self.coords,
            part_offset: self.part_offset,
            part_feature: self.part_feature,
            part_type: self.part_type,
            part_flags: self.part_flags,
            columns,
            styles,
            warnings,
            overlays: self.overlays,
            bounds: self.bounds,
            resources,
            feature_bounds,
            links: self.links,
            view_cache: Mutex::new(None),
        }
    }
}
