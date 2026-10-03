// Styles: KML color conversion, partially-specified style definitions as parsed, and the fully
// resolved `Style` shipped to the frontend. Colors leave Rust as `rrggbbaa` hex strings.
use serde::Serialize;

/// Converts a KML `aabbggrr` hex color to `rrggbbaa`. Returns None if it is not 8 hex digits.
pub fn kml_color_to_rgba(kml: &str) -> Option<String> {
    let s = kml.trim();
    if s.len() != 8 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let s = s.to_ascii_lowercase();
    Some(format!("{}{}{}{}", &s[6..8], &s[4..6], &s[2..4], &s[0..2]))
}

/// Converts `rrggbbaa` back to KML's `aabbggrr`. Returns None if it is not 8 hex digits.
pub fn rgba_to_kml_color(rgba: &str) -> Option<String> {
    let s = rgba.trim();
    if s.len() != 8 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let s = s.to_ascii_lowercase();
    Some(format!("{}{}{}{}", &s[6..8], &s[4..6], &s[2..4], &s[0..2]))
}

pub const WHITE: &str = "ffffffff";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconStyle {
    /// Relative path inside the KMZ / next to the KML, or a remote URL. Empty = default marker.
    pub href: String,
    pub remote: bool,
    pub scale: f32,
    pub heading: f32,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelStyle {
    pub color: String,
    pub scale: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineStyle {
    pub color: String,
    pub width: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolyStyle {
    pub color: String,
    pub fill: bool,
    pub outline: bool,
}

/// A fully resolved style (defaults applied, StyleMap flattened to its normal state).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub icon: Option<IconStyle>,
    pub label: Option<LabelStyle>,
    pub line: LineStyle,
    pub poly: PolyStyle,
}

impl Default for Style {
    fn default() -> Self {
        StyleDef::default().resolve()
    }
}

/// A style as written in the file: every field optional.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StyleDef {
    pub has_icon: bool,
    pub icon_href: Option<String>,
    pub icon_scale: Option<f32>,
    pub icon_heading: Option<f32>,
    pub icon_color: Option<String>,
    pub has_label: bool,
    pub label_color: Option<String>,
    pub label_scale: Option<f32>,
    pub line_color: Option<String>,
    pub line_width: Option<f32>,
    pub poly_color: Option<String>,
    pub poly_fill: Option<bool>,
    pub poly_outline: Option<bool>,
}

fn is_remote(href: &str) -> bool {
    let h = href.trim_start().to_ascii_lowercase();
    h.starts_with("http://") || h.starts_with("https://") || h.starts_with("ftp://")
}

/// Normalizes a relative resource path: backslashes to slashes, no leading `./` or `/`.
pub fn normalize_href(href: &str) -> String {
    let h = href.trim().replace('\\', "/");
    h.trim_start_matches("./")
        .trim_start_matches('/')
        .to_string()
}

impl StyleDef {
    pub fn resolve(&self) -> Style {
        let color = |c: &Option<String>| c.clone().unwrap_or_else(|| WHITE.to_string());
        Style {
            icon: self.has_icon.then(|| {
                let href = self.icon_href.clone().unwrap_or_default();
                let remote = is_remote(&href);
                IconStyle {
                    href: if remote {
                        href.trim().to_string()
                    } else {
                        normalize_href(&href)
                    },
                    remote,
                    scale: self.icon_scale.unwrap_or(1.0),
                    heading: self.icon_heading.unwrap_or(0.0),
                    color: color(&self.icon_color),
                }
            }),
            label: self.has_label.then(|| LabelStyle {
                color: color(&self.label_color),
                scale: self.label_scale.unwrap_or(1.0),
            }),
            line: LineStyle {
                color: color(&self.line_color),
                width: self.line_width.unwrap_or(1.0),
            },
            poly: PolyStyle {
                color: color(&self.poly_color),
                fill: self.poly_fill.unwrap_or(true),
                outline: self.poly_outline.unwrap_or(true),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kml_color_is_aabbggrr() {
        // Opaque red in KML is ff0000ff (a=ff b=00 g=00 r=ff) -> rrggbbaa ff0000ff.
        assert_eq!(kml_color_to_rgba("ff0000ff").as_deref(), Some("ff0000ff"));
        // Opaque blue: a=ff b=ff g=00 r=00.
        assert_eq!(kml_color_to_rgba("ffff0000").as_deref(), Some("0000ffff"));
        // Half-transparent green: a=80 b=00 g=ff r=00.
        assert_eq!(kml_color_to_rgba("8000ff00").as_deref(), Some("00ff0080"));
        // Distinct channels prove the byte order: a=11 b=22 g=33 r=44.
        assert_eq!(kml_color_to_rgba("11223344").as_deref(), Some("44332211"));
        assert_eq!(kml_color_to_rgba(" 7FABCDEF ").as_deref(), Some("efcdab7f"));
    }

    #[test]
    fn rgba_to_kml_is_the_inverse() {
        assert_eq!(rgba_to_kml_color("ff0000ff").as_deref(), Some("ff0000ff")); // opaque red
        assert_eq!(rgba_to_kml_color("0000ffff").as_deref(), Some("ffff0000")); // opaque blue
        assert_eq!(rgba_to_kml_color("44332211").as_deref(), Some("11223344"));
        for c in ["11223344", "8000ff00", "ffabcdef"] {
            let rgba = kml_color_to_rgba(c).unwrap();
            assert_eq!(rgba_to_kml_color(&rgba).as_deref(), Some(c));
        }
        assert_eq!(rgba_to_kml_color("xyz"), None);
    }

    #[test]
    fn kml_color_rejects_bad_input() {
        assert_eq!(kml_color_to_rgba(""), None);
        assert_eq!(kml_color_to_rgba("ff00ff"), None);
        assert_eq!(kml_color_to_rgba("gg0000ff"), None);
    }

    #[test]
    fn defaults_apply_when_fields_missing() {
        let s = Style::default();
        assert!(s.icon.is_none() && s.label.is_none());
        assert_eq!(
            s.line,
            LineStyle {
                color: "ffffffff".into(),
                width: 1.0
            }
        );
        assert!(s.poly.fill && s.poly.outline);
    }

    #[test]
    fn icon_href_local_vs_remote() {
        let d = StyleDef {
            has_icon: true,
            icon_href: Some(".\\files\\a.png".into()),
            ..Default::default()
        };
        let i = d.resolve().icon.unwrap();
        assert_eq!(i.href, "files/a.png");
        assert!(!i.remote);
        let d = StyleDef {
            has_icon: true,
            icon_href: Some("http://maps.google.com/x.png".into()),
            ..Default::default()
        };
        assert!(d.resolve().icon.unwrap().remote);
    }
}
