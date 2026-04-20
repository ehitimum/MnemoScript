use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub documents: Vec<Document>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub content: String,
    pub updated_at: String,
}

impl Project {
    pub fn new(name: String) -> Self {
        let id = Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        Project {
            id,
            name,
            created_at,
            documents: Vec::new(),
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let base_dir = Self::projects_dir();
        let project_dir = base_dir.join(&self.id);
        fs::create_dir_all(&project_dir).map_err(|e| e.to_string())?;

        let metadata_path = project_dir.join("project.json");
        let metadata_json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(metadata_path, metadata_json).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load(project_id: &str) -> Result<Self, String> {
        let project_dir = Self::projects_dir().join(project_id);
        let metadata_path = project_dir.join("project.json");
        let metadata_json = fs::read_to_string(metadata_path).map_err(|e| e.to_string())?;
        let mut project: Project = serde_json::from_str(&metadata_json).map_err(|e| e.to_string())?;
        project.documents = Self::load_documents(project_id)?;
        Ok(project)
    }

    fn load_documents(project_id: &str) -> Result<Vec<Document>, String> {
        let doc_dir = Self::projects_dir().join(project_id).join("documents");
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
        Ok(documents)
    }

    pub fn list() -> Result<Vec<Project>, String> {
        let base_dir = Self::projects_dir();
        if !base_dir.exists() {
            return Ok(Vec::new());
        }
        let mut projects = Vec::new();
        for entry in fs::read_dir(base_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                let metadata_path = path.join("project.json");
                if metadata_path.exists() {
                    let metadata_json = fs::read_to_string(metadata_path).map_err(|e| e.to_string())?;
                    let project: Project = serde_json::from_str(&metadata_json).map_err(|e| e.to_string())?;
                    projects.push(project);
                }
            }
        }
        Ok(projects)
    }

    fn projects_dir() -> std::path::PathBuf {
        let home = dirs::home_dir().expect("Could not find home directory");
        home.join(".mnemoscript").join("projects")
    }
}

impl Document {
    pub fn new(title: String, content: String) -> Self {
        let id = Uuid::new_v4().to_string();
        let updated_at = chrono::Utc::now().to_rfc3339();
        Document {
            id,
            title,
            content,
            updated_at,
        }
    }

    pub fn save(&self, project_id: &str) -> Result<(), String> {
        let doc_dir = Project::projects_dir().join(project_id).join("documents");
        fs::create_dir_all(&doc_dir).map_err(|e| e.to_string())?;
        let doc_path = doc_dir.join(format!("{}.json", self.id));
        let doc_json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(doc_path, doc_json).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load(project_id: &str, document_id: &str) -> Result<Self, String> {
        let doc_path = Project::projects_dir()
            .join(project_id)
            .join("documents")
            .join(format!("{}.json", document_id));
        let doc_json = fs::read_to_string(doc_path).map_err(|e| e.to_string())?;
        let doc: Document = serde_json::from_str(&doc_json).map_err(|e| e.to_string())?;
        Ok(doc)
    }
}