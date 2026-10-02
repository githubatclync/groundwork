// File import entry point: picks the importer by extension, opens KMZ archives, and turns
// parser failures into readable errors (file name plus line number where known). Bad XML in the
// middle of a file keeps what was parsed so far and records a warning instead of failing.
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use crate::layer::{LayerBuilder, LayerData, Loc, Resources};
use crate::{geojson, gpx, kml};

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("Could not read \"{file}\": {message}")]
    Io { file: String, message: String },
    #[error(
        "\"{file}\" is not a supported file type (expected .kml, .kmz, .geojson, .json, or .gpx)"
    )]
    Unsupported { file: String },
    #[error("\"{file}\" could not be parsed{at}: {message}")]
    Parse {
        file: String,
        at: String,
        message: String,
    },
    #[error("\"{file}\" is empty")]
    Empty { file: String },
    #[error("\"{file}\" contains no KML document")]
    NoKml { file: String },
    #[error("Unknown layer \"{0}\"")]
    UnknownLayer(String),
}

impl serde::Serialize for ImportError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn io_err(file: &str, e: impl std::fmt::Display) -> ImportError {
    ImportError::Io {
        file: file.to_string(),
        message: e.to_string(),
    }
}

/// 1-based line number of a byte offset, computed by re-reading (only used on the error path).
fn line_at(mut r: impl Read, pos: u64) -> Option<u64> {
    let mut remaining = pos;
    let mut line = 1u64;
    let mut buf = [0u8; 64 * 1024];
    while remaining > 0 {
        let want = remaining.min(buf.len() as u64) as usize;
        let n = r.read(&mut buf[..want]).ok()?;
        if n == 0 {
            break;
        }
        line += buf[..n].iter().filter(|&&b| b == b'\n').count() as u64;
        remaining -= n as u64;
    }
    Some(line)
}

fn at_line(line: Option<u64>) -> String {
    line.map(|l| format!(" at line {l}")).unwrap_or_default()
}

/// Shared handling for a parser that may stop early: partial results are kept when anything
/// was imported, otherwise the failure becomes an error.
fn finish_parse(
    result: Result<(), (Loc, String)>,
    file: &str,
    line: impl FnOnce(u64) -> Option<u64>,
    b: &mut LayerBuilder,
) -> Result<(), ImportError> {
    match result {
        Ok(()) => Ok(()),
        Err((loc, message)) => {
            let at = at_line(match loc {
                Loc::Byte(pos) => line(pos),
                Loc::Line(l) => Some(l),
            });
            if b.feature_count() > 0 {
                b.warn(
                    "Parse error",
                    &format!("The file is damaged{at}: {message}. Everything before that point was imported."),
                );
                Ok(())
            } else {
                Err(ImportError::Parse {
                    file: file.to_string(),
                    at,
                    message,
                })
            }
        }
    }
}

fn default_name(path: &Path) -> String {
    path.file_stem()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Layer".into())
}

fn import_kml(path: &Path, file: &str) -> Result<LayerData, ImportError> {
    let f = File::open(path).map_err(|e| io_err(file, e))?;
    let mut b = LayerBuilder::new(&default_name(path));
    let result = kml::parse_kml(BufReader::with_capacity(256 * 1024, f), &mut b);
    finish_parse(
        result,
        file,
        |pos| File::open(path).ok().and_then(|f| line_at(f, pos)),
        &mut b,
    )?;
    let dir = path.parent().map(|p| p.to_path_buf());
    let resources = dir.map(Resources::Dir).unwrap_or(Resources::None);
    Ok(b.finish(&path.to_string_lossy(), "kml", resources))
}

fn import_kmz(path: &Path, file: &str) -> Result<LayerData, ImportError> {
    let open = || -> Result<zip::ZipArchive<File>, ImportError> {
        let f = File::open(path).map_err(|e| io_err(file, e))?;
        zip::ZipArchive::new(f).map_err(|e| ImportError::Parse {
            file: file.to_string(),
            at: String::new(),
            message: format!("not a valid KMZ (zip) archive: {e}"),
        })
    };
    let mut archive = open()?;
    let entry = kml::kmz::pick_kml_entry(archive.file_names().collect::<Vec<_>>().into_iter())
        .ok_or_else(|| ImportError::NoKml {
            file: file.to_string(),
        })?;
    let mut b = LayerBuilder::new(&default_name(path));
    let result = {
        let zf = archive.by_name(&entry).map_err(|e| io_err(file, e))?;
        kml::parse_kml(BufReader::with_capacity(256 * 1024, zf), &mut b)
    };
    finish_parse(
        result,
        file,
        |pos| {
            let mut a = open().ok()?;
            let zf = a.by_name(&entry).ok()?;
            line_at(zf, pos)
        },
        &mut b,
    )?;
    let resources = Resources::Zip(std::sync::Mutex::new(open()?));
    Ok(b.finish(&path.to_string_lossy(), "kmz", resources))
}

fn import_geojson(path: &Path, file: &str) -> Result<LayerData, ImportError> {
    let f = File::open(path).map_err(|e| io_err(file, e))?;
    let mut b = LayerBuilder::new(&default_name(path));
    let result = geojson::parse_geojson(BufReader::with_capacity(256 * 1024, f), &mut b);
    finish_parse(
        result,
        file,
        |pos| File::open(path).ok().and_then(|f| line_at(f, pos)),
        &mut b,
    )?;
    Ok(b.finish(&path.to_string_lossy(), "geojson", Resources::None))
}

fn import_gpx(path: &Path, file: &str) -> Result<LayerData, ImportError> {
    let f = File::open(path).map_err(|e| io_err(file, e))?;
    let mut b = LayerBuilder::new(&default_name(path));
    let result = gpx::parse_gpx(BufReader::with_capacity(256 * 1024, f), &mut b);
    finish_parse(
        result,
        file,
        |pos| File::open(path).ok().and_then(|f| line_at(f, pos)),
        &mut b,
    )?;
    Ok(b.finish(&path.to_string_lossy(), "gpx", Resources::None))
}

/// Imports a file into a finished layer.
pub fn import_path(path: &str) -> Result<LayerData, ImportError> {
    let p = Path::new(path);
    let file = file_name(p);
    if std::fs::metadata(p).is_ok_and(|m| m.len() == 0) {
        return Err(ImportError::Empty { file });
    }
    match p
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .as_deref()
    {
        Some("kml") => import_kml(p, &file),
        Some("kmz") => import_kmz(p, &file),
        Some("geojson") | Some("json") => import_geojson(p, &file),
        Some("gpx") => import_gpx(p, &file),
        _ => Err(ImportError::Unsupported { file }),
    }
}

/// Parses KML text directly (used by tests and tools).
pub fn parse_kml_str(text: &str) -> Result<LayerData, (Loc, String)> {
    let mut b = LayerBuilder::new("test");
    kml::parse_kml(BufReader::new(text.as_bytes()), &mut b)?;
    Ok(b.finish("test.kml", "kml", Resources::None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("groundwork-import-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    fn write_kmz(path: &Path, kml: &str, files: &[(&str, &[u8])]) {
        let mut z = zip::ZipWriter::new(File::create(path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        z.start_file("doc.kml", opts).unwrap();
        z.write_all(kml.as_bytes()).unwrap();
        for (name, data) in files {
            z.start_file(*name, opts).unwrap();
            z.write_all(data).unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn kmz_with_relative_icons_and_overlay_serves_resources() {
        let path = temp("icons.kmz");
        let png = [0x89u8, b'P', b'N', b'G', 1, 2, 3];
        write_kmz(
            &path,
            r##"<kml><Document>
              <Style id="i"><IconStyle><Icon><href>files/pin.png</href></Icon></IconStyle></Style>
              <Placemark><styleUrl>#i</styleUrl><Point><coordinates>1,2</coordinates></Point></Placemark>
              <GroundOverlay><Icon><href>files/over lay.png</href></Icon><LatLonBox><north>2</north><south>1</south><east>2</east><west>1</west></LatLonBox></GroundOverlay>
            </Document></kml>"##,
            &[
                ("files/pin.png", &png),
                ("files/over lay.png", &png),
                ("secret.txt", b"nope"),
            ],
        );
        let l = import_path(path.to_str().unwrap()).unwrap();
        assert_eq!(l.format, "kmz");
        let icon = l.styles[l.feature_style[0] as usize].icon.as_ref().unwrap();
        assert_eq!(icon.href, "files/pin.png");
        assert!(!icon.remote);
        assert_eq!(l.resources.read("files/pin.png").as_deref(), Some(&png[..]));
        assert_eq!(
            l.resources.read(".\\files\\pin.png").as_deref(),
            Some(&png[..])
        );
        assert_eq!(
            l.resources.read("FILES/PIN.PNG").as_deref(),
            Some(&png[..]),
            "case-insensitive fallback"
        );
        assert_eq!(
            l.resources.read(&l.overlays[0].href).as_deref(),
            Some(&png[..])
        );
        assert!(l.resources.read("files/missing.png").is_none());
        assert!(
            l.resources.read("secret.txt").is_none(),
            "only image files are served"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn kml_next_to_images_serves_relative_files() {
        let dir = temp("dirtest");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.png"), [1u8, 2, 3]).unwrap();
        std::fs::write(
            dir.join("doc.kml"),
            "<kml><Placemark><Point><coordinates>0,0</coordinates></Point></Placemark></kml>",
        )
        .unwrap();
        let l = import_path(dir.join("doc.kml").to_str().unwrap()).unwrap();
        assert_eq!(l.resources.read("a.png"), Some(vec![1, 2, 3]));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn errors_are_readable() {
        let e = import_path("C:/nope/missing.kml").unwrap_err().to_string();
        assert!(e.contains("missing.kml"), "{e}");
        let e = import_path("notes.txt").unwrap_err().to_string();
        assert!(
            e.contains("notes.txt") && e.contains("not a supported"),
            "{e}"
        );

        let p = temp("notzip.kmz");
        std::fs::write(&p, "hello").unwrap();
        let e = import_path(p.to_str().unwrap()).unwrap_err().to_string();
        assert!(e.contains("notzip.kmz") && e.contains("KMZ"), "{e}");

        let p = temp("nokml.kmz");
        let mut z = zip::ZipWriter::new(File::create(&p).unwrap());
        z.start_file("readme.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        z.finish().unwrap();
        let e = import_path(p.to_str().unwrap()).unwrap_err().to_string();
        assert!(e.contains("no KML document"), "{e}");
    }

    #[test]
    fn empty_file_is_an_error() {
        let p = temp("zero.kml");
        std::fs::write(&p, "").unwrap();
        let e = import_path(p.to_str().unwrap()).unwrap_err().to_string();
        assert!(e.contains("zero.kml") && e.contains("is empty"), "{e}");
    }

    #[test]
    fn bad_xml_reports_line_and_keeps_partial_results() {
        // Nothing usable before the error: hard error with the line number.
        let p = temp("bad.kml");
        std::fs::write(&p, "<kml>\n<Document>\n<Placemark>\n</Oops>\n</kml>").unwrap();
        let e = import_path(p.to_str().unwrap()).unwrap_err().to_string();
        assert!(e.contains("bad.kml") && e.contains("line 4"), "{e}");

        // Features parsed before the damage are kept, with a warning.
        let p = temp("partial.kml");
        std::fs::write(
            &p,
            "<kml><Document>\n<Placemark><name>ok</name><Point><coordinates>0,0</coordinates></Point></Placemark>\n<Placemark><name>cut",
        )
        .unwrap();
        let l = import_path(p.to_str().unwrap()).unwrap();
        assert_eq!(l.features.len(), 1);
        assert_eq!(
            l.warnings
                .iter()
                .filter(|w| w.kind == "Parse error")
                .count(),
            1
        );
    }

    #[test]
    fn all_fixtures_import_without_error() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-data/fixtures");
        let mut n = 0;
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = entry.path();
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if !["kml", "kmz", "geojson", "gpx"].contains(&ext.as_str())
                || path.to_string_lossy().contains("broken")
            {
                continue;
            }
            let l = import_path(path.to_str().unwrap())
                .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            assert!(
                l.features.len() + l.overlays.len() > 0,
                "{} imported nothing",
                path.display()
            );
            n += 1;
        }
        assert!(n >= 8, "expected the fixture set, found {n}");
    }
}
