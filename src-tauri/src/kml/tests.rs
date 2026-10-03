// Unit tests for the KML parser: styles, geometry, attributes, overlays, and robustness.
use crate::import::parse_kml_str;
use crate::layer::{ColumnType, LayerData, FLAG_EXTRUDE, FLAG_TESSELLATE};

use super::parse_coords;

fn load(xml: &str) -> LayerData {
    parse_kml_str(xml).unwrap_or_else(|(_, e)| panic!("parse failed: {e}"))
}

fn warning(l: &LayerData, kind: &str) -> u32 {
    l.warnings
        .iter()
        .find(|w| w.kind == kind)
        .map(|w| w.count)
        .unwrap_or(0)
}

#[test]
fn style_map_resolves_to_normal_state() {
    let l = load(
        r##"<kml><Document>
          <Style id="n"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style>
          <Style id="h"><LineStyle><color>ff00ff00</color><width>9</width></LineStyle></Style>
          <StyleMap id="m">
            <Pair><key>highlight</key><styleUrl>#h</styleUrl></Pair>
            <Pair><key>normal</key><styleUrl>#n</styleUrl></Pair>
          </StyleMap>
          <Placemark><styleUrl>#m</styleUrl><LineString><coordinates>0,0 1,1</coordinates></LineString></Placemark>
        </Document></kml>"##,
    );
    let s = &l.styles[l.feature_style[0] as usize];
    assert_eq!(s.line.color, "ff0000ff"); // normal, converted from KML aabbggrr
    assert_eq!(s.line.width, 4.0);
}

#[test]
fn style_map_with_inline_pair_style() {
    let l = load(
        r##"<kml><Document>
          <StyleMap id="m"><Pair><key>normal</key><Style><PolyStyle><fill>0</fill></PolyStyle></Style></Pair></StyleMap>
          <Placemark><styleUrl>#m</styleUrl><Point><coordinates>1,1</coordinates></Point></Placemark>
        </Document></kml>"##,
    );
    assert!(!l.styles[l.feature_style[0] as usize].poly.fill);
}

#[test]
fn shared_and_inline_styles() {
    let l = load(
        r##"<kml><Document>
          <Style id="s"><IconStyle><scale>2</scale><color>ff00ffff</color></IconStyle></Style>
          <Placemark><name>shared</name><styleUrl>#s</styleUrl><Point><coordinates>0,0</coordinates></Point></Placemark>
          <Placemark><name>shared2</name><styleUrl>#s</styleUrl><Point><coordinates>1,1</coordinates></Point></Placemark>
          <Placemark><name>inline</name><Style><LabelStyle><scale>0</scale></LabelStyle></Style><Point><coordinates>2,2</coordinates></Point></Placemark>
          <Placemark><name>none</name><Point><coordinates>3,3</coordinates></Point></Placemark>
          <Placemark><name>missing</name><styleUrl>#nope</styleUrl><Point><coordinates>4,4</coordinates></Point></Placemark>
        </Document></kml>"##,
    );
    // Shared style is de-duplicated; inline gets its own; missing/none fall back to default (0).
    assert_eq!(l.feature_style[0], l.feature_style[1]);
    assert_ne!(l.feature_style[0], 0);
    assert_ne!(l.feature_style[2], l.feature_style[0]);
    assert_eq!(l.feature_style[3], 0);
    assert_eq!(l.feature_style[4], 0);
    let icon = l.styles[l.feature_style[0] as usize].icon.as_ref().unwrap();
    assert_eq!(icon.scale, 2.0);
    assert_eq!(icon.color, "ffff00ff"); // KML ff00ffff (a=ff b=00 g=ff r=ff) is yellow-ish magenta swap check
    assert_eq!(
        l.styles[l.feature_style[2] as usize]
            .label
            .as_ref()
            .unwrap()
            .scale,
        0.0
    );
    assert_eq!(warning(&l, "Missing style"), 1);
}

#[test]
fn style_defined_after_use_still_resolves() {
    let l = load(
        r##"<kml><Document>
          <Placemark><styleUrl>#late</styleUrl><LineString><coordinates>0,0 1,1</coordinates></LineString></Placemark>
          <Style id="late"><LineStyle><width>7</width></LineStyle></Style>
        </Document></kml>"##,
    );
    assert_eq!(l.styles[l.feature_style[0] as usize].line.width, 7.0);
}

#[test]
fn multigeometry_flattens_into_parts_of_one_feature() {
    let l = load(
        r#"<kml><Placemark><name>M</name><MultiGeometry>
          <Point><coordinates>1,1</coordinates></Point>
          <MultiGeometry>
            <LineString><coordinates>0,0 1,1</coordinates></LineString>
            <Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 4,0 4,4 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon>
          </MultiGeometry>
        </MultiGeometry></Placemark></kml>"#,
    );
    assert_eq!(l.features.len(), 1);
    assert_eq!(l.part_type, vec![1, 2, 3]);
    assert!(l.part_feature.iter().all(|&f| f == 0));
}

#[test]
fn polygon_inner_rings_become_holes_even_if_listed_first() {
    let l = load(
        r#"<kml><Placemark><Polygon>
          <innerBoundaryIs><LinearRing><coordinates>1,1 2,1 2,2 1,1</coordinates></LinearRing></innerBoundaryIs>
          <innerBoundaryIs><LinearRing><coordinates>5,5 6,5 6,6 5,5</coordinates></LinearRing></innerBoundaryIs>
          <outerBoundaryIs><LinearRing><coordinates>0,0 9,0 9,9 0,0</coordinates></LinearRing></outerBoundaryIs>
        </Polygon></Placemark></kml>"#,
    );
    assert_eq!(l.part_type, vec![3, 4, 4]);
    assert_eq!(l.coords[..3], [0.0, 0.0, 0.0]); // the outer ring was emitted first
}

#[test]
fn geometry_options_are_captured() {
    let l = load(
        r#"<kml><Placemark><LineString><extrude>1</extrude><tessellate>1</tessellate>
          <altitudeMode>relativeToGround</altitudeMode><coordinates>0,0,10 1,1,20</coordinates></LineString></Placemark>
        <Placemark><Point><altitudeMode>absolute</altitudeMode><coordinates>0,0,5</coordinates></Point></Placemark>
        <Placemark><Point><coordinates>0,0,5</coordinates></Point></Placemark></kml>"#,
    );
    assert_eq!(l.part_flags[0], 1 | FLAG_EXTRUDE | FLAG_TESSELLATE);
    assert_eq!(l.part_flags[1], 2);
    assert_eq!(l.part_flags[2], 0, "clampToGround is the default");
    assert_eq!(l.coords[2], 10.0);
}

#[test]
fn extended_data_and_schema_data() {
    let l = load(
        r##"<kml><Document>
          <Schema name="S" id="S"><SimpleField type="int" name="pop"/><SimpleField type="string" name="code"/></Schema>
          <Placemark><name>A</name>
            <ExtendedData><Data name="owner"><value>Bob &amp; Co</value></Data><Data name="area"><value>12.5</value></Data></ExtendedData>
            <Point><coordinates>0,0</coordinates></Point></Placemark>
          <Placemark><name>B</name>
            <ExtendedData><SchemaData schemaUrl="#S"><SimpleData name="pop">42</SimpleData><SimpleData name="code">007</SimpleData></SchemaData></ExtendedData>
            <Point><coordinates>1,1</coordinates></Point></Placemark>
        </Document></kml>"##,
    );
    let col = |n: &str| l.columns.iter().position(|c| c.name == n).unwrap();
    let val = |f: usize, n: &str| {
        let c = col(n) as u16;
        l.features[f]
            .attrs
            .iter()
            .find(|(i, _)| *i == c)
            .map(|(_, v)| v.to_string())
    };
    assert_eq!(val(0, "owner").as_deref(), Some("Bob & Co"));
    assert_eq!(val(0, "area").as_deref(), Some("12.5"));
    assert_eq!(val(1, "pop").as_deref(), Some("42"));
    assert_eq!(
        val(1, "code").as_deref(),
        Some("007"),
        "string columns keep leading zeros"
    );
    assert_eq!(val(1, "owner"), None);
    // Schema types win; undeclared columns are inferred from their values.
    assert_eq!(l.columns[col("pop")].ty, ColumnType::Number);
    assert_eq!(l.columns[col("code")].ty, ColumnType::String);
    assert_eq!(l.columns[col("area")].ty, ColumnType::Number);
    assert_eq!(l.columns[col("owner")].ty, ColumnType::String);
}

#[test]
fn malformed_coordinates_are_dropped_and_counted() {
    let l = load(
        r#"<kml><Placemark><LineString><coordinates>
            0,0,0   abc,1   1,1   200,95   2,2,x   3,3
        </coordinates></LineString></Placemark>
        <Placemark><Point><coordinates>nope</coordinates></Point></Placemark></kml>"#,
    );
    assert_eq!(l.vertex_count(), 3); // 0,0  1,1  3,3
    assert_eq!(warning(&l, "Malformed coordinates"), 4); // abc,1  200,95  2,2,x  nope
    assert_eq!(warning(&l, "Empty geometry"), 1);
}

#[test]
fn coordinates_tolerate_whitespace_and_newlines() {
    let mut out = Vec::new();
    let bad = parse_coords("\r\n  1,2,3\r\n\t4, 5 ,6\n7 ,8\n 9,10,\n", &mut out);
    assert_eq!(bad, 0);
    assert_eq!(
        out,
        vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 0.0, 9.0, 10.0, 0.0]
    );
    let mut out = Vec::new();
    parse_coords(
        "1,2,
3,4 5 , 6 , 7",
        &mut out,
    );
    assert_eq!(
        out,
        vec![1.0, 2.0, 0.0, 3.0, 4.0, 0.0, 5.0, 6.0, 7.0],
        "trailing commas do not swallow the next tuple"
    );
    let mut out = Vec::new();
    parse_coords("190,10", &mut out);
    assert_eq!(
        out,
        vec![-170.0, 10.0, 0.0],
        "longitudes just past 180 wrap"
    );
}

#[test]
fn folders_build_a_tree_with_visibility() {
    let l = load(
        r#"<kml><Document><name>Doc</name>
          <Folder><name>A</name><open>1</open><visibility>0</visibility>
            <Placemark><name>p</name><Point><coordinates>0,0</coordinates></Point></Placemark>
            <Folder><name>A1</name><Placemark><Point><coordinates>1,1</coordinates></Point></Placemark></Folder>
          </Folder>
          <Placemark><name>top</name><Point><coordinates>2,2</coordinates></Point></Placemark>
        </Document></kml>"#,
    );
    let m = l.manifest("L1", 0);
    assert_eq!(m.name, "Doc");
    assert_eq!(m.tree.name, "Doc");
    assert_eq!(m.tree.feature_count, 1);
    assert_eq!(m.tree.children.len(), 1);
    let a = &m.tree.children[0];
    assert_eq!(
        (a.name.as_str(), a.open, a.visible, a.feature_count),
        ("A", true, false, 1)
    );
    assert_eq!(a.children[0].name, "A1");
    assert_eq!(l.features[1].folder, 2);
}

#[test]
fn manifest_counts_geometry_kinds() {
    let l = load(
        r#"<kml><Placemark><MultiGeometry><Point><coordinates>0,0</coordinates></Point><LineString><coordinates>0,0 1,1</coordinates></LineString>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 4,0 4,4 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry></Placemark>
        <Placemark><Point><coordinates>5,5</coordinates></Point></Placemark></kml>"#,
    );
    let c = l.manifest("L1", 0).geometry_counts;
    assert_eq!((c.points, c.lines, c.polygons), (2, 1, 1));
}

#[test]
fn placemark_visibility_and_description() {
    let l = load(
        r#"<kml><Placemark><name>x</name><visibility>0</visibility>
          <description><![CDATA[<b>Hi</b> &amp; bye]]></description>
          <Point><coordinates>0,0</coordinates></Point></Placemark></kml>"#,
    );
    assert!(!l.features[0].visible);
    assert_eq!(
        l.features[0].description.as_deref(),
        Some("<b>Hi</b> &amp; bye")
    );
}

#[test]
fn ground_overlay_with_rotation() {
    let l = load(
        r#"<kml><Document><GroundOverlay><name>Map</name><color>80ffffff</color>
          <Icon><href>images\overlay.png</href></Icon>
          <LatLonBox><north>10</north><south>-10</south><east>20</east><west>-20</west><rotation>45</rotation></LatLonBox>
        </GroundOverlay>
        <GroundOverlay><Icon><href>http://example.com/x.png</href></Icon><LatLonBox><north>1</north><south>0</south><east>1</east><west>0</west></LatLonBox></GroundOverlay>
        <GroundOverlay><Icon><href>a.png</href></Icon></GroundOverlay></Document></kml>"#,
    );
    assert_eq!(l.overlays.len(), 1);
    let o = &l.overlays[0];
    assert_eq!(
        (o.north, o.south, o.east, o.west, o.rotation),
        (10.0, -10.0, 20.0, -20.0, 45.0)
    );
    assert_eq!(o.href, "images/overlay.png");
    assert_eq!(o.color, "ffffff80");
    assert_eq!(warning(&l, "Remote overlay image"), 1);
    assert_eq!(warning(&l, "Malformed GroundOverlay"), 1);
    assert_eq!(l.bounds, Some([-20.0, -10.0, 20.0, 10.0]));
}

#[test]
fn unsupported_elements_are_skipped_with_warnings() {
    let l = load(
        r#"<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>
          <NetworkLink><Link><href>x.kml</href></Link></NetworkLink>
          <ScreenOverlay><Icon><href>logo.png</href></Icon></ScreenOverlay>
          <Placemark><name>keep</name><TimeStamp><when>2020</when></TimeStamp><Point><coordinates>0,0</coordinates></Point></Placemark>
          <Placemark><gx:Track><gx:coord>1 2 3</gx:coord></gx:Track></Placemark>
          <Placemark><Model><Location><longitude>1</longitude></Location></Model></Placemark>
          <NetworkLink/>
        </Document></kml>"#,
    );
    assert_eq!(warning(&l, "NetworkLink"), 2);
    assert_eq!(warning(&l, "ScreenOverlay"), 1);
    assert_eq!(warning(&l, "TimeStamp"), 1);
    assert_eq!(warning(&l, "Track"), 1);
    assert_eq!(warning(&l, "Model"), 1);
    assert_eq!(l.features.len(), 3);
    assert_eq!(l.part_count(), 1);
    assert_eq!(l.features[0].name, "keep");
}

#[test]
fn survives_bom_prefix_crlf_and_missing_namespace() {
    let xml = "\u{feff}<?xml version=\"1.0\"?>\r\n<kml:kml xmlns:kml=\"http://www.opengis.net/kml/2.2\">\r\n<kml:Document>\r\n<kml:Placemark><kml:name>P</kml:name>\r\n<kml:Point><kml:coordinates>\r\n1,2\r\n</kml:coordinates></kml:Point></kml:Placemark></kml:Document></kml:kml>";
    let l = load(xml);
    assert_eq!(l.features[0].name, "P");
    assert_eq!(l.coords[..2], [1.0, 2.0]);
    let l = load(
        "<Placemark><name>bare</name><Point><coordinates>5,6</coordinates></Point></Placemark>",
    );
    assert_eq!(l.features[0].name, "bare");
}

#[test]
fn entities_in_names_are_decoded() {
    let l = load(
        r#"<kml><Placemark><name>A &amp; B &lt;1&gt; &#233;</name><Point><coordinates>0,0</coordinates></Point></Placemark></kml>"#,
    );
    assert_eq!(l.features[0].name, "A & B <1> é");
}

#[test]
fn truncated_file_returns_error_after_partial_parse() {
    let err = parse_kml_str(
        r#"<kml><Document><Placemark><name>ok</name><Point><coordinates>0,0</coordinates></Point></Placemark><Placemark><name>cut"#,
    );
    assert!(err.is_err());
}

#[test]
fn remote_icons_are_flagged_not_fetched() {
    let l = load(
        r##"<kml><Document>
          <Style id="g"><IconStyle><Icon><href>http://maps.google.com/mapfiles/pin.png</href></Icon></IconStyle></Style>
          <Style id="l"><IconStyle><Icon><href>files/pin.png</href></Icon></IconStyle></Style>
          <Placemark><styleUrl>#g</styleUrl><Point><coordinates>0,0</coordinates></Point></Placemark>
          <Placemark><styleUrl>#l</styleUrl><Point><coordinates>1,1</coordinates></Point></Placemark>
        </Document></kml>"##,
    );
    let g = l.styles[l.feature_style[0] as usize].icon.as_ref().unwrap();
    let loc = l.styles[l.feature_style[1] as usize].icon.as_ref().unwrap();
    assert!(g.remote);
    assert!(!loc.remote);
    assert_eq!(loc.href, "files/pin.png");
    assert_eq!(warning(&l, "Remote icons"), 1);
}
