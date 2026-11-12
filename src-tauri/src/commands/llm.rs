use crate::llm::client::{LlmClient, OllamaClient, OllamaState, OllamaStatus, DEFAULT_MODEL};

/// Is the local model server up, and is the model installed?
///
/// Always succeeds at the Tauri boundary: "not running" is an ordinary state
/// the setup screen shows, not an error.
#[tauri::command]
pub async fn ollama_status() -> OllamaStatus {
    match OllamaClient::new(DEFAULT_MODEL) {
        Ok(client) => client.status().await,
        Err(_) => OllamaStatus {
            state: OllamaState::Unreachable,
            model: DEFAULT_MODEL.to_string(),
            installed_models: Vec::new(),
        },
    }
}
