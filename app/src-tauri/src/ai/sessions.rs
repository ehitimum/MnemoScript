//! AI chat sessions live inside the project they belong to:
//! `<project>/ai/sessions/<session-id>.json`. Keeping them in the project folder means project A
//! never sees project B's sessions, and they move/back up together with the manuscript.
//!
//! The session schema is owned by the frontend (`lib/ai/types.ts` → `AiSession`); the backend only
//! validates the id, writes atomically and extracts a small summary for the session list.
use crate::project::{write_atomic, Project};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub provider: String,
    /// Every model that has answered in this session, newest first.
    pub models: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
}

/// Session ids become file names: allow only a safe, bounded character set.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn sessions_dir_in(project_dir: &Path) -> PathBuf {
    project_dir.join("ai").join("sessions")
}

fn str_field(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or_default().to_string()
}

fn summarise(v: &Value) -> Option<SessionSummary> {
    let id = str_field(v, "id");
    if !valid_id(&id) {
        return None;
    }
    Some(SessionSummary {
        title: str_field(v, "title"),
        provider: str_field(v, "provider"),
        models: v
            .get("models")
            .and_then(|m| m.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
        created_at: str_field(v, "createdAt"),
        updated_at: str_field(v, "updatedAt"),
        message_count: v.get("messages").and_then(|m| m.as_array()).map_or(0, |a| a.len()),
        id,
    })
}

pub fn list_in(project_dir: &Path) -> Result<Vec<SessionSummary>, String> {
    let dir = sessions_dir_in(project_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // One unreadable or corrupt session must never hide the others.
        let parsed = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| summarise(&v));
        match parsed {
            Some(s) => out.push(s),
            None => log::warn!("skipping unreadable AI session {}", path.display()),
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

pub fn load_in(project_dir: &Path, session_id: &str) -> Result<Value, String> {
    if !valid_id(session_id) {
        return Err("Invalid session id".into());
    }
    let path = sessions_dir_in(project_dir).join(format!("{session_id}.json"));
    let s = fs::read_to_string(&path).map_err(|_| "This AI session no longer exists".to_string())?;
    serde_json::from_str(&s).map_err(|e| format!("AI session file is damaged: {e}"))
}

pub fn save_in(project_dir: &Path, session: &Value) -> Result<(), String> {
    let id = str_field(session, "id");
    if !valid_id(&id) {
        return Err("Invalid session id".into());
    }
    let json = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    write_atomic(&sessions_dir_in(project_dir).join(format!("{id}.json")), &json)
}

pub fn delete_in(project_dir: &Path, session_id: &str) -> Result<(), String> {
    if !valid_id(session_id) {
        return Err("Invalid session id".into());
    }
    let path = sessions_dir_in(project_dir).join(format!("{session_id}.json"));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Project-id based entry points used by the Tauri commands.
pub fn list(project_id: &str) -> Result<Vec<SessionSummary>, String> {
    list_in(&Project::resolve_dir(project_id))
}
pub fn load(project_id: &str, session_id: &str) -> Result<Value, String> {
    load_in(&Project::resolve_dir(project_id), session_id)
}
pub fn save(project_id: &str, session: &Value) -> Result<(), String> {
    save_in(&Project::resolve_dir(project_id), session)
}
pub fn delete(project_id: &str, session_id: &str) -> Result<(), String> {
    delete_in(&Project::resolve_dir(project_id), session_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("mnemo-ai-sessions-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn session(id: &str, updated: &str) -> Value {
        json!({
            "id": id, "title": "Chapter 3 pacing", "provider": "claude-code",
            "models": ["claude-sonnet-5", "gpt-5"], "createdAt": "2026-11-01T00:00:00Z",
            "updatedAt": updated, "messages": [{"role": "user"}, {"role": "assistant"}],
        })
    }

    #[test]
    fn sessions_round_trip_and_list_newest_first() {
        let dir = tmp();
        save_in(&dir, &session("a", "2026-11-02T00:00:00Z")).unwrap();
        save_in(&dir, &session("b", "2026-11-05T00:00:00Z")).unwrap();
        let list = list_in(&dir).unwrap();
        assert_eq!(list.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        assert_eq!(list[0].message_count, 2);
        assert_eq!(list[0].models, ["claude-sonnet-5", "gpt-5"]);
        assert_eq!(load_in(&dir, "a").unwrap()["title"], "Chapter 3 pacing");
        delete_in(&dir, "a").unwrap();
        delete_in(&dir, "a").unwrap(); // idempotent
        assert_eq!(list_in(&dir).unwrap().len(), 1);
    }

    #[test]
    fn sessions_are_scoped_to_their_own_project_folder() {
        let (a, b) = (tmp(), tmp());
        save_in(&a, &session("only-in-a", "2026-11-02T00:00:00Z")).unwrap();
        assert_eq!(list_in(&a).unwrap().len(), 1);
        assert!(list_in(&b).unwrap().is_empty());
        assert!(load_in(&b, "only-in-a").is_err());
    }

    #[test]
    fn unsafe_ids_are_rejected_and_corrupt_files_skipped() {
        let dir = tmp();
        assert!(save_in(&dir, &json!({"id": "../escape"})).is_err());
        assert!(load_in(&dir, "..\\x").is_err());
        assert!(delete_in(&dir, "a/b").is_err());
        save_in(&dir, &session("good", "2026-11-02T00:00:00Z")).unwrap();
        fs::write(sessions_dir_in(&dir).join("broken.json"), "{not json").unwrap();
        assert_eq!(list_in(&dir).unwrap().len(), 1);
    }
}
