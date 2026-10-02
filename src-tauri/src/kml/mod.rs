// Streaming KML parser built on quick-xml's event reader (never builds a DOM). It feeds a
// `LayerBuilder` with folders, features, geometry parts, styles, attributes, overlays, and
// warnings. Namespaces are ignored (matching on local names), so `kml:` prefixes, missing
// namespaces, and `gx:` altitude modes all work.
pub mod kmz;

use std::io::BufRead;

use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::Reader;

use crate::layer::{
    LayerBuilder, Loc, Overlay, StyleMapDef, StyleRef, FLAG_EXTRUDE, FLAG_TESSELLATE, GEOM_LINE,
    GEOM_POINT, GEOM_POLY_HOLE, GEOM_POLY_OUTER,
};
use crate::style::{kml_color_to_rgba, normalize_href, StyleDef, WHITE};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum E {
    Kml,
    Document,
    Folder,
    Placemark,
    Point,
    LineString,
    LinearRing,
    Polygon,
    Outer,
    Inner,
    Multi,
    Style,
    StyleMap,
    Pair,
    IconStyle,
    LabelStyle,
    LineStyle,
    PolyStyle,
    Icon,
    GroundOverlay,
    LatLonBox,
    Data,
    SimpleData,
    Name,
    Description,
    Visibility,
    Open,
    StyleUrl,
    Coordinates,
    AltitudeMode,
    Extrude,
    Tessellate,
    Color,
    Scale,
    Width,
    Heading,
    Href,
    Fill,
    Outline,
    Key,
    Value,
    North,
    South,
    East,
    West,
    Rotation,
    Other,
}

fn classify(name: &str) -> E {
    match name {
        "kml" => E::Kml,
        "Document" => E::Document,
        "Folder" => E::Folder,
        "Placemark" => E::Placemark,
        "Point" => E::Point,
        "LineString" => E::LineString,
        "LinearRing" => E::LinearRing,
        "Polygon" => E::Polygon,
        "outerBoundaryIs" => E::Outer,
        "innerBoundaryIs" => E::Inner,
        "MultiGeometry" => E::Multi,
        "Style" => E::Style,
        "StyleMap" => E::StyleMap,
        "Pair" => E::Pair,
        "IconStyle" => E::IconStyle,
        "LabelStyle" => E::LabelStyle,
        "LineStyle" => E::LineStyle,
        "PolyStyle" => E::PolyStyle,
        "Icon" => E::Icon,
        "GroundOverlay" => E::GroundOverlay,
        "LatLonBox" => E::LatLonBox,
        "Data" => E::Data,
        "SimpleData" => E::SimpleData,
        "name" => E::Name,
        "description" => E::Description,
        "visibility" => E::Visibility,
        "open" => E::Open,
        "styleUrl" => E::StyleUrl,
        "coordinates" => E::Coordinates,
        "altitudeMode" => E::AltitudeMode,
        "extrude" => E::Extrude,
        "tessellate" => E::Tessellate,
        "color" => E::Color,
        "scale" => E::Scale,
        "width" => E::Width,
        "heading" => E::Heading,
        "href" => E::Href,
        "fill" => E::Fill,
        "outline" => E::Outline,
        "key" => E::Key,
        "value" => E::Value,
        "north" => E::North,
        "south" => E::South,
        "east" => E::East,
        "west" => E::West,
        "rotation" => E::Rotation,
        _ => E::Other,
    }
}

/// Elements recognized but not supported in v1; their whole subtree is skipped with a warning.
fn is_unsupported(name: &str) -> bool {
    matches!(
        name,
        "NetworkLink"
            | "ScreenOverlay"
            | "PhotoOverlay"
            | "Model"
            | "Track"
            | "MultiTrack"
            | "TimeStamp"
            | "TimeSpan"
            | "Region"
            | "LatLonQuad"
            | "Tour"
    )
}

fn is_leaf(e: E) -> bool {
    matches!(
        e,
        E::Name
            | E::Description
            | E::Visibility
            | E::Open
            | E::StyleUrl
            | E::Coordinates
            | E::AltitudeMode
            | E::Extrude
            | E::Tessellate
            | E::Color
            | E::Scale
            | E::Width
            | E::Heading
            | E::Href
            | E::Fill
            | E::Outline
            | E::Key
            | E::Value
            | E::North
            | E::South
            | E::East
            | E::West
            | E::Rotation
            | E::SimpleData
    )
}

fn is_geometry(e: E) -> bool {
    matches!(e, E::Point | E::LineString | E::LinearRing | E::Polygon)
}

fn truthy(s: &str) -> bool {
    matches!(s.trim(), "1" | "true" | "True" | "TRUE")
}

/// Parses `lon,lat[,alt]` tuples separated by whitespace. Tuples may contain stray whitespace
/// after commas. Invalid tuples are dropped and counted in the returned value.
pub fn parse_coords(text: &str, out: &mut Vec<f64>) -> u32 {
    let mut bad = 0;
    let mut acc = String::new();
    let mut flush = |acc: &str, out: &mut Vec<f64>| {
        if acc.is_empty() {
            return;
        }
        let mut it = acc.split(',');
        let lon = it.next().and_then(|s| s.trim().parse::<f64>().ok());
        let lat = it.next().and_then(|s| s.trim().parse::<f64>().ok());
        let alt = match it.next() {
            None => Some(0.0),
            Some(s) if s.trim().is_empty() => Some(0.0),
            Some(s) => s.trim().parse::<f64>().ok(),
        };
        match (lon, lat, alt) {
            (Some(lon), Some(lat), Some(alt))
                if lon.is_finite()
                    && lat.is_finite()
                    && alt.is_finite()
                    && (-90.0..=90.0).contains(&lat)
                    && (-360.0..=360.0).contains(&lon) =>
            {
                let lon = if lon > 180.0 {
                    lon - 360.0
                } else if lon < -180.0 {
                    lon + 360.0
                } else {
                    lon
                };
                out.extend_from_slice(&[lon, lat, alt]);
            }
            _ => bad += 1,
        }
    };
    for tok in text.split_whitespace() {
        // A tuple has at most two commas (lon,lat,alt). Stray whitespace around a comma joins
        // the neighbouring tokens; a complete tuple followed by another tuple stays separate.
        let commas = acc.matches(',').count();
        let joins = (tok.starts_with(',') && commas < 2)
            || (acc.ends_with(',') && (commas < 2 || !tok.contains(',')));
        if !acc.is_empty() && !joins {
            flush(&acc, out);
            acc.clear();
        }
        acc.push_str(tok);
    }
    flush(&acc, out);
    bad
}

struct Frame {
    kind: E,
    alt: u8,
    extrude: bool,
    tessellate: bool,
    coords: Vec<f64>,
    outer: Option<Vec<f64>>,
    inners: Vec<Vec<f64>>,
}

impl Frame {
    fn new(kind: E) -> Self {
        Frame {
            kind,
            alt: 0,
            extrude: false,
            tessellate: false,
            coords: Vec::new(),
            outer: None,
            inners: Vec::new(),
        }
    }
    fn flags(&self) -> u8 {
        self.alt
            | if self.extrude { FLAG_EXTRUDE } else { 0 }
            | if self.tessellate { FLAG_TESSELLATE } else { 0 }
    }
}

struct PartMeta {
    ty: u8,
    start: usize,
    end: usize,
    flags: u8,
}

#[derive(Default)]
struct Pm {
    name: String,
    description: Option<String>,
    visible: bool,
    style: Option<StyleRef>,
    attrs: Vec<(String, String)>,
    coords: Vec<f64>,
    parts: Vec<PartMeta>,
}

impl Pm {
    fn add(&mut self, ty: u8, coords: &[f64], flags: u8) {
        let start = self.coords.len();
        self.coords.extend_from_slice(coords);
        self.parts.push(PartMeta {
            ty,
            start,
            end: self.coords.len(),
            flags,
        });
    }
}

enum StyleTarget {
    Placemark,
    Pair,
    Shared(String),
    Discard,
}

struct StyleCtx {
    def: StyleDef,
    target: StyleTarget,
}

#[derive(Default)]
struct Ov {
    name: String,
    href: String,
    remote: bool,
    north: Option<f64>,
    south: Option<f64>,
    east: Option<f64>,
    west: Option<f64>,
    rotation: f64,
    color: Option<String>,
    visible: bool,
}

struct Parser<'b> {
    b: &'b mut LayerBuilder,
    stack: Vec<E>,
    folder_pushed: Vec<bool>,
    root_used: bool,
    text: String,
    skip: usize,
    pm: Option<Pm>,
    geoms: Vec<Frame>,
    style: Option<StyleCtx>,
    smap: Option<(Option<String>, StyleMapDef)>,
    pair_key: String,
    pair_ref: Option<StyleRef>,
    data_name: String,
    simple_name: String,
    overlay: Option<Ov>,
}

fn attr(e: &BytesStart, key: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == key)
        .and_then(|a| {
            a.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .ok()
                .map(|v| v.into_owned())
        })
}

impl<'b> Parser<'b> {
    fn new(b: &'b mut LayerBuilder) -> Self {
        Parser {
            b,
            stack: Vec::new(),
            folder_pushed: Vec::new(),
            root_used: false,
            text: String::new(),
            skip: 0,
            pm: None,
            geoms: Vec::new(),
            style: None,
            smap: None,
            pair_key: String::new(),
            pair_ref: None,
            data_name: String::new(),
            simple_name: String::new(),
            overlay: None,
        }
    }

    fn start(&mut self, name: &str, e: &BytesStart) {
        if self.skip > 0 {
            self.skip += 1;
            return;
        }
        if is_unsupported(name) {
            self.b.warn(name, "Unsupported element skipped");
            self.skip = 1;
            return;
        }
        if name == "SimpleField" {
            if let (Some(n), Some(t)) = (attr(e, "name"), attr(e, "type")) {
                let ty = match t.to_ascii_lowercase().as_str() {
                    "int" | "uint" | "short" | "ushort" | "float" | "double" => {
                        Some(crate::layer::ColumnType::Number)
                    }
                    "bool" => Some(crate::layer::ColumnType::Bool),
                    "string" => Some(crate::layer::ColumnType::String),
                    _ => None,
                };
                if let Some(ty) = ty {
                    self.b.declare_column_type(&n, ty);
                }
            }
        }
        let el = classify(name);
        let parent = self.stack.last().copied();
        match el {
            E::Document | E::Folder => {
                let is_root_doc =
                    el == E::Document && !self.root_used && self.stack.iter().all(|s| *s == E::Kml);
                if is_root_doc {
                    self.root_used = true;
                    self.folder_pushed.push(false);
                } else {
                    self.b.push_folder(if el == E::Document {
                        "Document"
                    } else {
                        "Folder"
                    });
                    self.folder_pushed.push(true);
                }
            }
            E::Placemark => {
                self.pm = Some(Pm {
                    visible: true,
                    ..Default::default()
                });
            }
            E::Point | E::LineString | E::LinearRing | E::Polygon => {
                self.geoms.push(Frame::new(el))
            }
            E::Style => {
                let target = if parent == Some(E::Placemark) {
                    StyleTarget::Placemark
                } else if parent == Some(E::Pair) {
                    StyleTarget::Pair
                } else {
                    attr(e, "id")
                        .map(StyleTarget::Shared)
                        .unwrap_or(StyleTarget::Discard)
                };
                self.style = Some(StyleCtx {
                    def: StyleDef::default(),
                    target,
                });
            }
            E::StyleMap => {
                let id = if parent == Some(E::Placemark) {
                    None
                } else {
                    attr(e, "id")
                };
                self.smap = Some((id, StyleMapDef::default()));
            }
            E::Pair => {
                self.pair_key.clear();
                self.pair_ref = None;
            }
            E::IconStyle => {
                if let Some(s) = &mut self.style {
                    s.def.has_icon = true;
                }
            }
            E::LabelStyle => {
                if let Some(s) = &mut self.style {
                    s.def.has_label = true;
                }
            }
            E::GroundOverlay => {
                self.overlay = Some(Ov {
                    visible: true,
                    ..Default::default()
                })
            }
            E::Data => self.data_name = attr(e, "name").unwrap_or_default(),
            E::SimpleData => {
                self.simple_name = attr(e, "name").unwrap_or_default();
                self.text.clear();
            }
            e if is_leaf(e) => self.text.clear(),
            _ => {}
        }
        self.stack.push(el);
    }

    fn text(&mut self, s: &str) {
        if self.skip == 0 && self.stack.last().is_some_and(|e| is_leaf(*e)) {
            self.text.push_str(s);
        }
    }

    fn entity(&mut self, r: &BytesRef) {
        if self.skip > 0 || !self.stack.last().is_some_and(|e| is_leaf(*e)) {
            return;
        }
        if let Ok(Some(c)) = r.resolve_char_ref() {
            self.text.push(c);
            return;
        }
        match &**r {
            "amp" => self.text.push('&'),
            "lt" => self.text.push('<'),
            "gt" => self.text.push('>'),
            "quot" => self.text.push('"'),
            "apos" => self.text.push('\''),
            other => {
                self.text.push('&');
                self.text.push_str(other);
                self.text.push(';');
            }
        }
    }

    fn end(&mut self) {
        if self.skip > 0 {
            self.skip -= 1;
            return;
        }
        let Some(el) = self.stack.pop() else { return };
        let parent = self.stack.last().copied();
        let grand = self
            .stack
            .len()
            .checked_sub(2)
            .and_then(|i| self.stack.get(i).copied());
        let text = std::mem::take(&mut self.text);
        let t = text.trim();
        match el {
            E::Document | E::Folder => {
                if self.folder_pushed.pop().unwrap_or(false) {
                    self.b.pop_folder();
                }
            }
            E::Name if !t.is_empty() => match parent {
                Some(E::Placemark) => {
                    if let Some(pm) = &mut self.pm {
                        pm.name = t.to_string();
                    }
                }
                Some(E::Document) | Some(E::Folder) => self.b.set_folder_name(t),
                Some(E::GroundOverlay) => {
                    if let Some(o) = &mut self.overlay {
                        o.name = t.to_string();
                    }
                }
                _ => {}
            },
            E::Description => {
                if let (Some(E::Placemark), Some(pm)) = (parent, &mut self.pm) {
                    if !t.is_empty() {
                        pm.description = Some(t.to_string());
                    }
                }
            }
            E::Visibility => match parent {
                Some(E::Placemark) => {
                    if let Some(pm) = &mut self.pm {
                        pm.visible = truthy(t);
                    }
                }
                Some(E::Document) | Some(E::Folder) => self.b.set_folder_visible(truthy(t)),
                Some(E::GroundOverlay) => {
                    if let Some(o) = &mut self.overlay {
                        o.visible = truthy(t);
                    }
                }
                _ => {}
            },
            E::Open if matches!(parent, Some(E::Document) | Some(E::Folder)) => {
                self.b.set_folder_open(truthy(t))
            }
            E::StyleUrl => {
                let r = match t.strip_prefix('#') {
                    Some(id) => Some(StyleRef::Url(id.to_string())),
                    None => {
                        if !t.is_empty() {
                            self.b.warn(
                                "External style",
                                "styleUrl references another file, which is not supported",
                            );
                        }
                        None
                    }
                };
                match parent {
                    Some(E::Placemark) => {
                        if let Some(pm) = &mut self.pm {
                            pm.style = r;
                        }
                    }
                    Some(E::Pair) => self.pair_ref = r,
                    _ => {}
                }
            }
            E::Key => self.pair_key = t.to_string(),
            E::Coordinates => {
                if parent.is_some_and(is_geometry) {
                    if let Some(f) = self.geoms.last_mut() {
                        f.coords.clear();
                        let bad = parse_coords(&text, &mut f.coords);
                        if bad > 0 {
                            self.b.warn_n(
                                "Malformed coordinates",
                                "Coordinate tuples that could not be parsed were dropped",
                                bad,
                            );
                        }
                    }
                }
            }
            E::AltitudeMode => {
                if parent.is_some_and(is_geometry) {
                    if let Some(f) = self.geoms.last_mut() {
                        f.alt = match t {
                            "relativeToGround" | "relativeToSeaFloor" => 1,
                            "absolute" => 2,
                            _ => 0,
                        };
                    }
                }
            }
            E::Extrude => {
                if parent.is_some_and(is_geometry) {
                    if let Some(f) = self.geoms.last_mut() {
                        f.extrude = truthy(t);
                    }
                }
            }
            E::Tessellate => {
                if parent.is_some_and(is_geometry) {
                    if let Some(f) = self.geoms.last_mut() {
                        f.tessellate = truthy(t);
                    }
                }
            }
            E::Color => {
                let c = kml_color_to_rgba(t);
                match parent {
                    Some(E::IconStyle) => self.with_style(|d| d.icon_color = c),
                    Some(E::LabelStyle) => self.with_style(|d| d.label_color = c),
                    Some(E::LineStyle) => self.with_style(|d| d.line_color = c),
                    Some(E::PolyStyle) => self.with_style(|d| d.poly_color = c),
                    Some(E::GroundOverlay) => {
                        if let Some(o) = &mut self.overlay {
                            o.color = c;
                        }
                    }
                    _ => {}
                }
            }
            E::Scale => {
                let v = t.parse::<f32>().ok();
                match parent {
                    Some(E::IconStyle) => self.with_style(|d| d.icon_scale = v),
                    Some(E::LabelStyle) => self.with_style(|d| d.label_scale = v),
                    _ => {}
                }
            }
            E::Width if parent == Some(E::LineStyle) => {
                let v = t.parse::<f32>().ok();
                self.with_style(|d| d.line_width = v);
            }
            E::Heading if parent == Some(E::IconStyle) => {
                let v = t.parse::<f32>().ok();
                self.with_style(|d| d.icon_heading = v);
            }
            E::Href if parent == Some(E::Icon) => match grand {
                Some(E::IconStyle) => {
                    let h = t.to_string();
                    self.with_style(|d| d.icon_href = Some(h));
                }
                Some(E::GroundOverlay) => {
                    if let Some(o) = &mut self.overlay {
                        let lower = t.to_ascii_lowercase();
                        o.remote = lower.starts_with("http://") || lower.starts_with("https://");
                        o.href = if o.remote {
                            t.to_string()
                        } else {
                            normalize_href(t)
                        };
                    }
                }
                _ => {}
            },
            E::Fill if parent == Some(E::PolyStyle) => {
                let v = truthy(t);
                self.with_style(|d| d.poly_fill = Some(v));
            }
            E::Outline if parent == Some(E::PolyStyle) => {
                let v = truthy(t);
                self.with_style(|d| d.poly_outline = Some(v));
            }
            E::North | E::South | E::East | E::West | E::Rotation
                if parent == Some(E::LatLonBox) =>
            {
                let v = t.parse::<f64>().ok().filter(|v| v.is_finite());
                if let Some(o) = &mut self.overlay {
                    match el {
                        E::North => o.north = v,
                        E::South => o.south = v,
                        E::East => o.east = v,
                        E::West => o.west = v,
                        _ => o.rotation = v.unwrap_or(0.0),
                    }
                }
            }
            E::Value if parent == Some(E::Data) => {
                if let Some(pm) = &mut self.pm {
                    if !self.data_name.is_empty() {
                        pm.attrs.push((self.data_name.clone(), t.to_string()));
                    }
                }
            }
            E::SimpleData => {
                if let Some(pm) = &mut self.pm {
                    if !self.simple_name.is_empty() {
                        pm.attrs.push((self.simple_name.clone(), t.to_string()));
                    }
                }
            }
            E::Point | E::LineString | E::LinearRing | E::Polygon => self.finish_geometry(el),
            E::Style => {
                if let Some(ctx) = self.style.take() {
                    match ctx.target {
                        StyleTarget::Placemark => {
                            if let Some(pm) = &mut self.pm {
                                pm.style = Some(StyleRef::Inline(ctx.def));
                            }
                        }
                        StyleTarget::Pair => self.pair_ref = Some(StyleRef::Inline(ctx.def)),
                        StyleTarget::Shared(id) => {
                            self.b.style_defs.insert(id, ctx.def);
                        }
                        StyleTarget::Discard => {}
                    }
                }
            }
            E::Pair => {
                let r = self.pair_ref.take();
                if let Some((_, def)) = &mut self.smap {
                    match self.pair_key.as_str() {
                        "normal" => def.normal = r,
                        "highlight" => def.highlight = r,
                        _ => {}
                    }
                }
            }
            E::StyleMap => {
                if let Some((id, def)) = self.smap.take() {
                    match id {
                        Some(id) => {
                            self.b.style_maps.insert(id, def);
                        }
                        None => {
                            if let Some(pm) = &mut self.pm {
                                pm.style = def.normal;
                            }
                        }
                    }
                }
            }
            E::GroundOverlay => self.finish_overlay(),
            E::Placemark => self.finish_placemark(),
            _ => {}
        }
    }

    fn with_style(&mut self, f: impl FnOnce(&mut StyleDef)) {
        if let Some(ctx) = &mut self.style {
            f(&mut ctx.def);
        }
    }

    fn finish_geometry(&mut self, el: E) {
        let Some(frame) = self.geoms.pop() else {
            return;
        };
        let flags = frame.flags();
        let in_outer = self.stack.last() == Some(&E::Outer);
        let in_inner = self.stack.last() == Some(&E::Inner);
        match el {
            E::Point => {
                if frame.coords.len() >= 3 {
                    if let Some(pm) = &mut self.pm {
                        pm.add(GEOM_POINT, &frame.coords[..3], flags);
                    }
                } else {
                    self.b.warn(
                        "Empty geometry",
                        "Geometries without a valid coordinate were dropped",
                    );
                }
            }
            E::LineString => {
                if frame.coords.len() >= 6 {
                    if let Some(pm) = &mut self.pm {
                        pm.add(GEOM_LINE, &frame.coords, flags);
                    }
                } else {
                    self.b.warn(
                        "Empty geometry",
                        "Geometries without a valid coordinate were dropped",
                    );
                }
            }
            E::LinearRing => {
                if let Some(poly) = self.geoms.last_mut().filter(|f| f.kind == E::Polygon) {
                    if in_inner {
                        poly.inners.push(frame.coords);
                    } else if in_outer && poly.outer.is_none() {
                        poly.outer = Some(frame.coords);
                    }
                } else if frame.coords.len() >= 6 {
                    if let Some(pm) = &mut self.pm {
                        pm.add(GEOM_LINE, &frame.coords, flags);
                    }
                }
            }
            E::Polygon => match frame.outer {
                Some(outer) if outer.len() >= 9 => {
                    if let Some(pm) = &mut self.pm {
                        pm.add(GEOM_POLY_OUTER, &outer, flags);
                        for hole in frame.inners.iter().filter(|h| h.len() >= 9) {
                            pm.add(GEOM_POLY_HOLE, hole, flags);
                        }
                    }
                }
                _ => self.b.warn(
                    "Empty geometry",
                    "Geometries without a valid coordinate were dropped",
                ),
            },
            _ => {}
        }
    }

    fn finish_placemark(&mut self) {
        let Some(pm) = self.pm.take() else { return };
        self.b
            .begin_feature(pm.name, pm.description, pm.visible, pm.style);
        for p in &pm.parts {
            self.b.add_part(p.ty, &pm.coords[p.start..p.end], p.flags);
        }
        for (k, v) in pm.attrs {
            self.b.add_attr(&k, v);
        }
        self.b.end_feature();
    }

    fn finish_overlay(&mut self) {
        let Some(o) = self.overlay.take() else { return };
        match (o.north, o.south, o.east, o.west) {
            (Some(north), Some(south), Some(east), Some(west)) if !o.href.is_empty() => {
                if o.remote {
                    self.b.warn(
                        "Remote overlay image",
                        "GroundOverlay images hosted online are not downloaded (offline-first)",
                    );
                    return;
                }
                let folder = self.b.current_folder();
                self.b.add_overlay(Overlay {
                    name: o.name,
                    href: o.href,
                    north,
                    south,
                    east,
                    west,
                    rotation: o.rotation,
                    color: o.color.unwrap_or_else(|| WHITE.to_string()),
                    visible: o.visible,
                    folder,
                });
            }
            _ => self.b.warn(
                "Malformed GroundOverlay",
                "GroundOverlay without an image or a complete LatLonBox was dropped",
            ),
        }
    }
}

/// Parses KML from `reader` into `b`. On an XML error returns the byte position and message;
/// everything parsed before the error stays in the builder so callers can keep partial results.
pub fn parse_kml<R: BufRead>(reader: R, b: &mut LayerBuilder) -> Result<(), (Loc, String)> {
    let mut xr = Reader::from_reader(reader);
    let mut p = Parser::new(b);
    let mut buf = Vec::new();
    loop {
        match xr.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let ln = e.local_name();
                p.start(AsRef::<str>::as_ref(&ln), &e);
            }
            Ok(Event::Empty(e)) => {
                let ln = e.local_name();
                p.start(AsRef::<str>::as_ref(&ln), &e);
                p.end();
            }
            Ok(Event::End(_)) => p.end(),
            Ok(Event::Text(t)) => p.text(&t.xml10_content()),
            Ok(Event::CData(c)) => p.text(&c.xml10_content()),
            Ok(Event::GeneralRef(r)) => p.entity(&r),
            Ok(Event::Eof) => {
                if p.stack.is_empty() && p.skip == 0 {
                    return Ok(());
                }
                return Err((
                    Loc::Byte(xr.buffer_position()),
                    "unexpected end of file (the file looks truncated)".into(),
                ));
            }
            Ok(_) => {}
            Err(e) => return Err((Loc::Byte(xr.buffer_position()), e.to_string())),
        }
        buf.clear();
    }
}

#[cfg(test)]
mod tests;
