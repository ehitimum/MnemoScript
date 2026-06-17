mod project;

use project::{Document, Project};
use serde::Serialize;
use std::fs;
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
    let final_path = if let Some(ref p) = path {
        let mut pb = std::path::PathBuf::from(p);
        pb.push(&name);
        Some(pb.to_string_lossy().to_string())
    } else {
        None
    };

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

/// Write already-read image bytes into the project's `assets/` folder under a
/// fresh uuid name and return the absolute path. The picking + reading happens
/// in the frontend via the dialog/fs plugins (so it works on desktop *and*
/// Android, where files arrive as content URIs); this command just persists the
/// bytes. The frontend renders the path through Tauri's asset protocol.
#[tauri::command]
fn save_asset(project_id: String, ext: String, bytes: Vec<u8>) -> ApiResponse<String> {
    let safe_ext: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(5)
        .collect::<String>()
        .to_lowercase();
    let safe_ext = if safe_ext.is_empty() { "png".to_string() } else { safe_ext };

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
            load_project,
            list_projects,
            create_document,
            save_document,
            load_document,
            delete_document,
            save_asset,
            select_directory,
            open_project_by_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
