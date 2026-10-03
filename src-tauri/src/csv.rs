// CSV export of the attribute table: the name followed by every attribute column, for either the
// current filtered/sorted view or all rows. RFC 4180 quoting; a UTF-8 byte-order mark is written
// first so Excel reads non-ASCII text correctly. Output streams, so 200k+ rows are fine.
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use serde::Serialize;

use crate::attributes::{view_for, ViewSpec};
use crate::layer::LayerData;

#[derive(Debug, thiserror::Error)]
pub enum CsvError {
    #[error("Unknown layer \"{0}\"")]
    UnknownLayer(String),
    #[error("Could not write \"{file}\": {message}")]
    Io { file: String, message: String },
}

impl Serialize for CsvError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvReport {
    pub path: String,
    pub rows: usize,
}

/// Quotes a field if it contains a comma, quote, or line break; doubles embedded quotes.
fn field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) || s.starts_with(' ') || s.ends_with(' ') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Writes the header and one line per feature id in `view` (CRLF line endings, per RFC 4180).
pub fn write_csv<W: Write>(l: &LayerData, view: &[u32], w: &mut W) -> std::io::Result<()> {
    w.write_all(b"\xEF\xBB\xBF")?;
    let mut header = vec!["Name".to_string()];
    header.extend(l.columns.iter().map(|c| field(&c.name)));
    write!(w, "{}\r\n", header.join(","))?;
    let mut cells: Vec<&str> = vec![""; l.columns.len() + 1];
    for &id in view {
        let f = &l.features[id as usize];
        cells.iter_mut().for_each(|c| *c = "");
        cells[0] = &f.name;
        for (col, v) in &f.attrs {
            cells[*col as usize + 1] = v;
        }
        let line: Vec<String> = cells.iter().map(|c| field(c)).collect();
        write!(w, "{}\r\n", line.join(","))?;
    }
    Ok(())
}

/// Exports the rows of `spec`'s view, or every row in file order when `spec` is None.
pub fn export_csv(
    l: &LayerData,
    spec: Option<&ViewSpec>,
    path: &Path,
) -> Result<CsvReport, CsvError> {
    let io = |e: std::io::Error| CsvError::Io {
        file: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        message: e.to_string(),
    };
    let all: Vec<u32>;
    let view: std::sync::Arc<Vec<u32>>;
    let ids: &[u32] = match spec {
        Some(s) => {
            view = view_for(l, s);
            &view
        }
        None => {
            all = (0..l.features.len() as u32).collect();
            &all
        }
    };
    let mut w = BufWriter::new(File::create(path).map_err(io)?);
    write_csv(l, ids, &mut w).map_err(io)?;
    w.flush().map_err(io)?;
    Ok(CsvReport {
        path: path.display().to_string(),
        rows: ids.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attributes::{ColumnFilter, FilterOp, SortSpec};
    use crate::import::parse_kml_str;

    fn layer() -> LayerData {
        parse_kml_str(
            r#"<kml><Document>
          <Placemark><name>Plain</name><ExtendedData><Data name="note"><value>hello</value></Data><Data name="n"><value>3</value></Data></ExtendedData><Point><coordinates>0,0</coordinates></Point></Placemark>
          <Placemark><name>Has, comma</name><ExtendedData><Data name="note"><value>say "hi"
and bye</value></Data></ExtendedData><Point><coordinates>1,1</coordinates></Point></Placemark>
          <Placemark><name>Ünïcode ✓</name><ExtendedData><Data name="n"><value>10</value></Data></ExtendedData><Point><coordinates>2,2</coordinates></Point></Placemark>
        </Document></kml>"#,
        )
        .unwrap()
    }

    fn csv(l: &LayerData, view: &[u32]) -> String {
        let mut buf = Vec::new();
        write_csv(l, view, &mut buf).unwrap();
        String::from_utf8(buf).unwrap()
    }

    #[test]
    fn writes_bom_header_and_quotes_special_fields() {
        let l = layer();
        let text = csv(&l, &[0, 1, 2]);
        assert!(text.starts_with('\u{feff}'), "UTF-8 BOM first");
        let body = text.trim_start_matches('\u{feff}');
        let mut lines = body.split("\r\n");
        assert_eq!(lines.next().unwrap(), "Name,note,n");
        assert_eq!(lines.next().unwrap(), "Plain,hello,3");
        // A comma forces quotes; embedded quotes are doubled; a line break stays inside the quotes.
        assert_eq!(
            lines.next().unwrap(),
            "\"Has, comma\",\"say \"\"hi\"\"\nand bye\","
        );
        assert_eq!(lines.next().unwrap(), "Ünïcode ✓,,10"); // missing cells are empty
        assert_eq!(lines.next().unwrap(), "");
    }

    #[test]
    fn a_view_controls_rows_and_order() {
        let l = layer();
        let spec = ViewSpec {
            sort: Some(SortSpec {
                column: "n".into(),
                desc: true,
            }),
            filters: vec![ColumnFilter {
                column: "n".into(),
                op: FilterOp::Gt,
                value: "0".into(),
            }],
            ..Default::default()
        };
        let view = crate::attributes::build_view(&l, &spec);
        let body = csv(&l, &view);
        let rows: Vec<&str> = body
            .trim_start_matches('\u{feff}')
            .split("\r\n")
            .filter(|s| !s.is_empty())
            .collect();
        assert_eq!(rows, ["Name,note,n", "Ünïcode ✓,,10", "Plain,hello,3"]);
    }

    #[test]
    fn exports_to_a_file_for_a_view_or_all_rows() {
        let l = layer();
        let dir = std::env::temp_dir().join(format!("groundwork-csv-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let all = export_csv(&l, None, &dir.join("all.csv")).unwrap();
        assert_eq!(all.rows, 3);
        let spec = ViewSpec {
            global: Some("plain".into()),
            ..Default::default()
        };
        let some = export_csv(&l, Some(&spec), &dir.join("some.csv")).unwrap();
        assert_eq!(some.rows, 1);
        let text = std::fs::read_to_string(dir.join("some.csv")).unwrap();
        assert!(text.contains("Plain,hello,3") && !text.contains("comma"));
        let e = export_csv(&l, None, Path::new("C:/no/such/dir/x.csv"))
            .unwrap_err()
            .to_string();
        assert!(e.contains("x.csv"), "{e}");
    }

    #[test]
    fn fields_with_edge_whitespace_are_quoted() {
        assert_eq!(field(" lead"), "\" lead\"");
        assert_eq!(field("trail "), "\"trail \"");
        assert_eq!(field("plain"), "plain");
        assert_eq!(field(""), "");
    }
}
