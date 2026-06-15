mod project;

use project::{Document, Project};
use serde::Serialize;
use std::fs;
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

#[tauri::command]
fn select_directory() -> ApiResponse<Option<String>> {
    let folder = rfd::FileDialog::new().pick_folder();
    ApiResponse::success(folder.map(|p| p.to_string_lossy().to_string()))
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

/// Open a native image picker, copy the chosen file into the project's
/// `assets/` folder under a fresh uuid name, and return its absolute path.
/// The frontend renders it through Tauri's asset protocol (`convertFileSrc`).
#[tauri::command]
fn import_image(project_id: String) -> ApiResponse<Option<String>> {
    let picked = rfd::FileDialog::new()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"])
        .pick_file();

    let source = match picked {
        Some(p) => p,
        None => return ApiResponse::success(None), // user cancelled
    };

    let ext = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let assets_dir = Project::resolve_dir(&project_id).join("assets");
    if let Err(e) = fs::create_dir_all(&assets_dir) {
        return ApiResponse::error(e.to_string());
    }

    let dest = assets_dir.join(format!("{}.{}", Uuid::new_v4(), ext));
    match fs::copy(&source, &dest) {
        Ok(_) => ApiResponse::success(Some(dest.to_string_lossy().to_string())),
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
fn load_document(project_id: String, document_id: String) -> ApiResponse<Document> {
    match Document::load(&project_id, &document_id) {
        Ok(doc) => ApiResponse::success(doc),
        Err(e) => ApiResponse::error(e),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
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
            import_image,
            select_directory,
            open_project_by_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
