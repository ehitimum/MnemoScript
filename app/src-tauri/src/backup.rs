//! Local recovery only. Archives are not sync batches and confer no device trust.
use crate::project::{Document, Project};
use lol_html::{element, rewrite_str, RewriteStrSettings};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    format: String,
    schema_version: u32,
    project_id: String,
    source_root: String,
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

/// File-backed, bounded ZIP writer. Source files are never modified.
pub fn export_in(root: &Path, destination: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(err)?;
    let files = inventory(&root)?;
    let project: Project =
        serde_json::from_slice(&fs::read(root.join("project.json")).map_err(err)?).map_err(err)?;
    validate_project(&root, &project, &files)?;
    let manifest = Manifest {
        format: "mnemoscript-project-backup".into(),
        schema_version: 1,
        project_id: project.id,
        source_root: root.to_string_lossy().into_owned(),
        files,
    };
    remap_documents(&root, &root, &manifest, false)?;
    // create_new prevents overwriting an archive or an existing manuscript file.
    let file = File::options()
        .write(true)
        .read(true)
        .create_new(true)
        .open(destination)
        .map_err(err)?;
    let result = (|| {
        let mut zip = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, digest) in &manifest.files {
            let bytes = bounded_read(File::open(root.join(name)).map_err(err)?, MAX_FILE)?;
            if hash(&bytes) != digest.sha256 {
                return Err("Project changed during backup; try again".into());
            }
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
        if after.len() != manifest.files.len()
            || after.iter().any(|(name, digest)| {
                manifest
                    .files
                    .get(name)
                    .is_none_or(|old| old.sha256 != digest.sha256)
            })
        {
            return Err("Project changed during backup; try again".into());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

/// Verify every entry before activation. Only a private, newly created stage is written.
fn extract<R: Read + Seek>(source: R, stage: &Path) -> Result<Manifest, String> {
    let mut zip = ZipArchive::new(source).map_err(err)?;
    if zip.len() > MAX_FILES + 1 {
        return Err("Too many backup files".into());
    }
    let manifest: Manifest = {
        let file = zip
            .by_name(MANIFEST)
            .map_err(|_| "Not a MnemoScript recovery archive")?;
        serde_json::from_slice(&bounded_read(file, MAX_MANIFEST)?).map_err(err)?
    };
    if manifest.format != "mnemoscript-project-backup" || manifest.schema_version != 1 {
        return Err("Unsupported backup format; update MnemoScript".into());
    }
    if manifest.files.len() > MAX_FILES
        || zip.len() != manifest.files.len() + 1
        || !manifest.files.contains_key("project.json")
    {
        return Err("Backup file list does not match its manifest".into());
    }
    let mut total = 0_u64;
    for (name, digest) in &manifest.files {
        if !allowed(name) || digest.size > MAX_FILE || digest.sha256.len() != 64 {
            return Err("Invalid backup manifest entry".into());
        }
        total = total
            .checked_add(digest.size)
            .ok_or("Backup size overflow")?;
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
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 != 0 && mode & 0o170000 != 0o100000)
        {
            return Err("Unsafe or duplicate backup path".into());
        }
        if name == MANIFEST {
            continue;
        }
        let digest = manifest
            .files
            .get(&name)
            .ok_or("Unexpected file in backup")?;
        if file.size() != digest.size {
            return Err("Backup size mismatch".into());
        }
        let bytes = bounded_read(file, digest.size)?;
        if bytes.len() as u64 != digest.size || hash(&bytes) != digest.sha256 {
            return Err(format!("Backup checksum mismatch: {name}"));
        }
        let path = stage.join(&name);
        fs::create_dir_all(path.parent().ok_or("Missing parent")?).map_err(err)?;
        let mut output = File::options()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(err)?;
        output.write_all(&bytes).map_err(err)?;
        output.sync_all().map_err(err)?;
    }
    Ok(manifest)
}

fn validate_project(
    root: &Path,
    project: &Project,
    files: &BTreeMap<String, FileDigest>,
) -> Result<(), String> {
    if Uuid::parse_str(&project.id).is_err() {
        return Err("Invalid project identity".into());
    }
    let folder_ids: HashSet<_> = project.folders.iter().map(|f| f.id.as_str()).collect();
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
    let mut doc_ids = HashSet::new();
    for name in files.keys().filter(|p| p.starts_with("documents/")) {
        let document: Document = serde_json::from_slice(&fs::read(root.join(name)).map_err(err)?)
            .map_err(|_| format!("Damaged document: {name}"))?;
        if !doc_ids.insert(document.id.clone())
            || *name != format!("documents/{}.json", document.id)
            || !matches!(
                document.doc_type.as_str(),
                "text" | "mindmap" | "fantasymap"
            )
            || document
                .folder_id
                .as_ref()
                .is_some_and(|id| !folder_ids.contains(id.as_str()))
        {
            return Err("Invalid document identity, type or folder".into());
        }
    }
    if project.documents.iter().any(|d| !doc_ids.contains(&d.id)) {
        return Err("Backup is missing an indexed document".into());
    }
    Ok(())
}

fn asset_reference(
    value: &str,
    old_root: &str,
    new_root: &Path,
    files: &BTreeMap<String, FileDigest>,
) -> Result<Option<String>, String> {
    let normalized = value.replace('\\', "/");
    // Windows canonical paths carry an extended-length prefix, stored document paths usually don't.
    let old = old_root.replace('\\', "/");
    let old = old.trim_start_matches("//?/").trim_end_matches('/');
    let path = normalized.trim_start_matches("//?/");
    let prefix = format!("{old}/");
    let windows_source = old.as_bytes().get(1) == Some(&b':');
    let relative = path
        .strip_prefix(&prefix)
        .or_else(|| {
            (windows_source
                && path
                    .get(..prefix.len())
                    .is_some_and(|s| s.eq_ignore_ascii_case(&prefix)))
            .then(|| &path[prefix.len()..])
        })
        .or_else(|| path.starts_with("assets/").then_some(path));
    if let Some(relative) = relative {
        let actual = files
            .keys()
            .find(|name| {
                **name == relative || (windows_source && name.eq_ignore_ascii_case(relative))
            })
            .filter(|_| relative.to_ascii_lowercase().starts_with("assets/"))
            .ok_or("A document references a missing project asset")?;
        return Ok(Some(new_root.join(actual).to_string_lossy().into_owned()));
    }
    if path.starts_with('/')
        || path.as_bytes().get(1) == Some(&b':')
        || path.starts_with("asset:")
        || path.starts_with("file:")
        || path.starts_with("blob:")
        || path.starts_with("http://asset.localhost/")
        || path.starts_with("https://asset.localhost/")
    {
        return Err("A document references an external local asset; import it into this project before backup".into());
    }
    Ok(None)
}

fn remap_json(
    value: &mut Value,
    old: &str,
    new: &Path,
    files: &BTreeMap<String, FileDigest>,
) -> Result<(), String> {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                if matches!(key.as_str(), "assetPath" | "imagePath" | "bakedAssetPath") {
                    if let Some(path) = value.as_str() {
                        if let Some(mapped) = asset_reference(path, old, new, files)? {
                            *value = Value::String(mapped);
                        }
                    }
                } else {
                    remap_json(value, old, new, files)?;
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                remap_json(item, old, new, files)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn remap_documents(
    stage: &Path,
    destination: &Path,
    manifest: &Manifest,
    write: bool,
) -> Result<(), String> {
    for name in manifest
        .files
        .keys()
        .filter(|p| p.starts_with("documents/"))
    {
        // Keep unknown document fields, HTML marks, graph IDs and ordinary prose untouched.
        let path = stage.join(name);
        let mut value: Value =
            serde_json::from_slice(&fs::read(&path).map_err(err)?).map_err(err)?;
        let content = value["content"]
            .as_str()
            .ok_or("Missing document content")?;
        let mapped = match value
            .get("docType")
            .and_then(Value::as_str)
            .unwrap_or("text")
        {
            "text" => rewrite_str(
                content,
                RewriteStrSettings::new().append_element_content_handler(element!(
                    "img[src]",
                    |el| {
                        let raw_src = el.get_attribute("src").unwrap_or_default();
                        let src = html_escape::decode_html_entities(&raw_src);
                        if let Some(mapped) = asset_reference(
                            &src,
                            &manifest.source_root,
                            destination,
                            &manifest.files,
                        )? {
                            el.set_attribute(
                                "src",
                                &html_escape::encode_double_quoted_attribute(&mapped),
                            )?;
                        }
                        Ok(())
                    }
                )),
            )
            .map_err(err)?,
            _ => {
                let mut graph: Value =
                    serde_json::from_str(content).map_err(|_| "Damaged map document")?;
                remap_json(
                    &mut graph,
                    &manifest.source_root,
                    destination,
                    &manifest.files,
                )?;
                serde_json::to_string(&graph).map_err(err)?
            }
        };
        value["content"] = Value::String(mapped);
        if write {
            crate::project::write_atomic(
                &path,
                &serde_json::to_string_pretty(&value).map_err(err)?,
            )?;
        }
    }
    Ok(())
}

/// Restore as an independent copy; never overwrite or unregister a source project.
pub fn restore_in<R: Read + Seek>(source: R, projects_dir: &Path) -> Result<Project, String> {
    fs::create_dir_all(projects_dir).map_err(err)?;
    let id = Uuid::new_v4().to_string();
    let stage = projects_dir.join(format!(".restore-{id}"));
    let destination = projects_dir.join(&id);
    fs::create_dir(&stage).map_err(err)?;
    let result = (|| {
        let manifest = extract(source, &stage)?;
        let path = stage.join("project.json");
        let mut value: Value =
            serde_json::from_slice(&fs::read(&path).map_err(err)?).map_err(err)?;
        let project: Project = serde_json::from_value(value.clone()).map_err(err)?;
        if project.id != manifest.project_id {
            return Err("Backup project identity mismatch".into());
        }
        validate_project(&stage, &project, &manifest.files)?;
        remap_documents(&stage, &destination, &manifest, true)?;
        value["id"] = Value::String(id);
        value["name"] = Value::String(format!("{} (restored)", project.name));
        value["path"] = Value::String(destination.to_string_lossy().into_owned());
        // A recovered copy is local-only and does not inherit a device/provider connection.
        value
            .as_object_mut()
            .ok_or("Invalid project metadata")?
            .remove("ai");
        crate::project::write_atomic(&path, &serde_json::to_string_pretty(&value).map_err(err)?)?;
        let mut restored: Project = serde_json::from_value(value).map_err(err)?;
        restored.documents = manifest
            .files
            .keys()
            .filter(|p| p.starts_with("documents/"))
            .map(|name| {
                serde_json::from_slice(&fs::read(stage.join(name)).map_err(err)?).map_err(err)
            })
            .collect::<Result<Vec<Document>, String>>()?;
        restored
            .documents
            .sort_by(|a, b| a.order.cmp(&b.order).then(a.updated_at.cmp(&b.updated_at)));
        fs::rename(&stage, &destination).map_err(err)?;
        Ok(restored)
    })();
    // Only this invocation's private staging folder can be removed. Activated data is retained.
    if stage.exists() {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}

pub fn create(project_id: &str) -> Result<String, String> {
    if Uuid::parse_str(project_id).is_err() {
        return Err("Invalid project identity".into());
    }
    let folder = crate::project::data_dir().join("backups");
    fs::create_dir_all(&folder).map_err(err)?;
    let destination: PathBuf = folder.join(format!("{project_id}-{}.zip", Uuid::new_v4()));
    export_in(&Project::resolve_dir(project_id), &destination)?;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests;
