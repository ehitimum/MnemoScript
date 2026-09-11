mod project;

use project::{Document, Project, Registry};
use serde::Serialize;
use std::fs;
use tauri::ipc::{InvokeBody, Request};
use tauri::Manager;
use uuid::Uuid;

#[derive(Serialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

impl<T> ApiResponse<T> {
    fn success(data: T) -> Self {
        ApiResponse {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    fn error(error: String) -> Self {
        ApiResponse {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

/// Pick a directory to store a project in. Desktop only — on mobile, storage is
/// app-private and not user-selectable, so this returns `None` and the UI hides
/// the picker.
#[tauri::command]
fn select_directory() -> ApiResponse<Option<String>> {
    #[cfg(desktop)]
    {
        let folder = rfd::FileDialog::new().pick_folder();
        ApiResponse::success(folder.map(|p| p.to_string_lossy().to_string()))
    }
    #[cfg(not(desktop))]
    {
        ApiResponse::success(None)
    }
}

#[tauri::command]
fn open_project_by_path(path: String) -> ApiResponse<Project> {
    let path_buf = std::path::PathBuf::from(&path);
    match Project::load_from_path(&path_buf) {
        Ok(project) => ApiResponse::success(project),
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
fn create_project(
    name: String,
    description: Option<String>,
    path: Option<String>,
) -> ApiResponse<Project> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return ApiResponse::error("Project name cannot be empty".to_string());
    }
    let final_path = path.filter(|p| !p.trim().is_empty()).map(|p| {
        let mut pb = std::path::PathBuf::from(p.trim());
        pb.push(project::safe_dir_name(&name));
        pb.to_string_lossy().to_string()
    });

    let project = Project::new(name, description, final_path);
    match project.save() {
        Ok(()) => ApiResponse::success(project),
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
fn save_project(project: Project) -> ApiResponse<()> {
    match project.save() {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

/// Rename a project (metadata only — the folder on disk keeps its name so
/// nothing that references the path breaks).
#[tauri::command]
fn rename_project(project_id: String, name: String) -> ApiResponse<Project> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return ApiResponse::error("Project name cannot be empty".to_string());
    }
    match Project::load(&project_id) {
        Ok(mut project) => {
            project.name = name;
            match project.save() {
                Ok(()) => ApiResponse::success(project),
                Err(e) => ApiResponse::error(e),
            }
        }
        Err(e) => ApiResponse::error(e),
    }
}

/// Forget a project. With `delete_files` the whole project folder is removed
/// (guarded: only a folder that actually contains a project.json is deleted).
#[tauri::command]
fn delete_project(project_id: String, delete_files: Option<bool>) -> ApiResponse<()> {
    let dir = Project::resolve_dir(&project_id);
    if delete_files.unwrap_or(false) && dir.join("project.json").exists() {
        if let Err(e) = fs::remove_dir_all(&dir) {
            return ApiResponse::error(format!("Could not delete project folder: {e}"));
        }
    }
    match Registry::remove(&project_id) {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
fn load_project(project_id: String) -> ApiResponse<Project> {
    match Project::load(&project_id) {
        Ok(project) => ApiResponse::success(project),
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
fn list_projects() -> ApiResponse<Vec<Project>> {
    match Project::list() {
        Ok(projects) => ApiResponse::success(projects),
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
fn create_document(
    project_id: String,
    title: String,
    content: String,
    doc_type: Option<String>,
    order: Option<i32>,
) -> ApiResponse<Document> {
    let doc = Document::new(
        title,
        content,
        doc_type.unwrap_or_else(|| "text".to_string()),
        order.unwrap_or(0),
    );
    match doc.save(&project_id) {
        Ok(()) => ApiResponse::success(doc),
        Err(e) => ApiResponse::error(e),
    }
}

/// Read a header from a raw IPC request as a plain string.
fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

/// The bytes of a raw IPC request. Accepts the legacy JSON shape
/// (`{ bytes: number[] }`) too, so older callers keep working.
fn body_bytes(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(b) => Ok(b.clone()),
        InvokeBody::Json(v) => v
            .get("bytes")
            .and_then(|b| b.as_array())
            .map(|arr| arr.iter().filter_map(|n| n.as_u64()).map(|n| n as u8).collect())
            .ok_or_else(|| "Expected a binary body".to_string()),
    }
}

/// Keep only safe filename characters (no path separators / traversal).
fn safe_file_name(name: &str, fallback: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

/// Write image bytes into the project's `assets/` folder under a fresh uuid
/// name and return the absolute path. The bytes arrive as a *raw* IPC body
/// (headers `x-project-id` / `x-ext`), which is far cheaper than a JSON array.
/// Picking + reading happens in the frontend via the dialog/fs plugins so it
/// works on desktop *and* Android; this command only persists the bytes.
#[tauri::command]
fn save_asset(request: Request<'_>) -> ApiResponse<String> {
    let project_id = match header(&request, "x-project-id") {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return ApiResponse::error("Missing project id".to_string()),
    };
    let ext = header(&request, "x-ext").unwrap_or("png");
    let safe_ext: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(5)
        .collect::<String>()
        .to_lowercase();
    let safe_ext = if safe_ext.is_empty() { "png".to_string() } else { safe_ext };

    let bytes = match body_bytes(&request) {
        Ok(b) => b,
        Err(e) => return ApiResponse::error(e),
    };

    let assets_dir = Project::resolve_dir(&project_id).join("assets");
    if let Err(e) = fs::create_dir_all(&assets_dir) {
        return ApiResponse::error(e.to_string());
    }

    let dest = assets_dir.join(format!("{}.{}", Uuid::new_v4(), safe_ext));
    match fs::write(&dest, &bytes) {
        Ok(_) => ApiResponse::success(dest.to_string_lossy().to_string()),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

/// Write an exported file (e.g. a rendered map PNG) into `<project>/exports/`
/// and return its path. Raw body; headers `x-project-id` / `x-name`.
#[tauri::command]
fn export_file(request: Request<'_>) -> ApiResponse<String> {
    let project_id = match header(&request, "x-project-id") {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return ApiResponse::error("Missing project id".to_string()),
    };
    let name = safe_file_name(header(&request, "x-name").unwrap_or("export.png"), "export.png");
    let bytes = match body_bytes(&request) {
        Ok(b) => b,
        Err(e) => return ApiResponse::error(e),
    };
    let dir = Project::resolve_dir(&project_id).join("exports");
    if let Err(e) = fs::create_dir_all(&dir) {
        return ApiResponse::error(e.to_string());
    }
    let dest = dir.join(name);
    match fs::write(&dest, &bytes) {
        Ok(_) => ApiResponse::success(dest.to_string_lossy().to_string()),
        Err(e) => ApiResponse::error(e.to_string()),
    }
}

#[tauri::command]
fn save_document(project_id: String, document: Document) -> ApiResponse<()> {
    match document.save(&project_id) {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
fn delete_document(project_id: String, document_id: String) -> ApiResponse<()> {
    match Document::delete(&project_id, &document_id) {
        Ok(()) => ApiResponse::success(()),
        Err(e) => ApiResponse::error(e),
    }
}

#[tauri::command]
fn load_document(project_id: String, document_id: String) -> ApiResponse<Document> {
    match Document::load(&project_id, &document_id) {
        Ok(doc) => ApiResponse::success(doc),
        Err(e) => ApiResponse::error(e),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Choose the storage base dir: keep desktop data where it has always
            // lived; on mobile use the app-private data dir (the only writable
            // location). Resolved here so the rest of the backend stays platform
            // agnostic.
            let base: std::path::PathBuf = if cfg!(any(target_os = "android", target_os = "ios")) {
                app.path()
                    .app_data_dir()
                    .map_err(|e| format!("no app data dir: {e}"))?
            } else {
                dirs::home_dir()
                    .ok_or("Could not find home directory")?
                    .join(".mnemoscript")
            };
            fs::create_dir_all(&base).ok();
            project::init_data_dir(base);

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_project,
            save_project,
            rename_project,
            delete_project,
            load_project,
            list_projects,
            create_document,
            save_document,
            load_document,
            delete_document,
            save_asset,
            export_file,
            select_directory,
            open_project_by_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::safe_file_name;

    #[test]
    fn safe_file_name_keeps_ordinary_names() {
        assert_eq!(safe_file_name("My Map.png", "x.png"), "My Map.png");
        assert_eq!(safe_file_name("world-2_v3.png", "x.png"), "world-2_v3.png");
    }

    #[test]
    fn safe_file_name_neutralises_path_traversal_and_falls_back_when_empty() {
        assert_eq!(safe_file_name("../evil/../x.png", "x.png"), "_evil_.._x.png");
        assert_eq!(safe_file_name("...", "export.png"), "export.png");
        assert_eq!(safe_file_name("", "export.png"), "export.png");
    }
}
