// CSV point import. `inspect` reads the header and a few rows and guesses the delimiter and the
// latitude / longitude columns (lat, latitude, y / lon, lng, long, longitude, x); the UI shows these
// in a confirmation dialog, then `import` builds a point layer. Parsing follows RFC 4180 (quoted
// fields, doubled quotes, line breaks inside quotes) and streams, so large files are fine.
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::Serialize;

use crate::import::ImportError;
use crate::layer::{LayerBuilder, LayerData, Resources, GEOM_POINT};

/// Rows shown in the confirmation dialog.
const SAMPLE_ROWS: usize = 5;
const DELIMITERS: [u8; 4] = [b',', b';', b'\t', b'|'];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvInspection {
    pub headers: Vec<String>,
    pub delimiter: String,
    pub lat_col: Option<usize>,
    pub lon_col: Option<usize>,
    pub sample: Vec<Vec<String>>,
}

/// Reads records, calling `f` for each non-empty one until it returns false.
pub fn read_records<R: BufRead>(
    mut r: R,
    delim: u8,
    mut f: impl FnMut(Vec<String>) -> bool,
) -> std::io::Result<()> {
    let mut first = true;
    let mut record: Vec<String> = Vec::new();
    let mut field: Vec<u8> = Vec::new();
    let mut in_quotes = false;
    let mut was_quoted = false;
    let mut any = false; // something has been read for the current record
    let mut line = Vec::new();

    let push_field = |record: &mut Vec<String>, field: &mut Vec<u8>, quoted: bool| {
        let s = String::from_utf8_lossy(field).into_owned();
        record.push(if quoted { s } else { s.trim().to_string() });
        field.clear();
    };

    loop {
        line.clear();
        if r.read_until(b'\n', &mut line)? == 0 {
            break;
        }
        let mut bytes: &[u8] = &line;
        if first {
            first = false;
            bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
        }
        let mut i = 0;
        while i < bytes.len() {
            let b = bytes[i];
            if in_quotes {
                if b == b'"' {
                    if bytes.get(i + 1) == Some(&b'"') {
                        field.push(b'"');
                        i += 1;
                    } else {
                        in_quotes = false;
                    }
                } else {
                    field.push(b);
                }
            } else if b == b'"' && field.iter().all(|c| c.is_ascii_whitespace()) {
                field.clear();
                in_quotes = true;
                was_quoted = true;
                any = true;
            } else if b == delim {
                push_field(&mut record, &mut field, was_quoted);
                was_quoted = false;
                any = true;
            } else if b == b'\n' || b == b'\r' {
                // end of record (a \r\n pair is handled because \n arrives as its own byte)
                if b == b'\n' || bytes.get(i + 1) != Some(&b'\n') {
                    if any || !field.is_empty() {
                        push_field(&mut record, &mut field, was_quoted);
                        if !(record.len() == 1 && record[0].is_empty())
                            && !f(std::mem::take(&mut record))
                        {
                            return Ok(());
                        }
                    }
                    record.clear();
                    field.clear();
                    was_quoted = false;
                    any = false;
                }
            } else {
                field.push(b);
                any = true;
            }
            i += 1;
        }
    }
    if any || !field.is_empty() {
        push_field(&mut record, &mut field, was_quoted);
        if !(record.len() == 1 && record[0].is_empty()) {
            f(record);
        }
    }
    Ok(())
}

/// Picks the delimiter that appears most in the header line (outside quotes).
pub fn detect_delimiter(first_line: &str) -> u8 {
    let mut best = (b',', 0usize);
    for d in DELIMITERS {
        let mut in_q = false;
        let mut n = 0;
        for b in first_line.bytes() {
            if b == b'"' {
                in_q = !in_q;
            } else if b == d && !in_q {
                n += 1;
            }
        }
        if n > best.1 {
            best = (d, n);
        }
    }
    best.0
}

fn norm(h: &str) -> String {
    h.trim()
        .trim_matches('"')
        .to_lowercase()
        .replace([' ', '-'], "_")
}

fn find_col(headers: &[String], exact: &[&str], prefixes: &[&str]) -> Option<usize> {
    let h: Vec<String> = headers.iter().map(|s| norm(s)).collect();
    for name in exact {
        if let Some(i) = h.iter().position(|x| x == name) {
            return Some(i);
        }
    }
    prefixes
        .iter()
        .find_map(|p| h.iter().position(|x| x.starts_with(p)))
}

/// Guesses the latitude and longitude columns from the headers.
pub fn detect_columns(headers: &[String]) -> (Option<usize>, Option<usize>) {
    let lat = find_col(headers, &["lat", "latitude", "y"], &["lat"]);
    let lon = find_col(
        headers,
        &["lon", "lng", "long", "longitude", "x"],
        &["lon", "lng"],
    );
    match (lat, lon) {
        (Some(a), Some(b)) if a == b => (lat, None),
        other => other,
    }
}

fn open(path: &Path) -> Result<(BufReader<File>, String), ImportError> {
    let file = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let f = File::open(path).map_err(|e| ImportError::Io {
        file: file.clone(),
        message: e.to_string(),
    })?;
    Ok((BufReader::with_capacity(256 * 1024, f), file))
}

fn first_line(path: &Path) -> Result<String, ImportError> {
    let (mut r, file) = open(path)?;
    let mut s = String::new();
    r.read_line(&mut s).map_err(|e| ImportError::Io {
        file,
        message: e.to_string(),
    })?;
    Ok(s.trim_start_matches('\u{feff}').to_string())
}

pub fn inspect(path: &Path) -> Result<CsvInspection, ImportError> {
    let delim = detect_delimiter(&first_line(path)?);
    let (r, file) = open(path)?;
    let mut headers: Vec<String> = Vec::new();
    let mut sample = Vec::new();
    read_records(r, delim, |rec| {
        if headers.is_empty() {
            headers = rec;
            true
        } else {
            sample.push(rec);
            sample.len() < SAMPLE_ROWS
        }
    })
    .map_err(|e| ImportError::Io {
        file: file.clone(),
        message: e.to_string(),
    })?;
    if headers.is_empty() {
        return Err(ImportError::Empty { file });
    }
    let (lat_col, lon_col) = detect_columns(&headers);
    Ok(CsvInspection {
        headers,
        delimiter: (delim as char).to_string(),
        lat_col,
        lon_col,
        sample,
    })
}

/// Builds a point layer from the chosen columns. Rows with unusable coordinates are skipped and
/// counted in a warning; every other column becomes an attribute.
pub fn import(path: &Path, lat_col: usize, lon_col: usize) -> Result<LayerData, ImportError> {
    let delim = detect_delimiter(&first_line(path)?);
    let (r, file) = open(path)?;
    let stem = path
        .file_stem()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Points".into());
    let mut b = LayerBuilder::new(&stem);
    let mut headers: Vec<String> = Vec::new();
    let mut name_col: Option<usize> = None;
    let mut bad = 0u32;
    let mut header_error: Option<String> = None;

    read_records(r, delim, |rec| {
        if headers.is_empty() {
            if lat_col >= rec.len() || lon_col >= rec.len() || lat_col == lon_col {
                header_error = Some(format!(
                    "column {} / {} does not exist in the header",
                    lat_col + 1,
                    lon_col + 1
                ));
                return false;
            }
            name_col = rec
                .iter()
                .position(|h| matches!(norm(h).as_str(), "name" | "title" | "label"));
            headers = rec;
            return true;
        }
        let parse = |i: usize| {
            rec.get(i)
                .and_then(|v| v.trim().parse::<f64>().ok())
                .filter(|v| v.is_finite())
        };
        let (Some(lat), Some(lon)) = (parse(lat_col), parse(lon_col)) else {
            bad += 1;
            return true;
        };
        if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
            bad += 1;
            return true;
        }
        let name = name_col
            .and_then(|i| rec.get(i))
            .cloned()
            .unwrap_or_default();
        b.begin_feature(name, None, true, None);
        b.add_part(GEOM_POINT, &[lon, lat, 0.0], 0);
        for (i, v) in rec.iter().enumerate() {
            if i != lat_col
                && i != lon_col
                && !v.is_empty()
                && i < headers.len()
                && !headers[i].is_empty()
            {
                b.add_attr(&headers[i], v.clone());
            }
        }
        b.end_feature();
        true
    })
    .map_err(|e| ImportError::Io {
        file: file.clone(),
        message: e.to_string(),
    })?;

    if let Some(message) = header_error {
        return Err(ImportError::Parse {
            file,
            at: String::new(),
            message,
        });
    }
    if headers.is_empty() {
        return Err(ImportError::Empty { file });
    }
    if bad > 0 {
        b.warn_n(
            "Malformed coordinates",
            "Rows with a missing or invalid latitude/longitude were skipped",
            bad,
        );
    }
    Ok(b.finish(&path.to_string_lossy(), "csv", Resources::None))
}

/// Imports with the detected columns; used when no dialog is involved (e.g. tests, scripting).
pub fn import_auto(path: &Path) -> Result<LayerData, ImportError> {
    let i = inspect(path)?;
    match (i.lat_col, i.lon_col) {
        (Some(lat), Some(lon)) => import(path, lat, lon),
        _ => Err(ImportError::Parse {
            file: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            at: String::new(),
            message: "could not find latitude and longitude columns (looked for lat/latitude/y and lon/lng/longitude/x)".into(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn records(text: &str, delim: u8) -> Vec<Vec<String>> {
        let mut out = Vec::new();
        read_records(Cursor::new(text.as_bytes()), delim, |r| {
            out.push(r);
            true
        })
        .unwrap();
        out
    }

    fn temp(name: &str, content: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("groundwork-csvin-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn parses_quotes_escapes_and_line_breaks() {
        let r = records(
            "a,b,c\r\n1,\"x, y\",\"say \"\"hi\"\"\"\r\n\"multi\nline\",,3\r\n",
            b',',
        );
        assert_eq!(r[0], ["a", "b", "c"]);
        assert_eq!(r[1], ["1", "x, y", "say \"hi\""]);
        assert_eq!(r[2], ["multi\nline", "", "3"]);
        assert_eq!(r.len(), 3);
    }

    #[test]
    fn handles_bom_blank_lines_missing_final_newline_and_lf_endings() {
        let r = records("\u{feff}h1,h2\n\n1,2\n\n3,4", b',');
        assert_eq!(r, vec![vec!["h1", "h2"], vec!["1", "2"], vec!["3", "4"]]);
        let r = records("a;b\n1;2\n", b';');
        assert_eq!(r[1], ["1", "2"]);
    }

    #[test]
    fn detects_delimiters_outside_quotes() {
        assert_eq!(detect_delimiter("a,b,c"), b',');
        assert_eq!(detect_delimiter("a;b;c,d"), b';');
        assert_eq!(detect_delimiter("a\tb\tc"), b'\t');
        assert_eq!(detect_delimiter("\"a;b;c;d\",e"), b',');
        assert_eq!(detect_delimiter("single"), b',');
    }

    fn h(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn detects_common_column_names() {
        assert_eq!(
            detect_columns(&h(&["name", "lat", "lon"])),
            (Some(1), Some(2))
        );
        assert_eq!(
            detect_columns(&h(&["Latitude", "Longitude", "id"])),
            (Some(0), Some(1))
        );
        assert_eq!(detect_columns(&h(&["id", "Y", "X"])), (Some(1), Some(2)));
        assert_eq!(detect_columns(&h(&["lng", "LAT"])), (Some(1), Some(0)));
        // exact lat/lon beat y/x; prefixes are a fallback
        assert_eq!(
            detect_columns(&h(&["x", "y", "lat", "lon"])),
            (Some(2), Some(3))
        );
        assert_eq!(
            detect_columns(&h(&["Latitude (deg)", "Longitude (deg)"])),
            (Some(0), Some(1))
        );
        assert_eq!(detect_columns(&h(&["name", "city"])), (None, None));
    }

    #[test]
    fn inspects_header_delimiter_and_sample() {
        let p = temp("places.csv", "name;lat;lon;pop\nA;1;2;3\nB;4;5;6\n");
        let i = inspect(&p).unwrap();
        assert_eq!(i.delimiter, ";");
        assert_eq!(i.headers, ["name", "lat", "lon", "pop"]);
        assert_eq!((i.lat_col, i.lon_col), (Some(1), Some(2)));
        assert_eq!(i.sample.len(), 2);
    }

    #[test]
    fn imports_points_with_attributes_and_skips_bad_rows() {
        let p = temp(
            "cities.csv",
            "name,Lat,Lng,population,note\n\"Paris, FR\",48.85,2.35,2100000,\"capital\"\nBad,abc,1,5,x\nOut,95,10,1,x\nOslo,59.91,10.75,700000,\nShort,1\n",
        );
        let l = import_auto(&p).unwrap();
        assert_eq!(l.format, "csv");
        assert_eq!(l.name, "cities");
        assert_eq!(
            l.features
                .iter()
                .map(|f| f.name.as_str())
                .collect::<Vec<_>>(),
            ["Paris, FR", "Oslo"]
        );
        assert_eq!(l.part_coords(0), &[2.35, 48.85, 0.0]);
        let names: Vec<&str> = l.columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            ["name", "population", "note"],
            "lat/lon columns are not attributes"
        );
        assert_eq!(l.warnings[0].count, 3);
        assert_eq!(l.manifest("L1", 0).geometry_counts.points, 2);
    }

    #[test]
    fn explicit_columns_and_errors() {
        let p = temp("xy.csv", "id,a,b\n1,10,20\n2,11,21\n");
        let l = import(&p, 1, 2).unwrap(); // a=lat, b=lon chosen by the user
        assert_eq!(l.part_coords(1), &[21.0, 11.0, 0.0]);
        assert!(import(&p, 1, 1).unwrap_err().to_string().contains("xy.csv"));
        assert!(import(&p, 1, 9)
            .unwrap_err()
            .to_string()
            .contains("does not exist"));
        let e = import_auto(&p).unwrap_err().to_string();
        assert!(e.contains("could not find latitude"), "{e}");
        let empty = temp("empty.csv", "");
        assert!(inspect(&empty).unwrap_err().to_string().contains("empty"));
    }
}
