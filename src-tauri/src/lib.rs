// Groundwork backend: Tauri app setup. Importers and commands are added per milestone.
mod mbtiles;

/// Starts the Tauri application.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(mbtiles::MbtilesState::default())
        .register_uri_scheme_protocol("mbtiles", mbtiles::handle_request)
        .invoke_handler(tauri::generate_handler![mbtiles::open_mbtiles, mbtiles::close_mbtiles])
        .run(tauri::generate_context!())
        .expect("error while running Groundwork");
}
