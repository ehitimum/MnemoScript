use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

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
}

fn default_doc_type() -> String {
    "text".to_string()
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

impl Registry {
    fn registry_path() -> PathBuf {
        let home = dirs::home_dir().expect("Could not find home directory");
        home.join(".mnemoscript").join("registry.json")
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

        let json = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
        let reg_path = Self::registry_path();
        if let Some(parent) = reg_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(reg_path, json).map_err(|e| e.to_string())?;
        Ok(())
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

        let metadata_path = project_dir.join("project.json");
        let metadata_json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(metadata_path, metadata_json).map_err(|e| e.to_string())?;
        
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
                let doc_json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
                let doc: Document = serde_json::from_str(&doc_json).map_err(|e| e.to_string())?;
                documents.push(doc);
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
        let home = dirs::home_dir().expect("Could not find home directory");
        home.join(".mnemoscript").join("projects")
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
        }
    }

    pub fn save(&self, project_id: &str) -> Result<(), String> {
        let project_dir = Project::resolve_dir(project_id);

        let doc_dir = project_dir.join("documents");
        fs::create_dir_all(&doc_dir).map_err(|e| e.to_string())?;
        let doc_path = doc_dir.join(format!("{}.json", self.id));
        let doc_json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(doc_path, doc_json).map_err(|e| e.to_string())?;
        Ok(())
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
}
