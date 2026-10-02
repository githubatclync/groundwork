// Import benchmark: runs each file through the same code path as the `import_file` and
// `get_geometry` commands and prints timings. Usage: cargo run --release --example bench -- <files...>
use std::time::Instant;

use groundwork_lib::attributes::{build_view, ColumnFilter, FilterOp, SortSpec, ViewSpec};
use groundwork_lib::binary::encode_geometry;
use groundwork_lib::import::import_path;
use groundwork_lib::layer::ColumnType;

fn main() {
    let files: Vec<String> = std::env::args().skip(1).collect();
    if files.is_empty() {
        eprintln!("usage: bench <file>...");
        std::process::exit(2);
    }
    println!(
        "{:<18} {:>9} {:>10} {:>10} {:>9} {:>9} {:>9}",
        "file", "MB", "features", "vertices", "import", "encode", "binary MB"
    );
    for f in files {
        let size = std::fs::metadata(&f)
            .map(|m| m.len() as f64 / 1e6)
            .unwrap_or(0.0);
        let name = std::path::Path::new(&f)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or(f.clone());
        let t = Instant::now();
        match import_path(&f) {
            Ok(layer) => {
                let import = t.elapsed();
                let t = Instant::now();
                let bytes = encode_geometry(&layer);
                let encode = t.elapsed();
                let manifest = layer.manifest("L1", 0);
                let warn: u32 = manifest.warnings.iter().map(|w| w.count).sum();
                println!(
                    "{:<18} {:>9.1} {:>10} {:>10} {:>8.2}s {:>8.2}s {:>9.1}  warnings:{}",
                    name,
                    size,
                    layer.features.len(),
                    layer.vertex_count(),
                    import.as_secs_f64(),
                    encode.as_secs_f64(),
                    bytes.len() as f64 / 1e6,
                    warn
                );
                // Attribute table operations (sorting and filtering run in Rust).

                let timed = |label: &str, spec: ViewSpec| {
                    let t = Instant::now();

                    let n = build_view(&layer, &spec).len();

                    println!(
                        "    {label:<34} {:>7.1} ms  ({n} rows)",
                        t.elapsed().as_secs_f64() * 1000.0
                    );
                };

                if let Some(num) = layer.columns.iter().find(|c| c.ty == ColumnType::Number) {
                    timed(
                        &format!("sort by {} (number)", num.name),
                        ViewSpec {
                            sort: Some(SortSpec {
                                column: num.name.clone(),
                                desc: true,
                            }),
                            ..Default::default()
                        },
                    );

                    timed(
                        &format!("filter {} > 100", num.name),
                        ViewSpec {
                            filters: vec![ColumnFilter {
                                column: num.name.clone(),
                                op: FilterOp::Gt,
                                value: "100".into(),
                            }],
                            ..Default::default()
                        },
                    );
                }

                if let Some(s) = layer.columns.iter().find(|c| c.ty == ColumnType::String) {
                    timed(
                        &format!("sort by {} (text)", s.name),
                        ViewSpec {
                            sort: Some(SortSpec {
                                column: s.name.clone(),
                                desc: false,
                            }),
                            ..Default::default()
                        },
                    );
                }

                timed(
                    "global filter \"ab\"",
                    ViewSpec {
                        global: Some("ab".into()),
                        ..Default::default()
                    },
                );
            }

            Err(e) => println!("{name}: ERROR {e}"),
        }
    }
}
