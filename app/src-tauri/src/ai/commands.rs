//! Tauri commands for the AI assistant. Same `ApiResponse` envelope as the project commands.
use super::engine::{self, Turn};
use super::sessions::{self, SessionSummary};
use super::types::{AiEvent, ToolOutcome, TurnRequest};
use super::secrets;
use crate::ApiResponse;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;
use tauri::ipc::Channel;

fn wrap<T>(r: Result<T, String>) -> ApiResponse<T> {
    match r {
        Ok(v) => ApiResponse::success(v),
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
pub fn list_ai_sessions(project_id: String) -> ApiResponse<Vec<SessionSummary>> {
    wrap(sessions::list(&project_id))
}

#[tauri::command]
pub fn load_ai_session(project_id: String, session_id: String) -> ApiResponse<Value> {
    wrap(sessions::load(&project_id, &session_id))
}

#[tauri::command]
pub fn save_ai_session(project_id: String, session: Value) -> ApiResponse<()> {
    wrap(sessions::save(&project_id, &session))
}

#[tauri::command]
pub fn delete_ai_session(project_id: String, session_id: String) -> ApiResponse<()> {
    wrap(sessions::delete(&project_id, &session_id))
}

/// Which API-key providers have a key saved. Keys themselves are never returned.
#[tauri::command]
pub fn ai_key_status() -> ApiResponse<BTreeMap<String, bool>> {
    ApiResponse::success(secrets::status())
}

#[tauri::command]
pub fn ai_set_api_key(provider: String, key: String) -> ApiResponse<()> {
    wrap(secrets::set(&provider, &key))
}

#[tauri::command]
pub fn ai_clear_api_key(provider: String) -> ApiResponse<()> {
    wrap(secrets::clear(&provider))
}

/// Claude Code CLI: installed / signed in / plan. Always "not installed" on phones.
#[tauri::command]
pub async fn ai_cli_status() -> ApiResponse<Value> {
    #[cfg(desktop)]
    let status = serde_json::to_value(super::claude_code::status().await).unwrap_or(Value::Null);
    #[cfg(not(desktop))]
    let status = serde_json::json!({ "installed": false, "loggedIn": false });
    ApiResponse::success(status)
}

/// Start a turn; events stream over `on_event` until a terminal `done` / `error` event.
#[tauri::command]
pub fn ai_start_turn(request: TurnRequest, on_event: Channel<AiEvent>) -> ApiResponse<()> {
    let sink: engine::Sink = Arc::new(move |e| {
        let _ = on_event.send(e);
    });
    match Turn::register(&request.turn_id, sink) {
        Ok(turn) => {
            tauri::async_runtime::spawn(engine::run_turn(turn, request));
            ApiResponse::success(())
        }
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
pub fn ai_tool_result(turn_id: String, call_id: String, content: String, is_error: bool) -> ApiResponse<()> {
    wrap(engine::resolve_tool(&turn_id, &call_id, ToolOutcome { content, is_error }))
}

#[tauri::command]
pub fn ai_cancel_turn(turn_id: String) -> ApiResponse<bool> {
    ApiResponse::success(engine::cancel(&turn_id))
}
