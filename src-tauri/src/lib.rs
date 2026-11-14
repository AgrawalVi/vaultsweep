pub mod analysis;
pub mod commands;
pub mod parsers;
pub mod merger;
pub mod hibp;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(analysis::AnalysisState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::parser::parse_csvs,
            commands::parser::merge_entries,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
