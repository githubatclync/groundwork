// GeoJSON importer. The top-level object is walked with serde's streaming visitor so a huge
// FeatureCollection is processed one feature at a time rather than loaded as one document.
// Properties become attributes; `name`/`title` and `description` feed the feature name/description.
use std::fmt;
use std::io::Read;

use serde::de::{DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::Value;

use crate::layer::{LayerBuilder, Loc, GEOM_LINE, GEOM_POINT, GEOM_POLY_HOLE, GEOM_POLY_OUTER};

pub fn parse_geojson<R: Read>(reader: R, b: &mut LayerBuilder) -> Result<(), (Loc, String)> {
    let mut de = serde_json::Deserializer::from_reader(reader);
    TopSeed { b }
        .deserialize(&mut de)
        .map_err(|e| (Loc::Line(e.line() as u64), e.to_string()))?;
    // Reject trailing garbage so truncated or concatenated files are noticed.
    de.end()
        .map_err(|e| (Loc::Line(e.line() as u64), e.to_string()))
}

struct TopSeed<'a> {
    b: &'a mut LayerBuilder,
}

impl<'de, 'a> DeserializeSeed<'de> for TopSeed<'a> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<(), D::Error> {
        d.deserialize_map(TopVisitor { b: self.b })
    }
}

struct TopVisitor<'a> {
    b: &'a mut LayerBuilder,
}

impl<'de, 'a> Visitor<'de> for TopVisitor<'a> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "a GeoJSON object")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        let mut rest = serde_json::Map::new();
        let mut saw_features = false;
        while let Some(key) = map.next_key::<String>()? {
            if key == "features" {
                saw_features = true;
                map.next_value_seed(FeaturesSeed { b: &mut *self.b })?;
            } else {
                rest.insert(key, map.next_value::<Value>()?);
            }
        }
        if !saw_features {
            handle_object(self.b, &Value::Object(rest));
        }
        Ok(())
    }
}

struct FeaturesSeed<'a> {
    b: &'a mut LayerBuilder,
}

impl<'de, 'a> DeserializeSeed<'de> for FeaturesSeed<'a> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<(), D::Error> {
        d.deserialize_seq(self)
    }
}

impl<'de, 'a> Visitor<'de> for FeaturesSeed<'a> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "an array of features")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        while let Some(v) = seq.next_element::<Value>()? {
            handle_object(self.b, &v);
        }
        Ok(())
    }
}

fn handle_object(b: &mut LayerBuilder, v: &Value) {
    match v.get("type").and_then(Value::as_str) {
        Some("Feature") => feature(b, v),
        Some("FeatureCollection") => {
            if let Some(items) = v.get("features").and_then(Value::as_array) {
                items.iter().for_each(|f| handle_object(b, f));
            }
        }
        Some(_) => {
            // A bare geometry becomes a feature with no properties.
            b.begin_feature(String::new(), None, true, None);
            geometry(b, v, 0);
            b.end_feature();
        }
        None => b.warn(
            "Unrecognized object",
            "JSON objects without a GeoJSON \"type\" were skipped",
        ),
    }
}

fn value_text(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        Value::Bool(x) => Some(x.to_string()),
        Value::Number(n) => Some(n.to_string()),
        other => Some(other.to_string()),
    }
}

fn feature(b: &mut LayerBuilder, v: &Value) {
    let props = v.get("properties").and_then(Value::as_object);
    let pick = |keys: &[&str]| {
        props.and_then(|p| {
            keys.iter()
                .find_map(|k| p.get(*k))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
    };
    let name = pick(&["name", "Name", "NAME", "title"]).unwrap_or_default();
    let description = pick(&["description", "Description"]);
    b.begin_feature(name, description, true, None);
    if let Some(g) = v.get("geometry") {
        geometry(b, g, 0);
    }
    if let Some(p) = props {
        for (k, val) in p {
            if let Some(text) = value_text(val) {
                b.add_attr(k, text);
            }
        }
    }
    b.end_feature();
}

/// Reads a GeoJSON position; returns None (and counts it) when it is malformed.
fn position(b: &mut LayerBuilder, v: &Value) -> Option<[f64; 3]> {
    let p = v.as_array().and_then(|a| {
        let lon = a.first()?.as_f64()?;
        let lat = a.get(1)?.as_f64()?;
        let alt = a.get(2).and_then(Value::as_f64).unwrap_or(0.0);
        ((-90.0..=90.0).contains(&lat) && (-360.0..=360.0).contains(&lon) && alt.is_finite())
            .then_some([
                if lon > 180.0 {
                    lon - 360.0
                } else if lon < -180.0 {
                    lon + 360.0
                } else {
                    lon
                },
                lat,
                alt,
            ])
    });
    if p.is_none() {
        b.warn(
            "Malformed coordinates",
            "Coordinate tuples that could not be parsed were dropped",
        );
    }
    p
}

fn line_coords(b: &mut LayerBuilder, v: &Value) -> Vec<f64> {
    let mut out = Vec::new();
    for p in v.as_array().map(Vec::as_slice).unwrap_or(&[]) {
        if let Some(c) = position(b, p) {
            out.extend_from_slice(&c);
        }
    }
    out
}

fn polygon(b: &mut LayerBuilder, rings: &Value) {
    let mut first = true;
    for ring in rings.as_array().map(Vec::as_slice).unwrap_or(&[]) {
        let c = line_coords(b, ring);
        if c.len() < 9 {
            if first {
                b.warn(
                    "Empty geometry",
                    "Geometries without a valid coordinate were dropped",
                );
                return; // no valid outer ring: drop the polygon and its holes
            }
            continue;
        }
        b.add_part(
            if first {
                GEOM_POLY_OUTER
            } else {
                GEOM_POLY_HOLE
            },
            &c,
            0,
        );
        first = false;
    }
}

fn geometry(b: &mut LayerBuilder, g: &Value, depth: u8) {
    let coords = g.get("coordinates");
    match g.get("type").and_then(Value::as_str) {
        Some("Point") => {
            if let Some(c) = coords.and_then(|c| position(b, c)) {
                b.add_part(GEOM_POINT, &c, 0);
            }
        }
        Some("MultiPoint") => {
            for p in coords
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[])
            {
                if let Some(c) = position(b, p) {
                    b.add_part(GEOM_POINT, &c, 0);
                }
            }
        }
        Some("LineString") => {
            let c = coords.map(|c| line_coords(b, c)).unwrap_or_default();
            if c.len() >= 6 {
                b.add_part(GEOM_LINE, &c, 0);
            }
        }
        Some("MultiLineString") => {
            for l in coords
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[])
            {
                let c = line_coords(b, l);
                if c.len() >= 6 {
                    b.add_part(GEOM_LINE, &c, 0);
                }
            }
        }
        Some("Polygon") => {
            if let Some(c) = coords {
                polygon(b, c);
            }
        }
        Some("MultiPolygon") => {
            for p in coords
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[])
            {
                polygon(b, p);
            }
        }
        Some("GeometryCollection") if depth < 8 => {
            for g in g
                .get("geometries")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[])
            {
                geometry(b, g, depth + 1);
            }
        }
        Some(other) => b.warn(other, "Unsupported geometry type skipped"),
        None => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layer::Resources;

    fn load(text: &str) -> crate::layer::LayerData {
        let mut b = LayerBuilder::new("t");
        parse_geojson(text.as_bytes(), &mut b).unwrap();
        b.finish("t.geojson", "geojson", Resources::None)
    }

    #[test]
    fn imports_all_geometry_types_and_properties() {
        let l = load(
            r#"{"type":"FeatureCollection","features":[
              {"type":"Feature","properties":{"name":"A","pop":5,"ok":true},"geometry":{"type":"Point","coordinates":[1,2,3]}},
              {"type":"Feature","properties":{},"geometry":{"type":"MultiPoint","coordinates":[[0,0],[1,1]]}},
              {"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]}},
              {"type":"Feature","properties":{},"geometry":{"type":"MultiLineString","coordinates":[[[0,0],[1,1]],[[2,2],[3,3]]]}},
              {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[0,0],[4,0],[4,4],[0,0]],[[1,1],[2,1],[2,2],[1,1]]]}},
              {"type":"Feature","properties":{},"geometry":{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[1,1],[0,0]]]]}},
              {"type":"Feature","properties":{},"geometry":{"type":"GeometryCollection","geometries":[{"type":"Point","coordinates":[5,5]}]}}
            ]}"#,
        );
        assert_eq!(l.features.len(), 7);
        assert_eq!(l.features[0].name, "A");
        assert_eq!(l.part_type, vec![1, 1, 1, 2, 2, 2, 3, 4, 3, 1]);
        assert_eq!(l.coords[..3], [1.0, 2.0, 3.0]);
        let pop = l.columns.iter().find(|c| c.name == "pop").unwrap();
        assert_eq!(pop.ty, crate::layer::ColumnType::Number);
        assert!(l
            .columns
            .iter()
            .any(|c| c.name == "ok" && c.ty == crate::layer::ColumnType::Bool));
    }

    #[test]
    fn handles_bare_feature_and_bad_positions() {
        let l = load(
            r#"{"type":"Feature","properties":{"name":"X"},"geometry":{"type":"LineString","coordinates":[[0,0],["a",1],[1,1],[999,0]]}}"#,
        );
        assert_eq!(l.features.len(), 1);
        assert_eq!(l.vertex_count(), 2);
        assert_eq!(l.warnings[0].count, 2);
    }

    #[test]
    fn reports_syntax_errors_with_line() {
        let mut b = LayerBuilder::new("t");
        let err = parse_geojson("{\n\"type\": \n}".as_bytes(), &mut b).unwrap_err();
        assert!(matches!(err.0, Loc::Line(3)));
    }
}
