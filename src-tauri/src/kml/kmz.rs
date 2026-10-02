// KMZ container handling: finds the main KML inside the archive. The archive is reopened and
// kept alive by the layer (see `Resources::Zip`) so embedded icons and overlays can be served.

/// Picks the main KML entry: `doc.kml` if present, else the first `.kml` at the archive root,
/// else the first `.kml` anywhere.
pub fn pick_kml_entry<'a>(names: impl Iterator<Item = &'a str> + Clone) -> Option<String> {
    let is_kml = |n: &&str| n.to_ascii_lowercase().ends_with(".kml") && !n.ends_with('/');
    names
        .clone()
        .find(|n| n.eq_ignore_ascii_case("doc.kml"))
        .or_else(|| names.clone().filter(is_kml).find(|n| !n.contains('/')))
        .or_else(|| names.filter(is_kml).next())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_doc_kml_then_root_then_any() {
        assert_eq!(
            pick_kml_entry(["a.kml", "doc.kml"].into_iter()).as_deref(),
            Some("doc.kml")
        );
        assert_eq!(
            pick_kml_entry(["sub/x.kml", "b.kml", "img.png"].into_iter()).as_deref(),
            Some("b.kml")
        );
        assert_eq!(
            pick_kml_entry(["sub/x.kml"].into_iter()).as_deref(),
            Some("sub/x.kml")
        );
        assert_eq!(pick_kml_entry(["img.png"].into_iter()), None);
    }
}
