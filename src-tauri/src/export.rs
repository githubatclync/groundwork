// Layer export: KML 2.2, KMZ (KML plus the icons and overlay images it references), and GeoJSON.
// Works on `LayerData`, so imported layers and the user-drawn layer ("My Places", converted via
// `user_features_to_layer`) share one writer. Output streams to a file, so very large layers do
// not need to be held in memory twice. Element order follows the KML 2.2 schema sequences.
use std::collections::{BTreeSet, HashMap};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::layer::{
    ColumnType, LayerBuilder, LayerData, Resources, StyleRef, FLAG_ALT_MASK, FLAG_EXTRUDE,
    FLAG_HIDDEN, FLAG_TESSELLATE, GEOM_LINE, GEOM_POINT, GEOM_POLY_HOLE, GEOM_POLY_OUTER,
};
use crate::style::{normalize_href, rgba_to_kml_color, Style, StyleDef};

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("Could not write \"{file}\": {message}")]
    Io { file: String, message: String },
    #[error("Unknown layer \"{0}\"")]
    UnknownLayer(String),
    #[error("\"{0}\" is not a supported export type (expected .kml, .kmz, or .geojson)")]
    Unsupported(String),
    #[error("\"{name}\" has {count} features; making an editable copy is limited to {limit}")]
    TooLarge {
        name: String,
        count: usize,
        limit: usize,
    },
}

impl Serialize for ExportError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Kml,
    Kmz,
    GeoJson,
}

impl ExportFormat {
    pub fn from_path(path: &Path) -> Option<Self> {
        match path
            .extension()?
            .to_string_lossy()
            .to_ascii_lowercase()
            .as_str()
        {
            "kml" => Some(Self::Kml),
            "kmz" => Some(Self::Kmz),
            "geojson" | "json" => Some(Self::GeoJson),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub path: String,
    pub features: usize,
    /// Things that could not be preserved in the chosen format.
    pub notes: Vec<String>,
}

/// The small set of built-in icons for user-drawn points, bundled into exported KMZ files.
pub const BUILTIN_ICONS: &[(&str, &[u8])] = &[
    (
        "circle",
        include_bytes!("../assets/builtin-icons/circle.png"),
    ),
    (
        "square",
        include_bytes!("../assets/builtin-icons/square.png"),
    ),
    (
        "diamond",
        include_bytes!("../assets/builtin-icons/diamond.png"),
    ),
    (
        "triangle",
        include_bytes!("../assets/builtin-icons/triangle.png"),
    ),
    ("star", include_bytes!("../assets/builtin-icons/star.png")),
];

fn builtin_icon_bytes(href: &str) -> Option<&'static [u8]> {
    let name = href.strip_prefix("files/")?.strip_suffix(".png")?;
    BUILTIN_ICONS
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, b)| *b)
}

fn io_err(path: &Path, e: impl std::fmt::Display) -> ExportError {
    ExportError::Io {
        file: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        message: e.to_string(),
    }
}

/// Exports a layer in the format implied by the file extension.
pub fn export_layer(l: &LayerData, path: &Path) -> Result<ExportReport, ExportError> {
    let fmt = ExportFormat::from_path(path)
        .ok_or_else(|| ExportError::Unsupported(path.display().to_string()))?;
    let mut notes = Vec::new();
    let file = File::create(path).map_err(|e| io_err(path, e))?;
    match fmt {
        ExportFormat::Kml => {
            let mut w = BufWriter::new(file);
            let dropped = write_kml(l, &mut w, IconMode::DropLocal).map_err(|e| io_err(path, e))?;
            w.flush().map_err(|e| io_err(path, e))?;
            if dropped > 0 {
                notes.push(format!(
                    "{dropped} custom icon(s) were not included; save as KMZ to bundle icons and overlay images."
                ));
            }
        }
        ExportFormat::Kmz => write_kmz(l, file, &mut notes).map_err(|e| io_err(path, e))?,
        ExportFormat::GeoJson => {
            let mut w = BufWriter::new(file);
            write_geojson(l, &mut w).map_err(|e| io_err(path, e))?;
            w.flush().map_err(|e| io_err(path, e))?;
            if !l.overlays.is_empty() {
                notes.push("Ground overlays are not part of GeoJSON and were skipped.".into());
            }
            notes.push("Styles are not part of GeoJSON and were skipped.".into());
        }
    }
    Ok(ExportReport {
        path: path.display().to_string(),
        features: l.features.len(),
        notes,
    })
}

// ---------------------------------------------------------------- KML

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IconMode {
    /// Keep every icon/overlay href (used inside a KMZ that bundles the files).
    Keep,
    /// Drop references to local files that would not exist next to a bare .kml.
    DropLocal,
}

fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            // Control characters are not allowed in XML 1.0.
            c if (c as u32) < 0x20 && !matches!(c, '\n' | '\r' | '\t') => {}
            c => out.push(c),
        }
    }
    out
}

fn cdata(s: &str) -> String {
    // "]]>" cannot appear inside a CDATA section; split it across two sections.
    format!("<![CDATA[{}]]>", s.replace("]]>", "]]]]><![CDATA[>"))
}

fn is_remote(href: &str) -> bool {
    let h = href.to_ascii_lowercase();
    h.starts_with("http://") || h.starts_with("https://")
}

fn write_style<W: Write>(
    w: &mut W,
    id: usize,
    s: &Style,
    mode: IconMode,
    dropped: &mut usize,
) -> std::io::Result<()> {
    writeln!(w, "    <Style id=\"s{id}\">")?;
    if let Some(i) = &s.icon {
        write!(w, "      <IconStyle>")?;
        if let Some(c) = rgba_to_kml_color(&i.color) {
            write!(w, "<color>{c}</color>")?;
        }
        write!(w, "<scale>{}</scale>", i.scale)?;
        if i.heading != 0.0 {
            write!(w, "<heading>{}</heading>", i.heading)?;
        }
        if !i.href.is_empty() {
            if i.remote || mode == IconMode::Keep {
                write!(w, "<Icon><href>{}</href></Icon>", esc(&i.href))?;
            } else {
                *dropped += 1;
            }
        }
        writeln!(w, "</IconStyle>")?;
    }
    if let Some(l) = &s.label {
        writeln!(
            w,
            "      <LabelStyle><color>{}</color><scale>{}</scale></LabelStyle>",
            rgba_to_kml_color(&l.color).unwrap_or_else(|| "ffffffff".into()),
            l.scale
        )?;
    }
    writeln!(
        w,
        "      <LineStyle><color>{}</color><width>{}</width></LineStyle>",
        rgba_to_kml_color(&s.line.color).unwrap_or_else(|| "ffffffff".into()),
        s.line.width
    )?;
    writeln!(
        w,
        "      <PolyStyle><color>{}</color><fill>{}</fill><outline>{}</outline></PolyStyle>",
        rgba_to_kml_color(&s.poly.color).unwrap_or_else(|| "ffffffff".into()),
        s.poly.fill as u8,
        s.poly.outline as u8
    )?;
    writeln!(w, "    </Style>")
}

fn write_options<W: Write>(w: &mut W, flags: u8, lines_and_polys: bool) -> std::io::Result<()> {
    if flags & FLAG_EXTRUDE != 0 {
        write!(w, "<extrude>1</extrude>")?;
    }
    if lines_and_polys && flags & FLAG_TESSELLATE != 0 {
        write!(w, "<tessellate>1</tessellate>")?;
    }
    match flags & FLAG_ALT_MASK {
        1 => write!(w, "<altitudeMode>relativeToGround</altitudeMode>")?,
        2 => write!(w, "<altitudeMode>absolute</altitudeMode>")?,
        _ => {}
    }
    Ok(())
}

fn write_coords<W: Write>(
    w: &mut W,
    coords: &[f64],
    flags: u8,
    close: bool,
) -> std::io::Result<()> {
    let with_alt = flags & FLAG_ALT_MASK != 0;
    let mut first = true;
    let mut emit = |w: &mut W, v: &[f64]| -> std::io::Result<()> {
        if !first {
            write!(w, " ")?;
        }
        first = false;
        if with_alt || v[2] != 0.0 {
            write!(w, "{},{},{}", v[0], v[1], v[2])
        } else {
            write!(w, "{},{}", v[0], v[1])
        }
    };
    for v in coords.chunks_exact(3) {
        emit(w, v)?;
    }
    if close && coords.len() >= 6 && coords[..3] != coords[coords.len() - 3..] {
        emit(w, &coords[..3])?;
    }
    Ok(())
}

/// One drawable geometry of a feature: a point, a line, or a polygon (outer ring + holes).
enum Geom {
    Point(usize),
    Line(usize),
    Polygon(usize, Vec<usize>),
}

fn geometries(l: &LayerData, feature: u32) -> Vec<Geom> {
    let mut out = Vec::new();
    for p in l.parts_of(feature) {
        match l.part_type[p] {
            GEOM_POINT => out.push(Geom::Point(p)),
            GEOM_LINE => out.push(Geom::Line(p)),
            GEOM_POLY_OUTER => out.push(Geom::Polygon(p, Vec::new())),
            GEOM_POLY_HOLE => {
                if let Some(Geom::Polygon(_, holes)) = out.last_mut() {
                    holes.push(p);
                }
            }
            _ => {}
        }
    }
    out
}

fn write_geom<W: Write>(w: &mut W, l: &LayerData, g: &Geom) -> std::io::Result<()> {
    match g {
        Geom::Point(p) => {
            write!(w, "<Point>")?;
            write_options(w, l.part_flags[*p], false)?;
            write!(w, "<coordinates>")?;
            write_coords(w, l.part_coords(*p), l.part_flags[*p], false)?;
            write!(w, "</coordinates></Point>")
        }
        Geom::Line(p) => {
            write!(w, "<LineString>")?;
            write_options(w, l.part_flags[*p], true)?;
            write!(w, "<coordinates>")?;
            write_coords(w, l.part_coords(*p), l.part_flags[*p], false)?;
            write!(w, "</coordinates></LineString>")
        }
        Geom::Polygon(outer, holes) => {
            let flags = l.part_flags[*outer];
            write!(w, "<Polygon>")?;
            write_options(w, flags, true)?;
            write!(w, "<outerBoundaryIs><LinearRing><coordinates>")?;
            write_coords(w, l.part_coords(*outer), flags, true)?;
            write!(w, "</coordinates></LinearRing></outerBoundaryIs>")?;
            for h in holes {
                write!(w, "<innerBoundaryIs><LinearRing><coordinates>")?;
                write_coords(w, l.part_coords(*h), flags, true)?;
                write!(w, "</coordinates></LinearRing></innerBoundaryIs>")?;
            }
            write!(w, "</Polygon>")
        }
    }
}

struct Ctx<'a> {
    l: &'a LayerData,
    mode: IconMode,
    children: Vec<Vec<u32>>,
    features_in: Vec<Vec<u32>>,
    /// Lowest feature id inside each folder's subtree (u32::MAX if it has none); used to keep the
    /// original interleaving of placemarks and subfolders.
    first_feature: Vec<u32>,
}

fn write_placemark<W: Write>(w: &mut W, l: &LayerData, f: u32, pad: &str) -> std::io::Result<()> {
    let feat = &l.features[f as usize];
    let hidden = l.parts_of(f).any(|p| l.part_flags[p] & FLAG_HIDDEN != 0) || !feat.visible;
    write!(w, "{pad}<Placemark>")?;
    write!(w, "<name>{}</name>", esc(&feat.name))?;
    if hidden {
        write!(w, "<visibility>0</visibility>")?;
    }
    if let Some(d) = &feat.description {
        write!(w, "<description>{}</description>", cdata(d))?;
    }
    let style = l.feature_style[f as usize];
    if style != 0 {
        write!(w, "<styleUrl>#s{style}</styleUrl>")?;
    }
    if !feat.attrs.is_empty() {
        write!(w, "<ExtendedData>")?;
        for (col, v) in &feat.attrs {
            write!(
                w,
                "<Data name=\"{}\"><value>{}</value></Data>",
                esc(&l.columns[*col as usize].name),
                esc(v)
            )?;
        }
        write!(w, "</ExtendedData>")?;
    }
    let geoms = geometries(l, f);
    if geoms.len() == 1 {
        write_geom(w, l, &geoms[0])?;
    } else if geoms.len() > 1 {
        write!(w, "<MultiGeometry>")?;
        for g in &geoms {
            write_geom(w, l, g)?;
        }
        write!(w, "</MultiGeometry>")?;
    }
    writeln!(w, "</Placemark>")
}

fn write_folder<W: Write>(w: &mut W, c: &Ctx, folder: u32, depth: usize) -> std::io::Result<()> {
    let pad = "  ".repeat(depth);
    let l = c.l;
    // Placemarks and subfolders in their original order, then overlays.
    let mut items: Vec<(u32, bool, u32)> = c.features_in[folder as usize]
        .iter()
        .map(|&f| (f, false, f))
        .collect();
    items.extend(
        c.children[folder as usize]
            .iter()
            .map(|&k| (c.first_feature[k as usize], true, k)),
    );
    items.sort();
    for (_, is_folder, id) in items {
        if !is_folder {
            write_placemark(w, l, id, &pad)?;
            continue;
        }
        let f = &l.folders[id as usize];
        writeln!(w, "{pad}<Folder><name>{}</name>", esc(&f.name))?;
        if !f.visible {
            writeln!(w, "{pad}  <visibility>0</visibility>")?;
        }
        if f.open {
            writeln!(w, "{pad}  <open>1</open>")?;
        }
        write_folder(w, c, id, depth + 1)?;
        writeln!(w, "{pad}</Folder>")?;
    }
    for o in l
        .overlays
        .iter()
        .filter(|o| o.folder == folder && !o.href.is_empty())
    {
        if c.mode == IconMode::DropLocal && !is_remote(&o.href) {
            continue; // counted by the caller
        }
        write!(w, "{pad}<GroundOverlay><name>{}</name>", esc(&o.name))?;
        if !o.visible {
            write!(w, "<visibility>0</visibility>")?;
        }
        if let Some(col) = rgba_to_kml_color(&o.color) {
            write!(w, "<color>{col}</color>")?;
        }
        write!(w, "<Icon><href>{}</href></Icon>", esc(&o.href))?;
        write!(
            w,
            "<LatLonBox><north>{}</north><south>{}</south><east>{}</east><west>{}</west>",
            o.north, o.south, o.east, o.west
        )?;
        if o.rotation != 0.0 {
            write!(w, "<rotation>{}</rotation>", o.rotation)?;
        }
        writeln!(w, "</LatLonBox></GroundOverlay>")?;
    }
    Ok(())
}

/// Writes the layer as KML 2.2. Returns the number of local icon/overlay references that were
/// dropped (only in `IconMode::DropLocal`).
pub fn write_kml<W: Write>(l: &LayerData, w: &mut W, mode: IconMode) -> std::io::Result<usize> {
    let mut children = vec![Vec::new(); l.folders.len()];
    for (i, f) in l.folders.iter().enumerate() {
        if let Some(p) = f.parent {
            children[p as usize].push(i as u32);
        }
    }
    let mut features_in = vec![Vec::new(); l.folders.len()];
    for (i, f) in l.features.iter().enumerate() {
        features_in[f.folder as usize].push(i as u32);
    }
    let mut first_feature = vec![u32::MAX; l.folders.len()];
    for (i, f) in l.features.iter().enumerate() {
        // Walk up so every ancestor knows its earliest feature.
        let mut folder = Some(f.folder);
        while let Some(id) = folder {
            let slot = &mut first_feature[id as usize];
            *slot = (*slot).min(i as u32);
            folder = l.folders[id as usize].parent;
        }
    }
    let c = Ctx {
        l,
        mode,
        children,
        features_in,
        first_feature,
    };

    let mut dropped = 0;
    writeln!(w, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>")?;
    writeln!(w, "<kml xmlns=\"http://www.opengis.net/kml/2.2\">")?;
    writeln!(w, "  <Document>")?;
    writeln!(w, "    <name>{}</name>", esc(&l.name))?;
    if !l.folders[0].visible {
        writeln!(w, "    <visibility>0</visibility>")?;
    }
    for (i, s) in l.styles.iter().enumerate().skip(1) {
        write_style(w, i, s, mode, &mut dropped)?;
    }
    if mode == IconMode::DropLocal {
        dropped += l.overlays.iter().filter(|o| !is_remote(&o.href)).count();
    }
    write_folder(w, &c, 0, 2)?;
    writeln!(w, "  </Document>")?;
    writeln!(w, "</kml>")?;
    Ok(dropped)
}

/// Collects the local files a KMZ must bundle: icon hrefs from styles and overlay images.
fn referenced_files(l: &LayerData) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for s in &l.styles {
        if let Some(i) = &s.icon {
            if !i.href.is_empty() && !i.remote {
                out.insert(normalize_href(&i.href));
            }
        }
    }
    for o in &l.overlays {
        if !o.href.is_empty() && !is_remote(&o.href) {
            out.insert(normalize_href(&o.href));
        }
    }
    out
}

fn write_kmz(l: &LayerData, file: File, notes: &mut Vec<String>) -> std::io::Result<()> {
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("doc.kml", opts)?;
    {
        let mut w = BufWriter::new(&mut zip);
        write_kml(l, &mut w, IconMode::Keep)?;
        w.flush()?;
    }
    for name in referenced_files(l) {
        let bytes = builtin_icon_bytes(&name)
            .map(|b| b.to_vec())
            .or_else(|| l.resources.read(&name));
        match bytes {
            Some(b) => {
                zip.start_file(name, opts)?;
                zip.write_all(&b)?;
            }
            None => notes.push(format!(
                "\"{name}\" could not be found and was not bundled."
            )),
        }
    }
    zip.finish()?;
    Ok(())
}

// ---------------------------------------------------------------- GeoJSON

fn position(v: &[f64]) -> Value {
    if v[2] != 0.0 {
        json!([v[0], v[1], v[2]])
    } else {
        json!([v[0], v[1]])
    }
}

fn line_json(coords: &[f64], close: bool) -> Value {
    let mut pts: Vec<Value> = coords.chunks_exact(3).map(position).collect();
    if close && coords.len() >= 6 && coords[..3] != coords[coords.len() - 3..] {
        pts.push(position(&coords[..3]));
    }
    Value::Array(pts)
}

fn geometry_json(l: &LayerData, feature: u32) -> Value {
    let geoms = geometries(l, feature);
    let one = |g: &Geom| -> Value {
        match g {
            Geom::Point(p) => json!({"type": "Point", "coordinates": position(l.part_coords(*p))}),
            Geom::Line(p) => {
                json!({"type": "LineString", "coordinates": line_json(l.part_coords(*p), false)})
            }
            Geom::Polygon(o, holes) => {
                let mut rings = vec![line_json(l.part_coords(*o), true)];
                rings.extend(holes.iter().map(|h| line_json(l.part_coords(*h), true)));
                json!({"type": "Polygon", "coordinates": rings})
            }
        }
    };
    match geoms.len() {
        0 => Value::Null,
        1 => one(&geoms[0]),
        _ => {
            let all_points = geoms.iter().all(|g| matches!(g, Geom::Point(_)));
            let all_lines = geoms.iter().all(|g| matches!(g, Geom::Line(_)));
            let all_polys = geoms.iter().all(|g| matches!(g, Geom::Polygon(..)));
            let coords = |g: &Geom| one(g)["coordinates"].clone();
            if all_points {
                json!({"type": "MultiPoint", "coordinates": geoms.iter().map(coords).collect::<Vec<_>>()})
            } else if all_lines {
                json!({"type": "MultiLineString", "coordinates": geoms.iter().map(coords).collect::<Vec<_>>()})
            } else if all_polys {
                json!({"type": "MultiPolygon", "coordinates": geoms.iter().map(coords).collect::<Vec<_>>()})
            } else {
                json!({"type": "GeometryCollection", "geometries": geoms.iter().map(one).collect::<Vec<_>>()})
            }
        }
    }
}

pub fn write_geojson<W: Write>(l: &LayerData, w: &mut W) -> std::io::Result<()> {
    write!(
        w,
        "{{\"type\":\"FeatureCollection\",\"name\":{},\"features\":[",
        json!(l.name)
    )?;
    for (i, f) in l.features.iter().enumerate() {
        if i > 0 {
            write!(w, ",")?;
        }
        let mut props = serde_json::Map::new();
        props.insert("name".into(), json!(f.name));
        if let Some(d) = &f.description {
            props.insert("description".into(), json!(d));
        }
        for (c, v) in &f.attrs {
            let col = &l.columns[*c as usize];
            let value = match col.ty {
                ColumnType::Number => v
                    .trim()
                    .parse::<f64>()
                    .ok()
                    .and_then(|n| serde_json::Number::from_f64(n))
                    .map(Value::Number),
                ColumnType::Bool => match v.trim().to_ascii_lowercase().as_str() {
                    "true" => Some(Value::Bool(true)),
                    "false" => Some(Value::Bool(false)),
                    _ => None,
                },
                ColumnType::String => None,
            }
            .unwrap_or_else(|| json!(v));
            props.insert(col.name.clone(), value);
        }
        let feature =
            json!({"type": "Feature", "properties": props, "geometry": geometry_json(l, i as u32)});
        serde_json::to_writer(&mut *w, &feature)?;
    }
    write!(w, "]}}")
}

// ---------------------------------------------------------------- user-drawn features

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserStyleDto {
    /// `#rrggbb`
    pub color: String,
    pub width: f32,
    /// 0 (no fill) to 1 (opaque) for polygons.
    pub fill_opacity: f32,
    /// Name of a built-in icon (points only); None for the default marker.
    pub icon: Option<String>,
    pub scale: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFeatureDto {
    pub name: String,
    pub description: String,
    /// "point", "line", or "polygon".
    pub kind: String,
    pub coords: Vec<[f64; 2]>,
    #[serde(default)]
    pub holes: Vec<Vec<[f64; 2]>>,
    #[serde(default)]
    pub attrs: Vec<(String, String)>,
    pub style: UserStyleDto,
    #[serde(default = "yes")]
    pub visible: bool,
}

fn yes() -> bool {
    true
}

fn hex_rgb(color: &str) -> String {
    let c = color.trim().trim_start_matches('#');
    if c.len() == 6 && c.bytes().all(|b| b.is_ascii_hexdigit()) {
        c.to_ascii_lowercase()
    } else {
        "ff9800".into()
    }
}

fn triples(coords: &[[f64; 2]]) -> Vec<f64> {
    coords.iter().flat_map(|c| [c[0], c[1], 0.0]).collect()
}

/// Builds a layer from user-drawn features so the shared writers can export it.
pub fn user_features_to_layer(name: &str, features: &[UserFeatureDto]) -> LayerData {
    let mut b = LayerBuilder::new(name);
    for f in features {
        let rgb = hex_rgb(&f.style.color);
        let fill_alpha = (f.style.fill_opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
        let def = StyleDef {
            has_icon: f.kind == "point",
            icon_href: f.style.icon.as_ref().map(|i| format!("files/{i}.png")),
            icon_scale: Some(f.style.scale),
            icon_color: Some(format!("{rgb}ff")),
            line_color: Some(format!("{rgb}ff")),
            line_width: Some(f.style.width),
            poly_color: Some(format!("{rgb}{fill_alpha:02x}")),
            poly_fill: Some(fill_alpha > 0),
            poly_outline: Some(true),
            ..Default::default()
        };
        let description = (!f.description.is_empty()).then(|| f.description.clone());
        b.begin_feature(
            f.name.clone(),
            description,
            f.visible,
            Some(StyleRef::Inline(def)),
        );
        match f.kind.as_str() {
            "point" => {
                if let Some(c) = f.coords.first() {
                    b.add_part(GEOM_POINT, &[c[0], c[1], 0.0], 0);
                }
            }
            "line" => b.add_part(GEOM_LINE, &triples(&f.coords), 0),
            _ => {
                b.add_part(GEOM_POLY_OUTER, &triples(&f.coords), 0);
                for h in &f.holes {
                    b.add_part(GEOM_POLY_HOLE, &triples(h), 0);
                }
            }
        }
        for (k, v) in &f.attrs {
            b.add_attr(k, v.clone());
        }
        b.end_feature();
    }
    b.finish("", "user", Resources::None)
}

pub const EDITABLE_COPY_LIMIT: usize = 10_000;

fn pairs(coords: &[f64]) -> Vec<[f64; 2]> {
    coords.chunks_exact(3).map(|v| [v[0], v[1]]).collect()
}

fn open_ring(mut pts: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    if pts.len() > 3 && pts.first() == pts.last() {
        pts.pop();
    }
    pts
}

/// Converts an imported layer into editable user features (one per geometry part group; altitude
/// is dropped). Features with several geometries are split and numbered.
pub fn layer_to_user_features(l: &LayerData) -> Result<Vec<UserFeatureDto>, ExportError> {
    if l.features.len() > EDITABLE_COPY_LIMIT {
        return Err(ExportError::TooLarge {
            name: l.name.clone(),
            count: l.features.len(),
            limit: EDITABLE_COPY_LIMIT,
        });
    }
    let mut out = Vec::new();
    let col_names: HashMap<u16, &str> = l
        .columns
        .iter()
        .enumerate()
        .map(|(i, c)| (i as u16, c.name.as_str()))
        .collect();
    for (id, f) in l.features.iter().enumerate() {
        let style = &l.styles[l.feature_style[id] as usize];
        let geoms = geometries(l, id as u32);
        let attrs: Vec<(String, String)> = f
            .attrs
            .iter()
            .map(|(c, v)| (col_names[c].to_string(), v.to_string()))
            .collect();
        let total = geoms.len();
        for (n, g) in geoms.iter().enumerate() {
            let name = if total > 1 {
                format!("{} ({})", f.name, n + 1)
            } else {
                f.name.clone()
            };
            let (kind, coords, holes) = match g {
                Geom::Point(p) => ("point", pairs(l.part_coords(*p)), vec![]),
                Geom::Line(p) => ("line", pairs(l.part_coords(*p)), vec![]),
                Geom::Polygon(o, hs) => (
                    "polygon",
                    open_ring(pairs(l.part_coords(*o))),
                    hs.iter()
                        .map(|h| open_ring(pairs(l.part_coords(*h))))
                        .collect(),
                ),
            };
            let (color, icon, scale) = match (kind, &style.icon) {
                ("point", Some(i)) => (i.color[..6].to_string(), builtin_name(&i.href), i.scale),
                _ => (style.line.color[..6].to_string(), None, 1.0),
            };
            let fill_opacity = if kind == "polygon" && style.poly.fill {
                u8::from_str_radix(&style.poly.color[6..8], 16).unwrap_or(255) as f32 / 255.0
            } else if kind == "polygon" {
                0.0
            } else {
                0.25
            };
            out.push(UserFeatureDto {
                name,
                description: f.description.clone().unwrap_or_default(),
                kind: kind.into(),
                coords,
                holes,
                attrs: attrs.clone(),
                style: UserStyleDto {
                    color: format!("#{color}"),
                    width: style.line.width,
                    fill_opacity,
                    icon,
                    scale,
                },
                visible: f.visible,
            });
        }
    }
    Ok(out)
}

fn builtin_name(href: &str) -> Option<String> {
    let name = href.strip_prefix("files/")?.strip_suffix(".png")?;
    BUILTIN_ICONS
        .iter()
        .any(|(n, _)| *n == name)
        .then(|| name.to_string())
}

#[cfg(test)]
mod tests;
