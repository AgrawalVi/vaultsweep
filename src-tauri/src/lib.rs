pub mod commands;
pub mod parsers;
pub mod merger;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::parser::parse_csvs,
            commands::parser::merge_entries,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
