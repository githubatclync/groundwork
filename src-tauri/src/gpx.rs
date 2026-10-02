// GPX importer: waypoints become points; tracks and routes become lines. Waypoints, routes,
// and tracks go into their own folders. Child elements and `<extensions>` become attributes.
use std::io::BufRead;

use quick_xml::events::{BytesRef, BytesStart, Event};
use quick_xml::Reader;

use crate::layer::{LayerBuilder, Loc, GEOM_LINE, GEOM_POINT};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Wpt,
    Rte,
    Trk,
}

struct Item {
    kind: Kind,
    name: String,
    desc: Option<String>,
    attrs: Vec<(String, String)>,
    /// Point (wpt) or segments of lon/lat/alt triples (rte has one, trk has one per trkseg).
    segs: Vec<Vec<f64>>,
}

fn latlon(e: &BytesStart) -> Option<(f64, f64)> {
    let get = |k: &str| {
        e.attributes()
            .flatten()
            .find(|a| a.key.local_name().as_ref() == k)
            .and_then(|a| {
                a.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                    .ok()?
                    .trim()
                    .parse::<f64>()
                    .ok()
            })
    };
    let (lat, lon) = (get("lat")?, get("lon")?);
    ((-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)).then_some((lon, lat))
}

fn emit(b: &mut LayerBuilder, item: Item) {
    let Item {
        kind,
        name,
        desc,
        attrs,
        segs,
    } = item;
    b.begin_feature(name, desc, true, None);
    for seg in &segs {
        match kind {
            Kind::Wpt if seg.len() >= 3 => b.add_part(GEOM_POINT, &seg[..3], 0),
            Kind::Rte | Kind::Trk if seg.len() >= 6 => b.add_part(GEOM_LINE, seg, 0),
            _ => {}
        }
    }
    for (k, v) in attrs {
        b.add_attr(&k, v);
    }
    b.end_feature();
}

pub fn parse_gpx<R: BufRead>(reader: R, b: &mut LayerBuilder) -> Result<(), (Loc, String)> {
    let mut xr = Reader::from_reader(reader);
    let mut buf = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut text = String::new();
    let mut item: Option<Item> = None;
    let mut folder: Option<Kind> = None;
    let mut bad_points = 0u32;

    macro_rules! start {
        ($e:expr) => {{
            let ln = $e.local_name();
            let name = AsRef::<str>::as_ref(&ln).to_string();
            text.clear();
            match name.as_str() {
                "wpt" | "rte" | "trk" if item.is_none() => {
                    let kind = match name.as_str() {
                        "wpt" => Kind::Wpt,
                        "rte" => Kind::Rte,
                        _ => Kind::Trk,
                    };
                    if folder != Some(kind) {
                        if folder.is_some() {
                            b.pop_folder();
                        }
                        b.push_folder(match kind {
                            Kind::Wpt => "Waypoints",
                            Kind::Rte => "Routes",
                            Kind::Trk => "Tracks",
                        });
                        folder = Some(kind);
                    }
                    let mut it = Item {
                        kind,
                        name: String::new(),
                        desc: None,
                        attrs: Vec::new(),
                        segs: Vec::new(),
                    };
                    if kind == Kind::Wpt {
                        match latlon(&$e) {
                            Some((lon, lat)) => it.segs.push(vec![lon, lat, 0.0]),
                            None => bad_points += 1,
                        }
                    } else if kind == Kind::Rte {
                        it.segs.push(Vec::new());
                    }
                    item = Some(it);
                }
                "trkseg" => {
                    if let Some(it) = &mut item {
                        it.segs.push(Vec::new());
                    }
                }
                "rtept" | "trkpt" => {
                    if let Some(it) = &mut item {
                        match latlon(&$e) {
                            Some((lon, lat)) => {
                                if let Some(seg) = it.segs.last_mut() {
                                    seg.extend_from_slice(&[lon, lat, 0.0]);
                                }
                            }
                            None => bad_points += 1,
                        }
                    }
                }
                _ => {}
            }
            stack.push(name);
        }};
    }

    macro_rules! end {
        () => {{
            let Some(name) = stack.pop() else { continue };
            let parent = stack.last().map(String::as_str).unwrap_or("");
            let t = text.trim().to_string();
            text.clear();
            match name.as_str() {
                "wpt" | "rte" | "trk" => {
                    if let Some(it) = item.take_if(|it| {
                        matches!(
                            (&it.kind, name.as_str()),
                            (Kind::Wpt, "wpt") | (Kind::Rte, "rte") | (Kind::Trk, "trk")
                        )
                    }) {
                        emit(b, it);
                    }
                }
                "ele" if parent == "wpt" || parent == "rtept" || parent == "trkpt" => {
                    if let (Some(it), Ok(z)) = (&mut item, t.parse::<f64>()) {
                        if let Some(seg) = it.segs.last_mut() {
                            let n = seg.len();
                            if n >= 3 {
                                seg[n - 1] = z;
                            }
                        }
                    }
                }
                _ if !t.is_empty() && item.is_some() => {
                    let in_ext = stack.iter().any(|s| s == "extensions");
                    let direct = matches!(parent, "wpt" | "rte" | "trk");
                    if let Some(it) = &mut item {
                        if direct && name == "name" {
                            it.name = t;
                        } else if direct && name == "desc" {
                            it.desc = Some(t);
                        } else if direct || in_ext {
                            it.attrs.push((name, t));
                        }
                    }
                }
                _ => {}
            }
        }};
    }

    loop {
        match xr.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => start!(e),
            Ok(Event::Empty(e)) => {
                start!(e);
                end!();
            }
            Ok(Event::End(_)) => end!(),
            Ok(Event::Text(t)) => text.push_str(&t.xml10_content()),
            Ok(Event::CData(c)) => text.push_str(&c.xml10_content()),
            Ok(Event::GeneralRef(r)) => push_entity(&mut text, &r),
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err((Loc::Byte(xr.buffer_position()), e.to_string())),
        }
        buf.clear();
    }
    if bad_points > 0 {
        b.warn_n(
            "Malformed coordinates",
            "Points with a missing or invalid lat/lon were dropped",
            bad_points,
        );
    }
    Ok(())
}

fn push_entity(text: &mut String, r: &BytesRef) {
    if let Ok(Some(c)) = r.resolve_char_ref() {
        text.push(c);
        return;
    }
    match &**r {
        "amp" => text.push('&'),
        "lt" => text.push('<'),
        "gt" => text.push('>'),
        "quot" => text.push('"'),
        "apos" => text.push('\''),
        other => {
            text.push('&');
            text.push_str(other);
            text.push(';');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layer::Resources;

    #[test]
    fn imports_waypoints_tracks_and_routes() {
        let gpx = r#"<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="10" lon="20"><ele>5</ele><name>Camp &amp; Fire</name><desc>d</desc><sym>Flag</sym></wpt>
  <wpt lat="bad" lon="20"><name>Bad</name></wpt>
  <rte><name>R</name><rtept lat="0" lon="0"/><rtept lat="1" lon="1"/></rte>
  <trk><name>T</name>
    <trkseg><trkpt lat="0" lon="0"><ele>7</ele></trkpt><trkpt lat="1" lon="1"/></trkseg>
    <trkseg><trkpt lat="2" lon="2"/><trkpt lat="3" lon="3"/></trkseg>
    <extensions><speed>4.5</speed></extensions>
  </trk>
</gpx>"#;
        let mut b = LayerBuilder::new("g");
        parse_gpx(gpx.as_bytes(), &mut b).unwrap();
        let l = b.finish("g.gpx", "gpx", Resources::None);
        assert_eq!(l.features.len(), 4);
        assert_eq!(l.features[0].name, "Camp & Fire");
        assert_eq!(l.coords[..3], [20.0, 10.0, 5.0]);
        assert_eq!(l.part_type, vec![1, 2, 2, 2]); // the bad waypoint keeps its feature but has no geometry
        assert!(l.columns.iter().any(|c| c.name == "sym"));
        assert!(l.columns.iter().any(|c| c.name == "speed"));
        assert_eq!(
            l.folders
                .iter()
                .map(|f| f.name.as_str())
                .collect::<Vec<_>>(),
            ["g", "Waypoints", "Routes", "Tracks"]
        );
        assert_eq!(
            l.warnings
                .iter()
                .find(|w| w.kind == "Malformed coordinates")
                .unwrap()
                .count,
            1
        );
        // The trkpt elevation lands in the third coordinate.
        let trk_start = l.part_offset[2] as usize * 3;
        assert_eq!(l.coords[trk_start + 2], 7.0);
    }
}
