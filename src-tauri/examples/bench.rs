// Import benchmark: runs each file through the same code path as the `import_file` and
// `get_geometry` commands and prints timings. Usage: cargo run --release --example bench -- <files...>
use std::time::Instant;

use groundwork_lib::binary::encode_geometry;
use groundwork_lib::import::import_path;

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
            }
            Err(e) => println!("{name}: ERROR {e}"),
        }
    }
}
