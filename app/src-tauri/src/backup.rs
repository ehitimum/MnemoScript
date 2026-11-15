//! Local recovery only. Archives are not sync batches and confer no device trust.
use crate::project::{Document, Project};
use lol_html::{element, rewrite_str, RewriteStrSettings};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const MANIFEST: &str = "mnemoscript-backup.json";
const MAX_FILES: usize = 10_000;
const MAX_FILE: u64 = 128 * 1024 * 1024;
const MAX_TOTAL: u64 = 512 * 1024 * 1024;
pub const MAX_ARCHIVE: u64 = 600 * 1024 * 1024;
const MAX_MANIFEST: u64 = 4 * 1024 * 1024;
const SCHEMA: u32 = 2;
/// Portable image reference inside archives: `mnemo-asset:<file in assets/>` (as MnemoSync uses).
const ASSET_SCHEME: &str = "mnemo-asset:";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format: String,
    schema_version: u32,
    project_id: String,
    /// Schema 1 only: the source folder, used to relocate absolute image paths. Schema 2 archives
    /// carry portable `mnemo-asset:` references and never record where the project lived.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_root: Option<String>,
    /// Schema 2: chapter files that could not be read when the backup was made, copied as-is.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    damaged: Vec<String>,
    files: BTreeMap<String, FileDigest>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileDigest {
    size: u64,
    sha256: String,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

// Deliberately stricter than the host OS: backups must also be safe on Windows.
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 1024
        && name.split('/').all(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with(['.', ' '])
                && !part
                    .chars()
                    .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
                && !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
}

fn allowed(name: &str) -> bool {
    if !safe_name(name) {
        return false;
    }
    let parts: Vec<_> = name.split('/').collect();
    match parts.as_slice() {
        ["project.json"] => true,
        ["documents", file] | ["ai", "sessions", file] => file.ends_with(".json"),
        ["assets", ..] | ["exports", ..] => parts.len() > 1,
        _ => false,
    }
}

fn bounded_read(reader: impl Read, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > limit {
        return Err("Backup size limit exceeded".into());
    }
    Ok(bytes)
}

fn collect(root: &Path, dir: &Path, out: &mut BTreeMap<String, FileDigest>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(err)?
            .to_str()
            .ok_or("Backup requires UTF-8 file names")?
            .replace('\\', "/");
        let kind = fs::symlink_metadata(&path).map_err(err)?;
        // Never follow links, junctions or other reparse points into private data.
        #[cfg(windows)]
        let reparse = {
            use std::os::windows::fs::MetadataExt;
            kind.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let reparse = kind.file_type().is_symlink();
        if reparse {
            return Err(format!("Backup cannot include linked files: {relative}"));
        }
        if kind.is_dir() {
            if matches!(
                relative.as_str(),
                "documents" | "assets" | "exports" | "ai" | "ai/sessions"
            ) || relative.starts_with("assets/")
                || relative.starts_with("exports/")
            {
                if !safe_name(&relative) {
                    return Err("Unsafe backup folder name".into());
                }
                collect(root, &path, out)?;
            }
        } else if allowed(&relative) {
            if !kind.is_file() {
                return Err("Backup contains a special file".into());
            }
            if out.len() >= MAX_FILES {
                return Err("Too many backup files".into());
            }
            let bytes = bounded_read(File::open(&path).map_err(err)?, MAX_FILE)?;
            out.insert(
                relative,
                FileDigest {
                    size: bytes.len() as u64,
                    sha256: hash(&bytes),
                },
            );
            if out.values().map(|d| d.size).sum::<u64>() > MAX_TOTAL {
                return Err("Project exceeds the 512 MiB backup limit".into());
            }
        }
    }
    Ok(())
}

fn inventory(root: &Path) -> Result<BTreeMap<String, FileDigest>, String> {
    let mut files = BTreeMap::new();
    collect(root, root, &mut files)?;
    if !files.contains_key("project.json") {
        return Err("Not a project folder".into());
    }
    let mut unique = HashSet::new();
    if files.keys().any(|p| !unique.insert(p.to_lowercase())) {
        return Err("Backup contains case-colliding paths".into());
    }
    Ok(files)
}

/// How a document refers to an image or map file.
enum Reference {
    /// Inside this project's `assets/` folder: the path relative to the project, e.g. `assets/a.png`.
    Project(String),
    /// A local file elsewhere on this device (or an app-internal URL to one).
    External,
    /// Anything else (web images, data URLs, prose): left alone.
    Other,
}

fn classify(value: &str, root: &str) -> Reference {
    let normalized = value.replace('\\', "/");
    let root = root.replace('\\', "/");
    let root = root.trim_start_matches("//?/").trim_end_matches('/');
    let path = normalized.trim_start_matches("//?/");
    let prefix = format!("{root}/");
    let windows = root.as_bytes().get(1) == Some(&b':');
    let relative = path
        .strip_prefix(&prefix)
        .or_else(|| {
            (windows && path.get(..prefix.len()).is_some_and(|s| s.eq_ignore_ascii_case(&prefix)))
                .then(|| &path[prefix.len()..])
        })
        .or_else(|| path.starts_with("assets/").then_some(path));
    if let Some(relative) = relative {
        return if relative.to_ascii_lowercase().starts_with("assets/") && safe_name(relative) {
            Reference::Project(relative.to_string())
        } else {
            Reference::External
        };
    }
    let local = path.starts_with('/')
        || path.as_bytes().get(1) == Some(&b':')
        || path.starts_with("asset:")
        || path.starts_with("file:")
        || path.starts_with("blob:")
        || path.starts_with("http://asset.localhost/")
        || path.starts_with("https://asset.localhost/");
    if local {
        Reference::External
    } else {
        Reference::Other
    }
}

/// Schema 1 restore: relocate an absolute path from the source machine. Strict, as before.
fn asset_reference(
    value: &str,
    old_root: &str,
    new_root: &Path,
    files: &BTreeMap<String, FileDigest>,
) -> Result<Option<String>, String> {
    let windows_source = old_root.replace('\\', "/").trim_start_matches("//?/").as_bytes().get(1) == Some(&b':');
    match classify(value, old_root) {
        Reference::Project(relative) => {
            let actual = files
                .keys()
                .find(|name| **name == relative || (windows_source && name.eq_ignore_ascii_case(&relative)))
                .ok_or("A document references a missing project asset")?;
            Ok(Some(new_root.join(actual).to_string_lossy().into_owned()))
        }
        Reference::External => {
            Err("A document references an external local asset; import it into this project before backup".into())
        }
        Reference::Other => Ok(None),
    }
}

/// Apply `map` to every image reference of a document (`<img src>` in chapters, the path keys
/// of map JSON). Unknown fields, marks, graph ids and prose stay untouched.
fn rewrite_references(
    document: &mut Value,
    map: &dyn Fn(&str) -> Result<Option<String>, String>,
) -> Result<(), String> {
    let content = document["content"].as_str().ok_or("Missing document content")?;
    let mapped = match document.get("docType").and_then(Value::as_str).unwrap_or("text") {
        "text" => rewrite_str(
            content,
            RewriteStrSettings::new().append_element_content_handler(element!("img[src]", |el| {
                let raw_src = el.get_attribute("src").unwrap_or_default();
                let src = html_escape::decode_html_entities(&raw_src);
                if let Some(mapped) = map(&src)? {
                    el.set_attribute("src", &html_escape::encode_double_quoted_attribute(&mapped))?;
                }
                Ok(())
            })),
        )
        .map_err(err)?,
        _ => {
            let mut graph: Value = serde_json::from_str(content).map_err(|_| "Damaged map document")?;
            remap_json(&mut graph, map)?;
            serde_json::to_string(&graph).map_err(err)?
        }
    };
    document["content"] = Value::String(mapped);
    Ok(())
}

fn remap_json(value: &mut Value, map: &dyn Fn(&str) -> Result<Option<String>, String>) -> Result<(), String> {
    match value {
        Value::Object(fields) => {
            for (key, value) in fields {
                if matches!(key.as_str(), "assetPath" | "imagePath" | "bakedAssetPath") {
                    if let Some(path) = value.as_str() {
                        if let Some(mapped) = map(path)? {
                            *value = Value::String(mapped);
                        }
                    }
                } else {
                    remap_json(value, map)?;
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                remap_json(item, map)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Folder tree and project identity: a backup of a project with these broken is refused.
fn validate_structure(project: &Project) -> Result<HashSet<String>, String> {
    if Uuid::parse_str(&project.id).is_err() {
        return Err("Invalid project identity".into());
    }
    let folder_ids: HashSet<String> = project.folders.iter().map(|f| f.id.clone()).collect();
    if folder_ids.len() != project.folders.len() {
        return Err("Duplicate folder identity".into());
    }
    for folder in &project.folders {
        let mut visited = HashSet::from([folder.id.as_str()]);
        let mut parent = folder.parent_id.as_deref();
        while let Some(id) = parent {
            if !visited.insert(id) {
                return Err("Folder cycle in backup".into());
            }
            parent = project
                .folders
                .iter()
                .find(|f| f.id == id)
                .ok_or("Missing parent folder in backup")?
                .parent_id
                .as_deref();
        }
    }
    Ok(folder_ids)
}

/// A valid chapter/map file, or why it is not one.
fn check_document(bytes: &[u8], name: &str, folder_ids: &HashSet<String>) -> Result<Document, &'static str> {
    let document: Document = serde_json::from_slice(bytes).map_err(|_| "unreadable")?;
    if *name != format!("documents/{}.json", document.id) {
        return Err("its id does not match its file name");
    }
    if !matches!(document.doc_type.as_str(), "text" | "mindmap" | "fantasymap") {
        return Err("unknown document type");
    }
    if document.folder_id.as_ref().is_some_and(|id| !folder_ids.contains(id)) {
        return Err("its folder is missing");
    }
    Ok(document)
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// File-backed, bounded ZIP writer. Source files are never modified. Image references become
/// portable (`mnemo-asset:<file>`), so the archive never records where the project lived.
///
/// Everything valid is backed up; problems are returned as warnings instead of blocking the
/// backup (a project with a damaged chapter is the one that most needs one): damaged chapter
/// files are copied as they are, and images outside the project or missing are named.
pub fn export_in(root: &Path, destination: &Path) -> Result<Vec<String>, String> {
    let root = root.canonicalize().map_err(err)?;
    let root_text = root.to_string_lossy().into_owned();
    let disk = inventory(&root)?;
    let project: Project = serde_json::from_slice(&fs::read(root.join("project.json")).map_err(err)?)
        .map_err(|_| "The project file (project.json) is damaged")?;
    let folder_ids = validate_structure(&project)?;

    let mut warnings = Vec::new();
    let mut damaged = Vec::new();
    let mut rewritten: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let outside = std::cell::RefCell::new(BTreeSet::new());
    let missing = std::cell::RefCell::new(BTreeSet::new());
    let windows = root_text.replace('\\', "/").trim_start_matches("//?/").as_bytes().get(1) == Some(&b':');
    let to_portable = |value: &str| -> Result<Option<String>, String> {
        match classify(value, &root_text) {
            Reference::Project(relative) => {
                let actual = disk
                    .keys()
                    .find(|name| **name == relative || (windows && name.eq_ignore_ascii_case(&relative)))
                    .cloned();
                if actual.is_none() {
                    missing.borrow_mut().insert(relative.to_lowercase());
                }
                let file = actual.unwrap_or(relative);
                Ok(Some(format!("{ASSET_SCHEME}{}", &file["assets/".len()..])))
            }
            Reference::External => {
                outside.borrow_mut().insert(value.to_string());
                Ok(None)
            }
            Reference::Other => Ok(None),
        }
    };
    let mut on_disk = HashSet::new();
    for name in disk.keys().filter(|p| p.starts_with("documents/")) {
        let bytes = bounded_read(File::open(root.join(name)).map_err(err)?, MAX_FILE)?;
        match check_document(&bytes, name, &folder_ids) {
            Ok(document) => {
                on_disk.insert(document.id);
                let mut value: Value = serde_json::from_slice(&bytes).map_err(err)?;
                if rewrite_references(&mut value, &to_portable).is_err() {
                    damaged.push(name.clone());
                    warnings.push(format!("\"{}\" has damaged content and was copied as it is.", value["title"].as_str().unwrap_or(name)));
                    continue;
                }
                rewritten.insert(name.clone(), serde_json::to_vec_pretty(&value).map_err(err)?);
            }
            Err(why) => {
                damaged.push(name.clone());
                let reason = if why == "unreadable" { String::new() } else { format!(" ({why})") };
                warnings.push(format!("{} could not be read{reason} and was copied as it is.", &name["documents/".len()..]));
            }
        }
    }
    let unlisted = project.documents.iter().filter(|d| !on_disk.contains(&d.id)).count();
    if unlisted > damaged.len() {
        warnings.push(format!("{} listed in the project file {} not found on disk.", plural(unlisted - damaged.len(), "chapter", "chapters"), if unlisted - damaged.len() == 1 { "was" } else { "were" }));
    }
    let (outside, missing) = (outside.into_inner().len(), missing.into_inner().len());
    if outside > 0 {
        warnings.push(format!("{} outside this project {} not included. Import {} into the project to back {} up.", plural(outside, "image", "images"), if outside == 1 { "was" } else { "were" }, if outside == 1 { "it" } else { "them" }, if outside == 1 { "it" } else { "them" }));
    }
    if missing > 0 {
        warnings.push(format!("{} missing from the project's assets folder.", plural(missing, "image is", "images are")));
    }

    let files: BTreeMap<String, FileDigest> = disk
        .iter()
        .map(|(name, digest)| {
            let digest = match rewritten.get(name) {
                Some(bytes) => FileDigest { size: bytes.len() as u64, sha256: hash(bytes) },
                None => FileDigest { size: digest.size, sha256: digest.sha256.clone() },
            };
            (name.clone(), digest)
        })
        .collect();
    let manifest = Manifest {
        format: "mnemoscript-project-backup".into(),
        schema_version: SCHEMA,
        project_id: project.id,
        source_root: None,
        damaged,
        files,
    };
    // create_new prevents overwriting an archive or an existing manuscript file.
    let file = File::options().write(true).read(true).create_new(true).open(destination).map_err(err)?;
    let result = (|| {
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for name in manifest.files.keys() {
            let bytes = match rewritten.get(name) {
                Some(bytes) => bytes.clone(),
                None => {
                    let bytes = bounded_read(File::open(root.join(name)).map_err(err)?, MAX_FILE)?;
                    if hash(&bytes) != disk[name].sha256 {
                        return Err("Project changed during backup; try again".to_string());
                    }
                    bytes
                }
            };
            zip.start_file(name, options).map_err(err)?;
            zip.write_all(&bytes).map_err(err)?;
        }
        let bytes = serde_json::to_vec_pretty(&manifest).map_err(err)?;
        if bytes.len() as u64 > MAX_MANIFEST {
            return Err("Backup manifest too large".into());
        }
        zip.start_file(MANIFEST, options).map_err(err)?;
        zip.write_all(&bytes).map_err(err)?;
        zip.finish().map_err(err)?.sync_all().map_err(err)?;
        // Catch concurrent saves, deletions and additions rather than silently mixing snapshots.
        let after = inventory(&root)?;
        if after.len() != disk.len() || after.iter().any(|(name, digest)| disk.get(name).is_none_or(|old| old.sha256 != digest.sha256)) {
            return Err("Project changed during backup; try again".into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result.map(|()| warnings)
}

/// Verify every entry before activation. Only a private, newly created stage is written.
fn extract<R: Read + Seek>(source: R, stage: &Path) -> Result<Manifest, String> {
    let mut zip = ZipArchive::new(source).map_err(err)?;
    if zip.len() > MAX_FILES + 1 {
        return Err("Too many backup files".into());
    }
    let manifest = read_manifest(&mut zip)?;
    if manifest.format != "mnemoscript-project-backup" || !matches!(manifest.schema_version, 1 | SCHEMA) {
        return Err("Unsupported backup format; update MnemoScript".into());
    }
    // Schema 1 relocates absolute paths from its source folder; schema 2 never records one.
    if (manifest.schema_version == 1) != manifest.source_root.is_some()
        || (manifest.schema_version == 1 && !manifest.damaged.is_empty())
    {
        return Err("Invalid backup manifest".into());
    }
    if manifest.files.len() > MAX_FILES
        || zip.len() != manifest.files.len() + 1
        || !manifest.files.contains_key("project.json")
        || manifest.damaged.iter().any(|d| !d.starts_with("documents/") || !manifest.files.contains_key(d))
    {
        return Err("Backup file list does not match its manifest".into());
    }
    let mut total = 0_u64;
    for (name, digest) in &manifest.files {
        if !allowed(name) || digest.size > MAX_FILE || digest.sha256.len() != 64 {
            return Err("Invalid backup manifest entry".into());
        }
        total = total.checked_add(digest.size).ok_or("Backup size overflow")?;
        if total > MAX_TOTAL {
            return Err("Backup exceeds the 512 MiB limit".into());
        }
    }
    let mut seen = HashSet::new();
    for index in 0..zip.len() {
        let file = zip.by_index(index).map_err(err)?;
        let name = file.name().map_err(err)?.into_owned();
        if !safe_name(&name)
            || !seen.insert(name.to_lowercase())
            || file.is_dir()
            || file.unix_mode().is_some_and(|mode| mode & 0o170000 != 0 && mode & 0o170000 != 0o100000)
        {
            return Err("Unsafe or duplicate backup path".into());
        }
        if name == MANIFEST {
            continue;
        }
        let digest = manifest.files.get(&name).ok_or("Unexpected file in backup")?;
        if file.size() != digest.size {
            return Err("Backup size mismatch".into());
        }
        let bytes = bounded_read(file, digest.size)?;
        if bytes.len() as u64 != digest.size || hash(&bytes) != digest.sha256 {
            return Err(format!("Backup checksum mismatch: {name}"));
        }
        let path = stage.join(&name);
        fs::create_dir_all(path.parent().ok_or("Missing parent")?).map_err(err)?;
        let mut output = File::options().write(true).create_new(true).open(path).map_err(err)?;
        output.write_all(&bytes).map_err(err)?;
        output.sync_all().map_err(err)?;
    }
    Ok(manifest)
}

fn read_manifest<R: Read + Seek>(zip: &mut ZipArchive<R>) -> Result<Manifest, String> {
    let file = zip.by_name(MANIFEST).map_err(|_| "Not a MnemoScript recovery archive")?;
    serde_json::from_slice(&bounded_read(file, MAX_MANIFEST)?).map_err(err)
}

/// Restore as an independent copy; never overwrite or unregister a source project.
///
/// Strict where it protects the writer: every file's size and checksum, safe paths, the folder
/// tree, and every chapter that was valid when backed up. Chapter files the backup itself
/// recorded as damaged are restored as they are, so the backup stays restorable.
pub fn restore_in<R: Read + Seek>(source: R, projects_dir: &Path) -> Result<Project, String> {
    fs::create_dir_all(projects_dir).map_err(err)?;
    let id = Uuid::new_v4().to_string();
    let stage = projects_dir.join(format!(".restore-{id}"));
    let destination = projects_dir.join(&id);
    fs::create_dir(&stage).map_err(err)?;
    let result = (|| {
        let manifest = extract(source, &stage)?;
        let path = stage.join("project.json");
        let mut value: Value = serde_json::from_slice(&fs::read(&path).map_err(err)?).map_err(err)?;
        let project: Project = serde_json::from_value(value.clone()).map_err(err)?;
        if project.id != manifest.project_id {
            return Err("Backup project identity mismatch".into());
        }
        let folder_ids = validate_structure(&project)?;
        let damaged: HashSet<&String> = manifest.damaged.iter().collect();
        let to_local = |value: &str| -> Result<Option<String>, String> {
            match &manifest.source_root {
                Some(old) => asset_reference(value, old, &destination, &manifest.files),
                None => Ok(value.strip_prefix(ASSET_SCHEME).and_then(|file| {
                    let relative = format!("assets/{file}");
                    manifest.files.contains_key(&relative).then(|| destination.join(&relative).to_string_lossy().into_owned())
                })),
            }
        };
        let mut documents = Vec::new();
        for name in manifest.files.keys().filter(|p| p.starts_with("documents/")) {
            let file = stage.join(name);
            let bytes = fs::read(&file).map_err(err)?;
            if damaged.contains(name) {
                // Kept byte for byte; the app skips it on load as it did on the source device.
                if let Ok(document) = serde_json::from_slice::<Document>(&bytes) {
                    documents.push(document);
                }
                continue;
            }
            check_document(&bytes, name, &folder_ids).map_err(|why| format!("Invalid document in backup: {name} ({why})"))?;
            let mut value: Value = serde_json::from_slice(&bytes).map_err(err)?;
            rewrite_references(&mut value, &to_local)?;
            crate::project::write_atomic(&file, &serde_json::to_string_pretty(&value).map_err(err)?)?;
            documents.push(serde_json::from_value(value).map_err(err)?);
        }
        value["id"] = Value::String(id);
        value["name"] = Value::String(format!("{} (restored)", project.name));
        value["path"] = Value::String(destination.to_string_lossy().into_owned());
        // A recovered copy is local-only and does not inherit a device/provider connection.
        value.as_object_mut().ok_or("Invalid project metadata")?.remove("ai");
        crate::project::write_atomic(&path, &serde_json::to_string_pretty(&value).map_err(err)?)?;
        let mut restored: Project = serde_json::from_value(value).map_err(err)?;
        documents.sort_by(|a, b| a.order.cmp(&b.order).then(a.updated_at.cmp(&b.updated_at)));
        restored.documents = documents;
        fs::rename(&stage, &destination).map_err(err)?;
        Ok(restored)
    })();
    // Only this invocation's private staging folder can be removed. Activated data is retained.
    if stage.exists() {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}

// ---- the backups folder ------------------------------------------------------------------------

/// Backups kept per project; older ones are removed when a new one is made.
pub const KEEP: usize = 5;

fn backups_dir() -> PathBuf {
    crate::project::data_dir().join("backups")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    pub path: String,
    pub file_name: String,
    /// Problems that did not stop the backup (damaged chapters, images outside the project).
    pub warnings: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub file_name: String,
    pub project_id: String,
    pub project_name: String,
    pub size: u64,
    pub created_at: String,
}

/// The project and name recorded inside an archive (read without extracting it).
fn header(path: &Path) -> Option<(String, String)> {
    let mut zip = ZipArchive::new(File::open(path).ok()?).ok()?;
    let manifest = read_manifest(&mut zip).ok()?;
    let name = zip
        .by_name("project.json")
        .ok()
        .and_then(|f| bounded_read(f, MAX_MANIFEST).ok())
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v["name"].as_str().map(String::from))
        .unwrap_or_default();
    Some((manifest.project_id, name))
}

fn list_in(folder: &Path) -> Vec<BackupInfo> {
    let Ok(entries) = fs::read_dir(folder) else { return Vec::new() };
    let mut out: Vec<BackupInfo> = entries
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("zip") && e.path().is_file())
        .filter_map(|e| {
            let path = e.path();
            let (project_id, project_name) = header(&path)?;
            let meta = e.metadata().ok()?;
            let created_at = meta.modified().ok().map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339()).unwrap_or_default();
            Some(BackupInfo {
                file_name: e.file_name().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                project_id,
                project_name,
                size: meta.len(),
                created_at,
            })
        })
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.file_name.cmp(&a.file_name)));
    out
}

/// Every backup in the backups folder, newest first.
pub fn list() -> Vec<BackupInfo> {
    list_in(&backups_dir())
}

/// Keep the newest `keep` backups of one project; never the file just written.
fn prune_in(folder: &Path, project_id: &str, keep: usize, newest: &Path) {
    for old in list_in(folder).into_iter().filter(|b| b.project_id == project_id).skip(keep) {
        if Path::new(&old.path) != newest {
            let _ = fs::remove_file(&old.path);
        }
    }
}

/// `<project name>-<yyyy-mm-dd-hhmm>.zip`, unique in `folder`.
fn backup_name(folder: &Path, project_name: &str) -> PathBuf {
    let base: String = crate::project::safe_dir_name(project_name).chars().take(60).collect::<String>().trim().to_string();
    let base = if base.is_empty() || !safe_name(&base) { "project".to_string() } else { base };
    let stamp = chrono::Local::now().format("%Y-%m-%d-%H%M");
    let mut candidate = folder.join(format!("{base}-{stamp}.zip"));
    let mut n = 2;
    while candidate.exists() {
        candidate = folder.join(format!("{base}-{stamp}-{n}.zip"));
        n += 1;
    }
    candidate
}

pub fn create(project_id: &str) -> Result<Created, String> {
    create_in(project_id, &Project::resolve_dir(project_id), &backups_dir())
}

fn create_in(project_id: &str, project_dir: &Path, folder: &Path) -> Result<Created, String> {
    if Uuid::parse_str(project_id).is_err() {
        return Err("Invalid project identity".into());
    }
    fs::create_dir_all(folder).map_err(err)?;
    let name = fs::read(project_dir.join("project.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v["name"].as_str().map(String::from))
        .unwrap_or_default();
    let destination = backup_name(folder, &name);
    let warnings = export_in(project_dir, &destination)?;
    prune_in(folder, project_id, KEEP, &destination);
    Ok(Created {
        file_name: destination.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        path: destination.to_string_lossy().into_owned(),
        warnings,
    })
}

/// A path the frontend names must be one of the backups in the backups folder.
fn in_folder(folder: &Path, path: &str) -> Result<PathBuf, String> {
    let folder = folder.canonicalize().map_err(err)?;
    let file = Path::new(path).canonicalize().map_err(|_| "That backup no longer exists")?;
    if file.parent() != Some(folder.as_path()) || file.extension().and_then(|e| e.to_str()) != Some("zip") {
        return Err("Not a MnemoScript backup".into());
    }
    Ok(file)
}

pub fn delete(path: &str) -> Result<(), String> {
    fs::remove_file(in_folder(&backups_dir(), path)?).map_err(err)
}

/// Copy a backup to a writer (a file the writer chose, possibly an Android document).
pub fn copy_to(path: &str, destination: &mut impl Write) -> Result<u64, String> {
    let mut source = File::open(in_folder(&backups_dir(), path)?).map_err(err)?;
    let copied = std::io::copy(&mut source, destination).map_err(err)?;
    destination.flush().map_err(err)?;
    Ok(copied)
}

#[cfg(test)]
mod tests;
