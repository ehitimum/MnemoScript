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

/// Plan usage report from the writer's Claude Code (`/usage`; free, answered by the CLI).
#[tauri::command]
pub async fn ai_cli_usage() -> ApiResponse<Value> {
    #[cfg(desktop)]
    let r = super::claude_code::usage().await;
    #[cfg(not(desktop))]
    let r: Result<String, String> = Err("Claude Code is not available on this device.".into());
    match r {
        Ok(text) => ApiResponse::success(serde_json::json!({ "text": text })),
        Err(e) => ApiResponse::error(e),
    }
}

// ── Phone pairing: PC side (desktop) ─────────────────────────────────────────

#[tauri::command]
pub fn ai_pairing_state() -> ApiResponse<Value> {
    #[cfg(desktop)]
    return ApiResponse::success(super::pair_server::global().state());
    #[cfg(not(desktop))]
    ApiResponse::error("Phone pairing is set up on the PC.".into())
}

#[tauri::command]
#[allow(clippy::needless_return)] // desktop / phone split by cfg
pub fn ai_pairing_enable(enabled: bool) -> ApiResponse<Value> {
    #[cfg(desktop)]
    {
        let s = super::pair_server::global();
        return match s.set_enabled(enabled) {
            Ok(()) => ApiResponse::success(s.state()),
            Err(e) => ApiResponse::error(e),
        };
    }
    #[cfg(not(desktop))]
    {
        let _ = enabled;
        ApiResponse::error("Phone pairing is set up on the PC.".into())
    }
}

#[tauri::command]
#[allow(clippy::needless_return)] // desktop / phone split by cfg
pub fn ai_pairing_open() -> ApiResponse<Value> {
    #[cfg(desktop)]
    {
        let s = super::pair_server::global();
        if !s.is_enabled() {
            return ApiResponse::error("Turn on phone pairing first.".into());
        }
        s.open_window();
        return ApiResponse::success(s.state());
    }
    #[cfg(not(desktop))]
    ApiResponse::error("Phone pairing is set up on the PC.".into())
}

#[tauri::command]
#[allow(clippy::needless_return)] // desktop / phone split by cfg
pub fn ai_pairing_close() -> ApiResponse<Value> {
    #[cfg(desktop)]
    {
        let s = super::pair_server::global();
        s.close_window();
        return ApiResponse::success(s.state());
    }
    #[cfg(not(desktop))]
    ApiResponse::error("Phone pairing is set up on the PC.".into())
}

#[tauri::command]
#[allow(clippy::needless_return)] // desktop / phone split by cfg
pub fn ai_pairing_remove(device_id: String) -> ApiResponse<Value> {
    #[cfg(desktop)]
    {
        let s = super::pair_server::global();
        s.remove_device(&device_id);
        return ApiResponse::success(s.state());
    }
    #[cfg(not(desktop))]
    {
        let _ = device_id;
        ApiResponse::error("Phone pairing is set up on the PC.".into())
    }
}

// ── Phone pairing: phone side (any platform; the UI offers it on phones) ─────

#[tauri::command]
pub async fn ai_pair_discover() -> ApiResponse<Value> {
    let found = tauri::async_runtime::spawn_blocking(|| super::pair_client::discover(std::time::Duration::from_millis(1800), &[]))
        .await
        .unwrap_or_default();
    ApiResponse::success(serde_json::to_value(found).unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn ai_pair_connect(host: String, code: String, device_name: String) -> ApiResponse<Value> {
    match super::pair_client::pair_and_save(&host, &code, &device_name).await {
        Ok(pc) => ApiResponse::success(serde_json::json!({ "pcName": pc.pc_name, "host": pc.host })),
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
pub async fn ai_pair_check() -> ApiResponse<Value> {
    ApiResponse::success(super::pair_client::check().await)
}

#[tauri::command]
pub async fn ai_pair_usage() -> ApiResponse<Value> {
    match super::pair_client::usage().await {
        Ok(text) => ApiResponse::success(serde_json::json!({ "text": text })),
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
pub fn ai_pair_forget() -> ApiResponse<()> {
    wrap(super::pair_client::forget())
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
