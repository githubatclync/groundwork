// Attribute table engine. Sorting, filtering, and paging all happen here so the UI never holds
// hundreds of thousands of rows as JS objects. A "view" is the list of feature ids that match a
// `ViewSpec` in sorted order; the most recent view is cached on the layer so scrolling (paging)
// and "find this feature's row" are cheap.
use std::cmp::Ordering;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::geo::{path_length_m, ring_area_m2};
use crate::layer::{ColumnType, LayerData, GEOM_LINE, GEOM_POINT, GEOM_POLY_HOLE, GEOM_POLY_OUTER};

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ViewSpec {
    pub sort: Option<SortSpec>,
    /// Case-insensitive text that must appear in the name or any attribute.
    pub global: Option<String>,
    pub filters: Vec<ColumnFilter>,
    /// Only features whose bounding box intersects (west, south, east, north).
    pub bounds: Option<[f64; 4]>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SortSpec {
    /// "name" or an attribute column name.
    pub column: String,
    pub desc: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FilterOp {
    Contains,
    Eq,
    Gt,
    Lt,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnFilter {
    pub column: String,
    pub op: FilterOp,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttrRow {
    pub feature_id: u32,
    /// The name followed by one cell per attribute column, in manifest order.
    pub cells: Vec<Option<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttributePage {
    /// Number of rows in the whole (filtered) view.
    pub total: usize,
    pub rows: Vec<AttrRow>,
}

/// A column reference: the feature name, or an index into the layer's attribute columns.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Col {
    Name,
    Attr(u16),
}

fn resolve(l: &LayerData, name: &str) -> Option<Col> {
    if name == "name" {
        return Some(Col::Name);
    }
    l.columns
        .iter()
        .position(|c| c.name == name)
        .map(|i| Col::Attr(i as u16))
}

fn is_numeric(l: &LayerData, c: Col) -> bool {
    matches!(c, Col::Attr(i) if l.columns[i as usize].ty == ColumnType::Number)
}

fn cell(l: &LayerData, feature: u32, c: Col) -> Option<&str> {
    let f = &l.features[feature as usize];
    match c {
        Col::Name => Some(f.name.as_str()),
        Col::Attr(i) => f.attrs.iter().find(|(c, _)| *c == i).map(|(_, v)| &**v),
    }
}

/// Case-insensitive substring test without allocating for the common ASCII case.
fn contains_ci(hay: &str, needle_lower: &str) -> bool {
    if needle_lower.is_empty() {
        return true;
    }
    if hay.is_ascii() && needle_lower.is_ascii() {
        let (h, n) = (hay.as_bytes(), needle_lower.as_bytes());
        return h.len() >= n.len() && h.windows(n.len()).any(|w| w.eq_ignore_ascii_case(n));
    }
    hay.to_lowercase().contains(needle_lower)
}

fn matches_filter(
    l: &LayerData,
    feature: u32,
    col: Col,
    numeric: bool,
    f: &ColumnFilter,
    value_lc: &str,
    value_num: Option<f64>,
) -> bool {
    let Some(text) = cell(l, feature, col) else {
        return false;
    };
    match f.op {
        FilterOp::Contains => contains_ci(text, value_lc),
        FilterOp::Eq => match (numeric, value_num, text.trim().parse::<f64>().ok()) {
            (true, Some(v), Some(x)) => x == v,
            _ => text.to_lowercase() == value_lc,
        },
        FilterOp::Gt | FilterOp::Lt => {
            let (Some(v), Some(x)) = (value_num, text.trim().parse::<f64>().ok()) else {
                return false;
            };
            if f.op == FilterOp::Gt {
                x > v
            } else {
                x < v
            }
        }
    }
}

fn intersects(b: &[f64; 4], view: &[f64; 4]) -> bool {
    if b[0].is_nan() {
        return false;
    }
    // A view that wraps the antimeridian arrives as west > east; treat it as the whole globe in longitude.
    let lon_ok = view[0] > view[2] || (b[2] >= view[0] && b[0] <= view[2]);
    lon_ok && b[3] >= view[1] && b[1] <= view[3]
}

/// Builds the sorted, filtered list of feature ids for a spec.
pub fn build_view(l: &LayerData, spec: &ViewSpec) -> Vec<u32> {
    let global = spec
        .global
        .as_deref()
        .map(str::trim)
        .filter(|g| !g.is_empty())
        .map(str::to_lowercase);
    let filters: Vec<(Col, bool, &ColumnFilter, String, Option<f64>)> = spec
        .filters
        .iter()
        .filter(|f| !f.value.trim().is_empty())
        .filter_map(|f| {
            let col = resolve(l, &f.column)?;
            Some((
                col,
                is_numeric(l, col),
                f,
                f.value.trim().to_lowercase(),
                f.value.trim().parse::<f64>().ok(),
            ))
        })
        .collect();

    let mut ids: Vec<u32> = (0..l.features.len() as u32)
        .filter(|&id| {
            if let Some(b) = &spec.bounds {
                if !intersects(&l.feature_bounds[id as usize], b) {
                    return false;
                }
            }
            if let Some(g) = &global {
                let f = &l.features[id as usize];
                if !contains_ci(&f.name, g) && !f.attrs.iter().any(|(_, v)| contains_ci(v, g)) {
                    return false;
                }
            }
            filters.iter().all(|(col, numeric, f, lc, num)| {
                matches_filter(l, id, *col, *numeric, f, lc, *num)
            })
        })
        .collect();

    if let Some(sort) = &spec.sort {
        if let Some(col) = resolve(l, &sort.column) {
            sort_ids(l, &mut ids, col, sort.desc);
        }
    }
    ids
}

fn sort_ids(l: &LayerData, ids: &mut [u32], col: Col, desc: bool) {
    // Missing values always sort last, whichever direction is chosen.
    if is_numeric(l, col) {
        let mut keys: Vec<(Option<f64>, u32)> = ids
            .iter()
            .map(|&id| {
                (
                    cell(l, id, col).and_then(|t| t.trim().parse::<f64>().ok()),
                    id,
                )
            })
            .collect();
        keys.sort_by(|a, b| match (a.0, b.0) {
            (Some(x), Some(y)) => {
                let o = x.partial_cmp(&y).unwrap_or(Ordering::Equal);
                (if desc { o.reverse() } else { o }).then(a.1.cmp(&b.1))
            }
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => a.1.cmp(&b.1),
        });
        for (slot, (_, id)) in ids.iter_mut().zip(keys) {
            *slot = id;
        }
    } else {
        let mut keys: Vec<(Option<String>, u32)> = ids
            .iter()
            .map(|&id| {
                (
                    cell(l, id, col)
                        .filter(|t| !t.is_empty())
                        .map(str::to_lowercase),
                    id,
                )
            })
            .collect();
        keys.sort_by(|a, b| match (&a.0, &b.0) {
            (Some(x), Some(y)) => {
                let o = x.cmp(y);
                (if desc { o.reverse() } else { o }).then(a.1.cmp(&b.1))
            }
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => a.1.cmp(&b.1),
        });
        for (slot, (_, id)) in ids.iter_mut().zip(keys) {
            *slot = id;
        }
    }
}

/// Returns the cached view for a spec, building (and caching) it when needed.
pub fn view_for(l: &LayerData, spec: &ViewSpec) -> Arc<Vec<u32>> {
    let key = serde_json::to_string(spec).unwrap_or_default();
    if let Ok(cache) = l.view_cache.lock() {
        if let Some((k, v)) = cache.as_ref() {
            if *k == key {
                return v.clone();
            }
        }
    }
    let view = Arc::new(build_view(l, spec));
    if let Ok(mut cache) = l.view_cache.lock() {
        *cache = Some((key, view.clone()));
    }
    view
}

pub fn page(l: &LayerData, view: &[u32], offset: usize, limit: usize) -> AttributePage {
    let rows = view
        .iter()
        .skip(offset)
        .take(limit)
        .map(|&id| {
            let f = &l.features[id as usize];
            let mut cells: Vec<Option<String>> = vec![None; l.columns.len() + 1];
            cells[0] = Some(f.name.clone());
            for (c, v) in &f.attrs {
                cells[*c as usize + 1] = Some(v.to_string());
            }
            AttrRow {
                feature_id: id,
                cells,
            }
        })
        .collect();
    AttributePage {
        total: view.len(),
        rows,
    }
}

/// Position of a feature in a view, if it is present.
pub fn row_of(view: &[u32], feature: u32) -> Option<usize> {
    view.iter().position(|&f| f == feature)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometrySummary {
    pub kind: String,
    pub vertex_count: usize,
    pub point_count: usize,
    pub line_count: usize,
    pub polygon_count: usize,
    pub hole_count: usize,
    /// Length of all line parts, meters.
    pub length_m: Option<f64>,
    /// Perimeter of polygon outer rings, meters.
    pub perimeter_m: Option<f64>,
    /// Area of polygons (outer minus holes), square meters.
    pub area_m2: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureDetail {
    pub id: u32,
    pub name: String,
    pub description: Option<String>,
    pub visible: bool,
    pub folder: u32,
    pub attrs: Vec<(String, String)>,
    pub geometry: GeometrySummary,
    pub bounds: Option<[f64; 4]>,
}

pub fn feature_detail(l: &LayerData, id: u32) -> Option<FeatureDetail> {
    let f = l.features.get(id as usize)?;
    let (mut points, mut lines, mut polys, mut holes, mut verts) = (0, 0, 0, 0, 0);
    let (mut length, mut perimeter, mut area) = (0.0, 0.0, 0.0);
    for p in l.parts_of(id) {
        let c = l.part_coords(p);
        verts += c.len() / 3;
        match l.part_type[p] {
            GEOM_POINT => points += 1,
            GEOM_LINE => {
                lines += 1;
                length += path_length_m(c);
            }
            GEOM_POLY_OUTER => {
                polys += 1;
                perimeter += path_length_m(c);
                area += ring_area_m2(c);
            }
            GEOM_POLY_HOLE => {
                holes += 1;
                area -= ring_area_m2(c);
            }
            _ => {}
        }
    }
    let kind = match (points, lines, polys) {
        (0, 0, 0) => "None",
        (1, 0, 0) => "Point",
        (_, 0, 0) => "MultiPoint",
        (0, 1, 0) => "LineString",
        (0, _, 0) => "MultiLineString",
        (0, 0, 1) => "Polygon",
        (0, 0, _) => "MultiPolygon",
        _ => "MultiGeometry",
    };
    let b = l.feature_bounds[id as usize];
    Some(FeatureDetail {
        id,
        name: f.name.clone(),
        description: f.description.clone(),
        visible: f.visible,
        folder: f.folder,
        attrs: f
            .attrs
            .iter()
            .map(|(c, v)| (l.columns[*c as usize].name.clone(), v.to_string()))
            .collect(),
        geometry: GeometrySummary {
            kind: kind.into(),
            vertex_count: verts,
            point_count: points,
            line_count: lines,
            polygon_count: polys,
            hole_count: holes,
            length_m: (lines > 0).then_some(length),
            perimeter_m: (polys > 0).then_some(perimeter),
            area_m2: (polys > 0).then_some(area.max(0.0)),
        },
        bounds: (!b[0].is_nan()).then_some(b),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::parse_kml_str;

    fn layer() -> LayerData {
        parse_kml_str(
            r#"<kml><Document>
          <Placemark><name>Alpha</name><ExtendedData><Data name="pop"><value>30</value></Data><Data name="kind"><value>Park</value></Data></ExtendedData><Point><coordinates>10,10</coordinates></Point></Placemark>
          <Placemark><name>beta</name><ExtendedData><Data name="pop"><value>4</value></Data><Data name="kind"><value>School</value></Data></ExtendedData><Point><coordinates>20,20</coordinates></Point></Placemark>
          <Placemark><name>Gamma</name><ExtendedData><Data name="pop"><value>100</value></Data></ExtendedData><Point><coordinates>-30,-30</coordinates></Point></Placemark>
          <Placemark><name>Delta</name><ExtendedData><Data name="kind"><value>park lot</value></Data></ExtendedData></Placemark>
        </Document></kml>"#,
        )
        .unwrap()
    }

    fn names(l: &LayerData, ids: &[u32]) -> Vec<String> {
        ids.iter()
            .map(|&i| l.features[i as usize].name.clone())
            .collect()
    }

    #[test]
    fn sorts_numbers_numerically_with_missing_last() {
        let l = layer();
        let asc = build_view(
            &l,
            &ViewSpec {
                sort: Some(SortSpec {
                    column: "pop".into(),
                    desc: false,
                }),
                ..Default::default()
            },
        );
        assert_eq!(names(&l, &asc), ["beta", "Alpha", "Gamma", "Delta"]); // 4, 30, 100, missing
        let desc = build_view(
            &l,
            &ViewSpec {
                sort: Some(SortSpec {
                    column: "pop".into(),
                    desc: true,
                }),
                ..Default::default()
            },
        );
        assert_eq!(names(&l, &desc), ["Gamma", "Alpha", "beta", "Delta"]); // missing still last
    }

    #[test]
    fn sorts_text_case_insensitively() {
        let l = layer();
        let v = build_view(
            &l,
            &ViewSpec {
                sort: Some(SortSpec {
                    column: "name".into(),
                    desc: false,
                }),
                ..Default::default()
            },
        );
        assert_eq!(names(&l, &v), ["Alpha", "beta", "Delta", "Gamma"]);
    }

    #[test]
    fn global_filter_matches_name_or_any_attribute() {
        let l = layer();
        let v = build_view(
            &l,
            &ViewSpec {
                global: Some("PARK".into()),
                ..Default::default()
            },
        );
        assert_eq!(names(&l, &v), ["Alpha", "Delta"]);
        let v = build_view(
            &l,
            &ViewSpec {
                global: Some("gam".into()),
                ..Default::default()
            },
        );
        assert_eq!(names(&l, &v), ["Gamma"]);
    }

    #[test]
    fn column_filters_support_contains_eq_gt_lt() {
        let l = layer();
        let f = |column: &str, op, value: &str| ViewSpec {
            filters: vec![ColumnFilter {
                column: column.into(),
                op,
                value: value.into(),
            }],
            ..Default::default()
        };
        assert_eq!(
            names(&l, &build_view(&l, &f("kind", FilterOp::Contains, "park"))),
            ["Alpha", "Delta"]
        );
        assert_eq!(
            names(&l, &build_view(&l, &f("kind", FilterOp::Eq, "PARK"))),
            ["Alpha"]
        );
        assert_eq!(
            names(&l, &build_view(&l, &f("pop", FilterOp::Gt, "10"))),
            ["Alpha", "Gamma"]
        );
        assert_eq!(
            names(&l, &build_view(&l, &f("pop", FilterOp::Lt, "30"))),
            ["beta"]
        );
        assert_eq!(
            names(&l, &build_view(&l, &f("pop", FilterOp::Eq, "30.0"))),
            ["Alpha"]
        );
        assert!(build_view(&l, &f("pop", FilterOp::Gt, "abc")).is_empty());
        // An unknown column or an empty value is ignored rather than excluding everything.
        assert_eq!(build_view(&l, &f("nope", FilterOp::Eq, "x")).len(), 4);
        assert_eq!(build_view(&l, &f("pop", FilterOp::Eq, " ")).len(), 4);
    }

    #[test]
    fn bounds_filter_keeps_features_in_view() {
        let l = layer();
        let v = build_view(
            &l,
            &ViewSpec {
                bounds: Some([0.0, 0.0, 25.0, 25.0]),
                ..Default::default()
            },
        );
        assert_eq!(names(&l, &v), ["Alpha", "beta"]); // Delta has no geometry
        let wrap = build_view(
            &l,
            &ViewSpec {
                bounds: Some([170.0, -90.0, -170.0, 90.0]),
                ..Default::default()
            },
        );
        assert_eq!(
            wrap.len(),
            3,
            "a view wrapping the antimeridian is treated as all longitudes"
        );
    }

    #[test]
    fn pages_rows_with_name_first_and_total() {
        let l = layer();
        let view = build_view(&l, &ViewSpec::default());
        let p = page(&l, &view, 1, 2);
        assert_eq!(p.total, 4);
        assert_eq!(p.rows.len(), 2);
        assert_eq!(p.rows[0].feature_id, 1);
        assert_eq!(p.rows[0].cells[0].as_deref(), Some("beta"));
        let pop = l.columns.iter().position(|c| c.name == "pop").unwrap() + 1;
        assert_eq!(p.rows[0].cells[pop].as_deref(), Some("4"));
        assert_eq!(page(&l, &view, 10, 5).rows.len(), 0);
    }

    #[test]
    fn view_cache_is_reused_and_replaced() {
        let l = layer();
        let a = view_for(&l, &ViewSpec::default());
        let b = view_for(&l, &ViewSpec::default());
        assert!(Arc::ptr_eq(&a, &b));
        let c = view_for(
            &l,
            &ViewSpec {
                global: Some("a".into()),
                ..Default::default()
            },
        );
        assert!(!Arc::ptr_eq(&a, &c));
        assert_eq!(row_of(&a, 2), Some(2));
        assert_eq!(row_of(&c, 99), None);
    }

    #[test]
    fn feature_detail_summarizes_geometry() {
        let l = parse_kml_str(
            r#"<kml><Placemark><name>P</name><description>d</description><Polygon>
            <outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,1 0,0</coordinates></LinearRing></outerBoundaryIs>
            <innerBoundaryIs><LinearRing><coordinates>0.25,0.25 0.75,0.25 0.75,0.75 0.25,0.75 0.25,0.25</coordinates></LinearRing></innerBoundaryIs>
            </Polygon></Placemark>
            <Placemark><name>L</name><LineString><coordinates>0,0 0,1</coordinates></LineString></Placemark></kml>"#,
        )
        .unwrap();
        let d = feature_detail(&l, 0).unwrap();
        assert_eq!(d.geometry.kind, "Polygon");
        assert_eq!(
            (
                d.geometry.polygon_count,
                d.geometry.hole_count,
                d.geometry.vertex_count
            ),
            (1, 1, 10)
        );
        let area = d.geometry.area_m2.unwrap() / 1e6;
        assert!((area - 12_364.0 * 0.75).abs() < 100.0, "{area}"); // 1 deg square minus a quarter-size hole
        assert_eq!(d.bounds, Some([0.0, 0.0, 1.0, 1.0]));
        let d = feature_detail(&l, 1).unwrap();
        assert_eq!(d.geometry.kind, "LineString");
        assert!((d.geometry.length_m.unwrap() - 111_195.0).abs() < 200.0);
        assert!(feature_detail(&l, 9).is_none());
    }
}
