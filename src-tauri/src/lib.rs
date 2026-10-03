// Groundwork backend: Tauri app setup and the importer library (also used by the bench example).
pub mod attributes;
pub mod binary;
pub mod commands;
pub mod csv;
pub mod export;
pub mod geo;
pub mod geojson;
pub mod gpx;
pub mod import;
pub mod kml;
pub mod layer;
mod mbtiles;
pub mod style;

/// Starts the Tauri application.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(mbtiles::MbtilesState::default())
        .manage(commands::LayerStore::default())
        .register_uri_scheme_protocol("mbtiles", mbtiles::handle_request)
        .register_uri_scheme_protocol("kmz", commands::handle_kmz)
        .invoke_handler(tauri::generate_handler![
            mbtiles::open_mbtiles,
            mbtiles::close_mbtiles,
            commands::import_file,
            commands::get_geometry,
            commands::get_attributes,
            commands::find_row,
            commands::get_feature,
            commands::get_launch_files,
            commands::export_csv,
            commands::save_png,
            commands::export_layer_file,
            commands::export_user_layer,
            commands::layer_to_user,
            commands::remove_layer
        ])
        .run(tauri::generate_context!())
        .expect("error while running Groundwork");
}
