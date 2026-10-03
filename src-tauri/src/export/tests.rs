// Export tests: round trips through the importer, KML 2.2 element-order checks, GeoJSON, and
// conversion between user-drawn features and layers.
use std::path::{Path, PathBuf};

use quick_xml::events::Event;
use quick_xml::Reader;

use super::*;
use crate::import::import_path;

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("groundwork-export-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

fn style(color: &str, width: f32, fill: f32, icon: Option<&str>) -> UserStyleDto {
    UserStyleDto {
        color: color.into(),
        width,
        fill_opacity: fill,
        icon: icon.map(str::to_string),
        scale: 1.3,
    }
}

fn sample_features() -> Vec<UserFeatureDto> {
    vec![
        UserFeatureDto {
            name: "Home & garden <1>".into(),
            description: "Line one\nHas ]]> and <b>html</b> & stuff".into(),
            kind: "point".into(),
            coords: vec![[-122.4, 37.8]],
            holes: vec![],
            attrs: vec![
                ("owner".into(), "Ann & Bob".into()),
                ("units".into(), "12".into()),
            ],
            style: style("#ff0000", 2.0, 0.25, Some("star")),
            visible: true,
        },
        UserFeatureDto {
            name: "Trail".into(),
            description: String::new(),
            kind: "line".into(),
            coords: vec![[-122.5, 37.7], [-122.45, 37.72], [-122.4, 37.7]],
            holes: vec![],
            attrs: vec![],
            style: style("#0000ff", 4.0, 0.25, None),
            visible: true,
        },
        UserFeatureDto {
            name: "Lot".into(),
            description: "with a hole".into(),
            kind: "polygon".into(),
            coords: vec![
                [-122.5, 37.6],
                [-122.4, 37.6],
                [-122.4, 37.5],
                [-122.5, 37.5],
            ],
            holes: vec![vec![[-122.47, 37.57], [-122.43, 37.57], [-122.43, 37.53]]],
            attrs: vec![("parcel".into(), "007".into())],
            style: style("#00ff00", 3.0, 0.5, None),
            visible: false,
        },
    ]
}

fn feature_names(l: &LayerData) -> Vec<String> {
    l.features.iter().map(|f| f.name.clone()).collect()
}

fn attr(l: &LayerData, feature: usize, name: &str) -> Option<String> {
    let col = l.columns.iter().position(|c| c.name == name)? as u16;
    l.features[feature]
        .attrs
        .iter()
        .find(|(c, _)| *c == col)
        .map(|(_, v)| v.to_string())
}

#[test]
fn user_layer_round_trips_through_kmz() {
    let layer = user_features_to_layer("My Places", &sample_features());
    let path = temp("places.kmz");
    let report = export_layer(&layer, &path).unwrap();
    assert_eq!(report.features, 3);
    assert!(report.notes.is_empty(), "{:?}", report.notes);

    let back = import_path(path.to_str().unwrap()).unwrap();
    assert_eq!(back.format, "kmz");
    assert_eq!(back.name, "My Places");
    assert_eq!(feature_names(&back), ["Home & garden <1>", "Trail", "Lot"]);
    assert_eq!(
        back.features[0].description.as_deref(),
        Some("Line one\nHas ]]> and <b>html</b> & stuff")
    );
    assert_eq!(back.features[1].description, None);
    assert_eq!(attr(&back, 0, "owner").as_deref(), Some("Ann & Bob"));
    assert_eq!(attr(&back, 2, "parcel").as_deref(), Some("007"));

    // Geometry: point, line, polygon ring closed + one hole (also closed).
    assert_eq!(
        back.part_type,
        vec![GEOM_POINT, GEOM_LINE, GEOM_POLY_OUTER, GEOM_POLY_HOLE]
    );
    assert_eq!(back.part_coords(0), &[-122.4, 37.8, 0.0]);
    assert_eq!(back.part_coords(1).len(), 9);
    assert_eq!(back.part_coords(2).len(), 15); // 4 vertices + closing vertex
    assert_eq!(back.part_coords(3).len(), 12); // 3 vertices + closing vertex
    assert!(!back.features[2].visible);

    // Styles survive: colors (KML byte order!), widths, fill, and the bundled built-in icon.
    let s = |i: usize| &back.styles[back.feature_style[i] as usize];
    assert_eq!(s(0).icon.as_ref().unwrap().color, "ff0000ff");
    assert_eq!(s(0).icon.as_ref().unwrap().href, "files/star.png");
    assert_eq!(s(0).icon.as_ref().unwrap().scale, 1.3);
    assert_eq!(
        (s(1).line.color.as_str(), s(1).line.width),
        ("0000ffff", 4.0)
    );
    assert_eq!(s(2).poly.color, "00ff0080");
    assert!(s(2).poly.fill);
    // The icon file is inside the archive and identical to the built-in one.
    assert_eq!(
        back.resources.read("files/star.png").as_deref(),
        builtin_icon_bytes("files/star.png")
    );
}

#[test]
fn kml_export_drops_local_icons_with_a_note() {
    let layer = user_features_to_layer("Places", &sample_features());
    let path = temp("places.kml");
    let report = export_layer(&layer, &path).unwrap();
    assert!(
        report.notes.iter().any(|n| n.contains("KMZ")),
        "{:?}",
        report.notes
    );
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(!text.contains("star.png"));
    let back = import_path(path.to_str().unwrap()).unwrap();
    assert_eq!(back.features.len(), 3);
}

#[test]
fn cdata_splits_the_terminator() {
    assert_eq!(cdata("a]]>b"), "<![CDATA[a]]]]><![CDATA[>b]]>");
    assert_eq!(esc("a<b>&\"c\"\u{1}"), "a&lt;b&gt;&amp;&quot;c&quot;");
}

// ---- KML 2.2 element order ----

/// Allowed child-element order for a parent: each slice is a group of equivalent alternatives.
fn order(parent: &str) -> Option<&'static [&'static [&'static str]]> {
    Some(match parent {
        "Placemark" => &[
            &["name"],
            &["visibility"],
            &["open"],
            &["description"],
            &["styleUrl"],
            &["ExtendedData"],
            &[
                "Point",
                "LineString",
                "LinearRing",
                "Polygon",
                "MultiGeometry",
            ],
        ],
        "Document" | "Folder" => &[
            &["name"],
            &["visibility"],
            &["open"],
            &["description"],
            &["Style", "StyleMap"],
            &["Folder", "Placemark", "GroundOverlay"],
        ],
        "Style" => &[
            &["IconStyle"],
            &["LabelStyle"],
            &["LineStyle"],
            &["PolyStyle"],
        ],
        "IconStyle" => &[&["color"], &["scale"], &["heading"], &["Icon"]],
        "LabelStyle" => &[&["color"], &["scale"]],
        "LineStyle" => &[&["color"], &["width"]],
        "PolyStyle" => &[&["color"], &["fill"], &["outline"]],
        "Polygon" => &[
            &["extrude"],
            &["tessellate"],
            &["altitudeMode"],
            &["outerBoundaryIs"],
            &["innerBoundaryIs"],
        ],
        "LineString" => &[
            &["extrude"],
            &["tessellate"],
            &["altitudeMode"],
            &["coordinates"],
        ],
        "Point" => &[&["extrude"], &["altitudeMode"], &["coordinates"]],
        "GroundOverlay" => &[
            &["name"],
            &["visibility"],
            &["color"],
            &["Icon"],
            &["LatLonBox"],
        ],
        "LatLonBox" => &[&["north"], &["south"], &["east"], &["west"], &["rotation"]],
        _ => return None,
    })
}

/// Checks that the document is well-formed, rooted at a KML 2.2 <kml>, and that children appear in
/// schema order. Returns the number of elements checked.
fn assert_kml_structure(xml: &str) -> usize {
    let mut r = Reader::from_str(xml);
    let mut stack: Vec<(String, Vec<String>)> = Vec::new();
    let mut checked = 0;
    let mut saw_root = false;
    loop {
        match r.read_event().expect("well-formed XML") {
            Event::Start(e) | Event::Empty(e) => {
                let ln = e.local_name();
                let name = AsRef::<str>::as_ref(&ln).to_string();
                if stack.is_empty() {
                    assert_eq!(name, "kml");
                    let ns = e
                        .attributes()
                        .flatten()
                        .find(|a| a.key.as_ref() == "xmlns")
                        .expect("xmlns");
                    assert_eq!(&*ns.value, "http://www.opengis.net/kml/2.2");
                    saw_root = true;
                }
                if let Some((_, kids)) = stack.last_mut() {
                    kids.push(name.clone());
                }
                stack.push((name, Vec::new()));
            }
            Event::End(_) => {
                let (name, kids) = stack.pop().unwrap();
                if let Some(groups) = order(&name) {
                    let mut last = 0;
                    for k in &kids {
                        let rank = groups.iter().position(|g| g.contains(&k.as_str()));
                        let rank =
                            rank.unwrap_or_else(|| panic!("<{k}> is not allowed inside <{name}>"));
                        assert!(
                            rank >= last,
                            "<{k}> is out of order inside <{name}>: {kids:?}"
                        );
                        last = rank;
                    }
                    checked += 1;
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    assert!(saw_root && stack.is_empty());
    checked
}

fn kml_of(l: &LayerData, mode: IconMode) -> String {
    let mut buf = Vec::new();
    write_kml(l, &mut buf, mode).unwrap();
    String::from_utf8(buf).unwrap()
}

#[test]
fn exported_kml_follows_the_kml_2_2_element_order() {
    let layer = user_features_to_layer("Places", &sample_features());
    let n = assert_kml_structure(&kml_of(&layer, IconMode::Keep));
    assert!(n > 10, "only {n} elements checked");
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-data/fixtures")
}

#[test]
fn every_fixture_round_trips_through_kmz_with_the_same_content() {
    let mut checked = 0;
    for entry in std::fs::read_dir(fixtures_dir()).unwrap().flatten() {
        let p = entry.path();
        let ext = p
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !["kml", "kmz", "geojson", "gpx"].contains(&ext.as_str())
            || p.to_string_lossy().contains("broken")
        {
            continue;
        }
        let original = import_path(p.to_str().unwrap()).unwrap();
        let out = temp(&format!(
            "rt-{}.kmz",
            p.file_stem().unwrap().to_string_lossy()
        ));
        export_layer(&original, &out).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
        assert_kml_structure(&kml_of(&original, IconMode::Keep));
        let back = import_path(out.to_str().unwrap()).unwrap();
        let what = p.display().to_string();

        assert_eq!(
            feature_names(&back),
            feature_names(&original),
            "{what}: names"
        );
        assert_eq!(back.part_type, original.part_type, "{what}: part types");
        assert_eq!(
            back.vertex_count(),
            original.vertex_count(),
            "{what}: vertices"
        );
        assert_eq!(
            back.overlays.len(),
            original.overlays.len(),
            "{what}: overlays"
        );
        assert_eq!(
            back.styles.len(),
            original.styles.len(),
            "{what}: distinct styles"
        );
        for i in 0..original.features.len() {
            assert_eq!(
                back.styles[back.feature_style[i] as usize],
                original.styles[original.feature_style[i] as usize],
                "{what}: style of feature {i}"
            );
            assert_eq!(
                back.features[i].visible, original.features[i].visible,
                "{what}: visibility {i}"
            );
            assert_eq!(
                back.features[i].description, original.features[i].description,
                "{what}: description {i}"
            );
            for c in &original.columns {
                assert_eq!(
                    attr(&back, i, &c.name),
                    attr(&original, i, &c.name),
                    "{what}: attr {}",
                    c.name
                );
            }
        }
        for (a, b) in original.coords.iter().zip(&back.coords) {
            assert!((a - b).abs() < 1e-12, "{what}: coordinates");
        }
        // Folder structure (names, nesting, visibility) is preserved.
        let tree = |l: &LayerData| serde_json::to_string(&l.manifest("x", 0).tree).unwrap();
        let strip = |s: String| {
            s.replace("\"open\":true", "\"open\":false")
                .replace("\"open\":false", "")
        };
        assert_eq!(
            strip(tree(&back)),
            strip(tree(&original)),
            "{what}: folder tree"
        );
        checked += 1;
    }
    assert!(checked >= 10, "expected the fixture set, checked {checked}");
}

#[test]
fn geojson_export_is_valid_and_reimports() {
    let layer = user_features_to_layer("Places", &sample_features());
    let path = temp("places.geojson");
    let report = export_layer(&layer, &path).unwrap();
    assert!(report.notes.iter().any(|n| n.contains("Styles")));
    let v: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(v["type"], "FeatureCollection");
    let f = v["features"].as_array().unwrap();
    assert_eq!(f.len(), 3);
    assert_eq!(f[0]["geometry"]["type"], "Point");
    assert_eq!(f[0]["properties"]["units"], 12.0); // numeric columns are numbers
    assert_eq!(f[2]["geometry"]["type"], "Polygon");
    assert_eq!(f[2]["geometry"]["coordinates"].as_array().unwrap().len(), 2); // outer + hole
    let ring = f[2]["geometry"]["coordinates"][0].as_array().unwrap();
    assert_eq!(ring.first(), ring.last(), "rings are closed");
    let back = import_path(path.to_str().unwrap()).unwrap();
    assert_eq!(back.features.len(), 3);
    assert_eq!(back.part_type, layer.part_type);
}

#[test]
fn multi_part_features_export_as_multi_geometries() {
    let l = crate::import::parse_kml_str(
        r#"<kml><Placemark><name>M</name><MultiGeometry>
          <Point><coordinates>1,1</coordinates></Point><Point><coordinates>2,2</coordinates></Point></MultiGeometry></Placemark>
          <Placemark><name>Mixed</name><MultiGeometry><Point><coordinates>1,1</coordinates></Point>
          <LineString><coordinates>0,0 1,1</coordinates></LineString></MultiGeometry></Placemark></kml>"#,
    )
    .unwrap();
    let mut buf = Vec::new();
    write_geojson(&l, &mut buf).unwrap();
    let v: serde_json::Value = serde_json::from_slice(&buf).unwrap();
    assert_eq!(v["features"][0]["geometry"]["type"], "MultiPoint");
    assert_eq!(v["features"][1]["geometry"]["type"], "GeometryCollection");
    let kml = kml_of(&l, IconMode::Keep);
    assert_eq!(kml.matches("<MultiGeometry>").count(), 2);
    assert_kml_structure(&kml);
}

#[test]
fn geometry_options_and_altitude_survive() {
    let l = crate::import::parse_kml_str(
        r#"<kml><Placemark><name>A</name><LineString><extrude>1</extrude><tessellate>1</tessellate>
        <altitudeMode>relativeToGround</altitudeMode><coordinates>0,0,10 1,1,20</coordinates></LineString></Placemark></kml>"#,
    )
    .unwrap();
    let text = kml_of(&l, IconMode::Keep);
    assert!(text.contains("<extrude>1</extrude><tessellate>1</tessellate><altitudeMode>relativeToGround</altitudeMode>"));
    assert!(text.contains("0,0,10 1,1,20"));
    assert_kml_structure(&text);
}

#[test]
fn editable_copy_converts_features_and_enforces_the_limit() {
    let original = import_path(fixtures_dir().join("polygons.kml").to_str().unwrap()).unwrap();
    let users = layer_to_user_features(&original).unwrap();
    // 5 placemarks; the MultiGeometry one (point + line + polygon) splits into three.
    assert_eq!(users.len(), 7);
    let square = &users[0];
    assert_eq!(
        (square.kind.as_str(), square.name.as_str()),
        ("polygon", "Square with hole")
    );
    assert_eq!(
        square.coords.len(),
        4,
        "closing vertex is dropped for editing"
    );
    assert_eq!(square.holes.len(), 1);
    assert_eq!(square.style.color, "#00ff00");
    assert!(users
        .iter()
        .any(|u| u.name == "MultiGeometry (point, line, polygon) (2)"));
    let outline_only = users.iter().find(|u| u.name == "Outline only").unwrap();
    assert_eq!(outline_only.style.fill_opacity, 0.0);

    // The conversion is lossless enough to export and re-import with the same geometry.
    let layer = user_features_to_layer("Copy", &users);
    let out = temp("copy.kmz");
    export_layer(&layer, &out).unwrap();
    assert_eq!(
        import_path(out.to_str().unwrap()).unwrap().features.len(),
        7
    );

    let many: Vec<UserFeatureDto> = (0..EDITABLE_COPY_LIMIT + 1)
        .map(|i| UserFeatureDto {
            name: format!("p{i}"),
            description: String::new(),
            kind: "point".into(),
            coords: vec![[0.0, 0.0]],
            holes: vec![],
            attrs: vec![],
            style: style("#ffffff", 1.0, 0.0, None),
            visible: true,
        })
        .collect();
    let big = user_features_to_layer("Big", &many);
    let err = layer_to_user_features(&big).unwrap_err().to_string();
    assert!(err.contains("10000") && err.contains("limited"), "{err}");
}

#[test]
fn unsupported_extensions_and_missing_dirs_are_readable_errors() {
    let l = user_features_to_layer("x", &sample_features());
    let e = export_layer(&l, &temp("x.txt")).unwrap_err().to_string();
    assert!(e.contains("not a supported export type"), "{e}");
    let e = export_layer(&l, Path::new("C:/definitely/not/here/x.kml"))
        .unwrap_err()
        .to_string();
    assert!(e.contains("x.kml"), "{e}");
}
