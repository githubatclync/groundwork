// Groundwork backend: Tauri app setup. Importers, MBTiles, and commands are added per milestone.

/// Starts the Tauri application.
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Groundwork");
}

#[cfg(test)]
mod tests {
    #[test]
    fn scaffold_compiles() {
        assert_eq!(2 + 2, 4);
    }
}
