use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use uuid::Uuid;

/// Base directory under which the registry and all projects live. Initialised
/// once at startup (see `init_data_dir`) from Tauri's path resolver:
///   • desktop → `~/.mnemoscript` (keeps existing data in place)
///   • mobile  → the app-private data dir (the only writable location on Android)
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Set the storage base dir. Called from the Tauri `setup` hook before any
/// command runs. Idempotent — only the first value is kept.
pub fn init_data_dir(dir: PathBuf) {
    let _ = DATA_DIR.set(dir);
}

/// Write a file atomically: the content goes to a sibling `*.tmp` first and is
/// then renamed over the target, so a crash or power loss mid-write can never
/// leave a half-written (corrupt) project or document file behind.
pub fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    // Unique temp name: Tauri runs commands concurrently, so two writers of the
    // same file must never share a temp file (one would rename the other's away).
    let tmp = path.with_file_name(format!("{file_name}.{}.tmp", Uuid::new_v4()));
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

/// A filesystem-safe folder name derived from a project name.
pub fn safe_dir_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | ' ' | '.') { c } else { '_' })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    if cleaned.is_empty() {
        "project".to_string()
    } else {
        cleaned
    }
}

/// The storage base dir. Falls back to `~/.mnemoscript` only if init was somehow
/// skipped (e.g. unit tests), so paths are always well-defined.
fn data_dir() -> PathBuf {
    DATA_DIR.get().cloned().unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.join(".mnemoscript"))
            .unwrap_or_else(|| PathBuf::from("."))
    })
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub documents: Vec<Document>,
    /// Directory tree (e.g. "Volume 1"). Documents reference a folder via `folder_id`.
    /// Persisted in project.json (documents are reloaded from disk; folders are not).
    #[serde(default)]
    pub folders: Vec<Folder>,
}

fn default_doc_type() -> String {
    "text".to_string()
}

/// A directory in the explorer tree. `parent_id == None` means it lives at the
/// project root; otherwise it nests inside another folder (any depth).
#[derive(Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub order: i32,
    #[serde(default, rename = "parentId")]
    pub parent_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub content: String,
    pub updated_at: String,
    /// "text" (rich-text chapter) or "mindmap" (React Flow {nodes,edges} JSON in `content`).
    #[serde(default = "default_doc_type", rename = "docType")]
    pub doc_type: String,
    /// Ordering index for the sidebar / PDF book compiler.
    #[serde(default)]
    pub order: i32,
    /// Id of the containing folder, or `None` when the document sits at the
    /// project root. Lets chapters be grouped into / moved between directories.
    #[serde(default, rename = "folderId")]
    pub folder_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub path: String,
}

pub struct Registry;

/// The registry is a read-modify-write file shared by every project; serialise
/// mutations so two concurrent saves can't drop each other's entry.
static REGISTRY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

impl Registry {
    fn registry_path() -> PathBuf {
        data_dir().join("registry.json")
    }

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        REGISTRY_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn list() -> Vec<RegistryEntry> {
        let path = Self::registry_path();
        if !path.exists() {
            return Vec::new();
        }
        let json = match fs::read_to_string(&path) {
            Ok(j) => j,
            Err(_) => return Vec::new(),
        };
        serde_json::from_str(&json).unwrap_or_else(|_| Vec::new())
    }

    pub fn add(project: &Project) -> Result<(), String> {
        let _guard = Self::lock();
        let mut entries = Self::list();
        let path_str = project.get_dir().to_string_lossy().to_string();
        
        // Remove existing entry with same ID if present
        entries.retain(|e| e.id != project.id);
        
        entries.push(RegistryEntry {
            id: project.id.clone(),
            name: project.name.clone(),
            description: project.description.clone(),
            created_at: project.created_at.clone(),
            path: path_str,
        });

        Self::write(&entries)
    }

    /// Drop a project from the registry (its files are left untouched).
    pub fn remove(project_id: &str) -> Result<(), String> {
        let _guard = Self::lock();
        let mut entries = Self::list();
        entries.retain(|e| e.id != project_id);
        Self::write(&entries)
    }

    fn write(entries: &[RegistryEntry]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
        write_atomic(&Self::registry_path(), &json)
    }

    pub fn get_path(project_id: &str) -> Option<String> {
        let entries = Self::list();
        entries.into_iter().find(|e| e.id == project_id).map(|e| e.path)
    }
}

impl Project {
    pub fn new(name: String, description: Option<String>, path: Option<String>) -> Self {
        let id = Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        Project {
            id,
            name,
            description,
            created_at,
            author: None,
            path,
            documents: Vec::new(),
            folders: Vec::new(),
        }
    }

    pub fn get_dir(&self) -> PathBuf {
        if let Some(ref p) = self.path {
            Path::new(p).to_path_buf()
        } else {
            Self::projects_dir().join(&self.id)
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let project_dir = self.get_dir();
        fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;

        // project.json holds metadata + folders + a *content-free* document
        // index. Each document's body lives only in documents/<id>.json (the
        // source of truth), so the metadata file stays tiny no matter how big
        // the book gets and `list_projects` never has to parse whole chapters.
        let snapshot = Project {
            documents: self
                .documents
                .iter()
                .map(|d| Document {
                    content: String::new(),
                    ..d.clone()
                })
                .collect(),
            ..self.clone()
        };
        let metadata_path = project_dir.join("project.json");
        let metadata_json = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
        write_atomic(&metadata_path, &metadata_json)?;

        // Add to global project registry
        Registry::add(self)?;

        Ok(())
    }

    pub fn load(project_id: &str) -> Result<Self, String> {
        let project_dir = if let Some(path_str) = Registry::get_path(project_id) {
            PathBuf::from(path_str)
        } else {
            Self::projects_dir().join(project_id)
        };
        Self::load_from_path(&project_dir)
    }

    pub fn load_from_path(project_dir: &Path) -> Result<Self, String> {
        let metadata_path = project_dir.join("project.json");
        let metadata_json = fs::read_to_string(&metadata_path).map_err(|e| e.to_string())?;
        let mut project: Project =
            serde_json::from_str(&metadata_json).map_err(|e| e.to_string())?;
        
        // Ensure path is set to the folder we loaded it from
        project.path = Some(project_dir.to_string_lossy().to_string());
        project.documents = Self::load_documents_from_dir(project_dir)?;
        
        // Make sure it's in the registry
        Registry::add(&project)?;
        
        Ok(project)
    }

    fn load_documents_from_dir(project_dir: &Path) -> Result<Vec<Document>, String> {
        let doc_dir = project_dir.join("documents");
        if !doc_dir.exists() {
            return Ok(Vec::new());
        }
        let mut documents = Vec::new();
        for entry in fs::read_dir(doc_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                // One corrupt file must not make the whole project unopenable.
                let doc_json = match fs::read_to_string(&path) {
                    Ok(j) => j,
                    Err(e) => {
                        log::warn!("skipping unreadable document {}: {e}", path.display());
                        continue;
                    }
                };
                match serde_json::from_str::<Document>(&doc_json) {
                    Ok(doc) => documents.push(doc),
                    Err(e) => log::warn!("skipping corrupt document {}: {e}", path.display()),
                }
            }
        }
        // Order by explicit index first, then fall back to updated time.
        documents.sort_by(|a, b| a.order.cmp(&b.order).then(a.updated_at.cmp(&b.updated_at)));
        Ok(documents)
    }

    pub fn list() -> Result<Vec<Project>, String> {
        let entries = Registry::list();
        let mut projects = Vec::new();
        for entry in entries {
            let project_dir = Path::new(&entry.path);
            if project_dir.exists() {
                let metadata_path = project_dir.join("project.json");
                if metadata_path.exists() {
                    if let Ok(metadata_json) = fs::read_to_string(metadata_path) {
                        if let Ok(mut project) = serde_json::from_str::<Project>(&metadata_json) {
                            project.path = Some(entry.path.clone());
                            projects.push(project);
                        }
                    }
                }
            }
        }
        Ok(projects)
    }

    pub fn projects_dir() -> PathBuf {
        data_dir().join("projects")
    }

    /// Resolve the on-disk directory for a project id, preferring the registered
    /// custom path and falling back to the default app storage location.
    pub fn resolve_dir(project_id: &str) -> PathBuf {
        if let Some(path_str) = Registry::get_path(project_id) {
            PathBuf::from(path_str)
        } else {
            Self::projects_dir().join(project_id)
        }
    }
}

impl Document {
    pub fn new(title: String, content: String, doc_type: String, order: i32) -> Self {
        let id = Uuid::new_v4().to_string();
        let updated_at = chrono::Utc::now().to_rfc3339();
        Document {
            id,
            title,
            content,
            updated_at,
            doc_type,
            order,
            folder_id: None,
        }
    }

    pub fn save(&self, project_id: &str) -> Result<(), String> {
        let project_dir = Project::resolve_dir(project_id);

        let doc_dir = project_dir.join("documents");
        fs::create_dir_all(&doc_dir).map_err(|e| e.to_string())?;
        let doc_path = doc_dir.join(format!("{}.json", self.id));
        let doc_json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        write_atomic(&doc_path, &doc_json)
    }

    pub fn load(project_id: &str, document_id: &str) -> Result<Self, String> {
        let project_dir = Project::resolve_dir(project_id);

        let doc_path = project_dir
            .join("documents")
            .join(format!("{}.json", document_id));
        let doc_json = fs::read_to_string(doc_path).map_err(|e| e.to_string())?;
        let doc: Document = serde_json::from_str(&doc_json).map_err(|e| e.to_string())?;
        Ok(doc)
    }

    /// Remove a document's `.json` file from disk. Missing files are treated as
    /// already-deleted (no error).
    pub fn delete(project_id: &str, document_id: &str) -> Result<(), String> {
        let project_dir = Project::resolve_dir(project_id);
        let doc_path = project_dir
            .join("documents")
            .join(format!("{}.json", document_id));
        if doc_path.exists() {
            fs::remove_file(doc_path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    static INIT: Once = Once::new();

    /// A throw-away data dir shared by every test in this binary (the OnceLock
    /// only accepts the first value, so all tests use one base and unique names).
    fn base_dir() -> PathBuf {
        let base = std::env::temp_dir().join(format!("mnemoscript-tests-{}", std::process::id()));
        INIT.call_once(|| {
            let _ = fs::remove_dir_all(&base);
            fs::create_dir_all(&base).unwrap();
            init_data_dir(base.clone());
        });
        base
    }

    fn project_in(name: &str) -> (Project, PathBuf) {
        let dir = base_dir().join(format!("{name}-{}", Uuid::new_v4()));
        let project = Project::new(name.to_string(), None, Some(dir.to_string_lossy().to_string()));
        project.save().unwrap();
        (project, dir)
    }

    #[test]
    fn write_atomic_replaces_content_and_leaves_no_temp_file() {
        let dir = base_dir().join(format!("atomic-{}", Uuid::new_v4()));
        let path = dir.join("file.json");
        write_atomic(&path, "one").unwrap();
        write_atomic(&path, "two").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        assert!(!dir.join("file.json.tmp").exists());
    }

    #[test]
    fn safe_dir_name_strips_path_characters() {
        assert_eq!(safe_dir_name("The Ashen: Crown/2"), "The Ashen_ Crown_2");
        assert_eq!(safe_dir_name("  ..  "), "project");
        assert_eq!(safe_dir_name(""), "project");
    }

    #[test]
    fn project_round_trip_keeps_document_bodies_out_of_project_json() {
        let (mut project, dir) = project_in("round-trip");
        let doc = Document::new("Chapter 1".into(), "<p>Hello</p>".into(), "text".into(), 0);
        doc.save(&project.id).unwrap();
        project.documents = vec![doc.clone()];
        project.folders = vec![Folder { id: "f1".into(), name: "Part".into(), order: 0, parent_id: None }];
        project.save().unwrap();

        let meta: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
        assert_eq!(meta["documents"][0]["content"], "");
        assert_eq!(meta["documents"][0]["title"], "Chapter 1");

        let loaded = Project::load(&project.id).unwrap();
        assert_eq!(loaded.documents.len(), 1);
        assert_eq!(loaded.documents[0].content, "<p>Hello</p>");
        assert_eq!(loaded.documents[0].doc_type, "text");
        assert_eq!(loaded.folders[0].name, "Part");
        assert_eq!(loaded.path.as_deref(), Some(dir.to_string_lossy().as_ref()));
    }

    #[test]
    fn registry_lists_and_forgets_projects_without_touching_files() {
        let (project, dir) = project_in("registry");
        assert!(Project::list().unwrap().iter().any(|p| p.id == project.id));
        assert_eq!(Registry::get_path(&project.id).as_deref(), Some(dir.to_string_lossy().as_ref()));
        Registry::remove(&project.id).unwrap();
        assert!(!Project::list().unwrap().iter().any(|p| p.id == project.id));
        assert!(dir.join("project.json").exists(), "forgetting must not delete files");
    }

    #[test]
    fn a_corrupt_document_file_does_not_block_the_project() {
        let (project, dir) = project_in("corrupt");
        Document::new("Good".into(), "ok".into(), "text".into(), 0).save(&project.id).unwrap();
        fs::write(dir.join("documents").join("bad.json"), "{ not json").unwrap();
        fs::write(dir.join("documents").join("stray.json.tmp"), "").unwrap();
        let loaded = Project::load(&project.id).unwrap();
        assert_eq!(loaded.documents.len(), 1);
        assert_eq!(loaded.documents[0].title, "Good");
    }

    #[test]
    fn documents_sort_by_order_and_delete_is_idempotent() {
        let (project, _dir) = project_in("order");
        let second = Document::new("Second".into(), String::new(), "text".into(), 2);
        let first = Document::new("First".into(), String::new(), "text".into(), 1);
        second.save(&project.id).unwrap();
        first.save(&project.id).unwrap();
        let titles: Vec<String> = Project::load(&project.id).unwrap().documents.into_iter().map(|d| d.title).collect();
        assert_eq!(titles, vec!["First".to_string(), "Second".to_string()]);
        Document::delete(&project.id, &first.id).unwrap();
        Document::delete(&project.id, &first.id).unwrap(); // already gone: still Ok
        assert_eq!(Project::load(&project.id).unwrap().documents.len(), 1);
    }

    #[test]
    fn legacy_project_json_without_new_fields_still_loads() {
        let dir = base_dir().join(format!("legacy-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("project.json"),
            r#"{"id":"legacy-1","name":"Old","description":null,"created_at":"2026-01-01T00:00:00Z"}"#,
        )
        .unwrap();
        let loaded = Project::load_from_path(&dir).unwrap();
        assert_eq!(loaded.name, "Old");
        assert!(loaded.folders.is_empty());
        assert!(loaded.documents.is_empty());
        assert_eq!(loaded.author, None);
    }

    #[test]
    fn document_load_reports_missing_files() {
        let (project, _dir) = project_in("missing");
        assert!(Document::load(&project.id, "nope").is_err());
    }

    #[test]
    fn concurrent_saves_keep_every_registry_entry() {
        let base = base_dir();
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let dir = base.join(format!("concurrent-{i}-{}", Uuid::new_v4()));
                std::thread::spawn(move || {
                    let p = Project::new(format!("Concurrent {i}"), None, Some(dir.to_string_lossy().to_string()));
                    p.save().unwrap();
                    p.id
                })
            })
            .collect();
        let ids: Vec<String> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let listed = Registry::list();
        for id in &ids {
            assert!(listed.iter().any(|e| &e.id == id), "entry {id} was lost by a concurrent write");
        }
    }
}
