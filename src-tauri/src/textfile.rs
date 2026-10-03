// Small text-file helpers for project files (.groundwork.json). The frontend has no general file
// access, so these commands do the reading and writing, with a size cap on reads.
use std::path::Path;

use serde::Serialize;

/// Project files are small; refuse to load anything absurdly large.
pub const MAX_TEXT_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TextFileError {
    #[error("Could not read \"{file}\": {message}")]
    Read { file: String, message: String },
    #[error("Could not write \"{file}\": {message}")]
    Write { file: String, message: String },
    #[error("\"{0}\" is too large to open as a project")]
    TooLarge(String),
}

impl Serialize for TextFileError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

fn name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

pub fn read_text(path: &Path) -> Result<String, TextFileError> {
    let meta = std::fs::metadata(path).map_err(|e| TextFileError::Read {
        file: name(path),
        message: e.to_string(),
    })?;
    if meta.len() > MAX_TEXT_BYTES {
        return Err(TextFileError::TooLarge(name(path)));
    }
    let text = std::fs::read_to_string(path).map_err(|e| TextFileError::Read {
        file: name(path),
        message: e.to_string(),
    })?;
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

/// Writes via a temporary file in the same folder, then renames, so a crash cannot leave a
/// half-written project behind.
pub fn write_text(path: &Path, contents: &str) -> Result<(), TextFileError> {
    let err = |e: std::io::Error| TextFileError::Write {
        file: name(path),
        message: e.to_string(),
    };
    let tmp = path.with_extension("tmp-write");
    std::fs::write(&tmp, contents).map_err(err)?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        err(e)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("groundwork-text-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn round_trips_and_strips_a_bom() {
        let p = dir().join("a.groundwork.json");
        write_text(&p, "{\"x\":1}").unwrap();
        assert_eq!(read_text(&p).unwrap(), "{\"x\":1}");
        std::fs::write(&p, "\u{feff}{\"y\":2}").unwrap();
        assert_eq!(read_text(&p).unwrap(), "{\"y\":2}");
        assert!(!p.with_extension("tmp-write").exists());
    }

    #[test]
    fn overwrites_atomically_and_reports_errors_readably() {
        let p = dir().join("b.groundwork.json");
        write_text(&p, "one").unwrap();
        write_text(&p, "two").unwrap();
        assert_eq!(read_text(&p).unwrap(), "two");
        let e = read_text(Path::new("C:/no/such/file.json"))
            .unwrap_err()
            .to_string();
        assert!(e.contains("file.json"), "{e}");
        let e = write_text(Path::new("C:/no/such/dir/x.json"), "x")
            .unwrap_err()
            .to_string();
        assert!(e.contains("x.json"), "{e}");
    }
}
