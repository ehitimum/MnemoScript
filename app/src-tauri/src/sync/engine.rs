//! The transport-neutral sync engine.
//!
//! * `scan` compares the project files on disk with the last state the engine knows and
//!   records every difference as a new immutable revision (queued for each transport). Saves
//!   therefore never depend on React or on a hook firing: whatever is on disk is captured.
//! * `apply_batch` stores verified remote revisions and reconciles each touched entity:
//!   fast-forward when causally newer, deterministic field merge for metadata, preserved
//!   conflict heads for chapter/map text, edit-beats-delete, and a staged update instead of a
//!   disk write for the chapter currently open in the editor.
//! * `resolve` turns a writer's conflict choice into a merge revision.
use super::model::{self, merge_fields, parse_entity, state_hash, Batch, Kind, Revision, SCHEMA_VERSION};
use super::portable;
use super::store::Store;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

const MAX_BATCH: usize = 400;

/// Errors a transport reports. The engine never discards local data on any of them.
#[derive(Debug, Clone, PartialEq)]
pub enum TransportError {
    /// Sign-in expired or revoked: pause this transport and ask the writer to reconnect.
    Auth(String),
    /// No network. Changes stay queued.
    Offline(String),
    /// Rate limited / temporarily unavailable; retry later with backoff.
    Busy(String),
    /// The writer's storage is full.
    Quota(String),
    Other(String),
}

impl std::fmt::Display for TransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransportError::Auth(m) => write!(f, "Sign-in needed: {m}"),
            TransportError::Offline(m) => write!(f, "Offline: {m}"),
            TransportError::Busy(m) => write!(f, "Service busy: {m}"),
            TransportError::Quota(m) => write!(f, "Storage full: {m}"),
            TransportError::Other(m) => write!(f, "{m}"),
        }
    }
}

impl From<String> for TransportError {
    fn from(e: String) -> Self {
        TransportError::Other(e)
    }
}

/// What a sync destination must provide. LAN (later) and Google Drive implement the same
/// contract, and identical revision ids deduplicate across them.
pub trait Transport {
    fn id(&self) -> &'static str;
    fn has_blob(&mut self, project_id: &str, sha: &str) -> Result<bool, TransportError>;
    fn put_blob(&mut self, project_id: &str, sha: &str, bytes: &[u8]) -> Result<(), TransportError>;
    /// `Ok(None)` when the blob is not (yet) visible at the destination.
    fn get_blob(&mut self, project_id: &str, sha: &str) -> Result<Option<Vec<u8>>, TransportError>;
    /// Publishing the same `(device, seq)` twice must not create a second logical batch.
    fn put_batch(&mut self, batch: &Batch) -> Result<(), TransportError>;
    /// Batches of a project not yet applied here (`seen(device, seq)` filters known ones).
    fn pull(&mut self, project_id: &str, seen: &dyn Fn(&str, u64) -> bool) -> Result<Vec<Batch>, TransportError>;
}

/// Entities found on disk, plus the portable text bodies keyed by hash.
struct Disk {
    entities: BTreeMap<String, Value>,
    texts: BTreeMap<String, Vec<u8>>,
}

#[derive(Default, Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    /// Entities written to disk from remote changes (the UI reloads these).
    pub changed: Vec<String>,
    /// Chapters whose remote update waits until the writer leaves them.
    pub staged: Vec<String>,
    pub published: usize,
    pub held: usize,
}

pub struct Engine<'a> {
    pub store: &'a Store,
    pub device_id: String,
    pub device_name: String,
}

fn read_json(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)
}

fn opt_str(v: &Value, key: &str) -> Value {
    match v.get(key) {
        Some(Value::String(s)) => Value::String(s.clone()),
        _ => Value::Null,
    }
}

fn int(v: &Value, key: &str) -> Value {
    json!(v.get(key).and_then(Value::as_i64).unwrap_or(0))
}

impl<'a> Engine<'a> {
    pub fn new(store: &'a Store, device_name: &str) -> Result<Self, String> {
        Ok(Engine { store, device_id: store.device_id()?, device_name: device_name.to_string() })
    }

    fn read_disk(&self, project_id: &str, dir: &Path) -> Result<Disk, String> {
        let meta = read_json(&dir.join("project.json"))?;
        if meta.get("id").and_then(Value::as_str) != Some(project_id) {
            return Err("Project folder does not match the synced project".into());
        }
        let mut entities = BTreeMap::new();
        let mut texts = BTreeMap::new();
        entities.insert(
            "project".to_string(),
            json!({"name": opt_str(&meta, "name"), "description": opt_str(&meta, "description"), "author": opt_str(&meta, "author")}),
        );
        for folder in meta.get("folders").and_then(Value::as_array).into_iter().flatten() {
            let Some(id) = folder.get("id").and_then(Value::as_str).filter(|id| model::safe_id(id)) else { continue };
            entities.insert(
                format!("folder:{id}"),
                json!({"name": opt_str(folder, "name"), "order": int(folder, "order"), "parentId": opt_str(folder, "parentId")}),
            );
        }
        let roots = portable::roots_for(dir);
        let docs = dir.join("documents");
        if docs.is_dir() {
            for entry in fs::read_dir(&docs).map_err(err)? {
                let path = entry.map_err(err)?.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") || !path.is_file() {
                    continue;
                }
                // Same tolerance as Project::load: one damaged chapter never blocks sync.
                let Ok(doc) = read_json(&path) else { continue };
                let Some(id) = doc.get("id").and_then(Value::as_str).filter(|id| model::safe_id(id)) else { continue };
                if path.file_stem().and_then(|s| s.to_str()) != Some(id) {
                    continue;
                }
                let doc_type = doc.get("docType").and_then(Value::as_str).unwrap_or("text");
                entities.insert(
                    format!("doc:{id}"),
                    json!({"title": opt_str(&doc, "title"), "docType": doc_type, "order": int(&doc, "order"), "folderId": opt_str(&doc, "folderId")}),
                );
                let content = doc.get("content").and_then(Value::as_str).unwrap_or("");
                let body = portable::to_portable(content, doc_type, &roots).into_bytes();
                let sha = model::sha256_hex(&body);
                entities.insert(format!("text:{id}"), json!({"sha256": sha}));
                texts.insert(sha, body);
            }
        }
        let assets = dir.join("assets");
        if assets.is_dir() {
            for entry in fs::read_dir(&assets).map_err(err)? {
                let entry = entry.map_err(err)?;
                let name = entry.file_name().to_string_lossy().into_owned();
                let kind = fs::symlink_metadata(entry.path()).map_err(err)?;
                if !kind.is_file() || !model::safe_asset_name(&name) || name.ends_with(".tmp") {
                    continue;
                }
                let key = format!("asset:{name}");
                // Asset files are immutable (fresh uuid names), so a known one is not re-hashed.
                if let Some((rev, _)) = self.store.disk_state(project_id, &key)? {
                    if let Some(r) = self.store.revision(project_id, &rev)? {
                        if let Some(p) = r.payload {
                            entities.insert(key, p);
                            continue;
                        }
                    }
                }
                let bytes = fs::read(entry.path()).map_err(err)?;
                entities.insert(key, json!({"sha256": model::sha256_hex(&bytes), "size": bytes.len()}));
            }
        }
        Ok(Disk { entities, texts })
    }

    /// Record local edits as revisions. Returns the new revisions (already queued).
    pub fn scan(&self, project_id: &str, dir: &Path, transports: &[&str]) -> Result<Vec<Revision>, String> {
        let disk = self.read_disk(project_id, dir)?;
        let known: BTreeMap<String, (String, String)> =
            self.store.entities(project_id)?.into_iter().map(|(e, r, h)| (e, (r, h))).collect();
        let mut keys: BTreeSet<&String> = disk.entities.keys().collect();
        keys.extend(known.keys());
        let mut created = Vec::new();
        let tx = self.store.conn.unchecked_transaction().map_err(err)?;
        for entity in keys {
            let current = disk.entities.get(entity);
            // A missing asset file is not a delete: it may simply not be downloaded yet.
            if current.is_none() && entity.starts_with("asset:") {
                continue;
            }
            let hash = state_hash(current);
            let parents = match known.get(entity) {
                Some((_, h)) if *h == hash => continue,
                Some((rev, _)) => vec![rev.clone()],
                None if current.is_none() => continue,
                None => Vec::new(),
            };
            if let Some(sha) = current.and_then(|c| c.get("sha256")).and_then(Value::as_str) {
                if let Some(body) = disk.texts.get(sha) {
                    self.store.put_blob(sha, body)?;
                }
            }
            let rev = Revision::new(entity, parents, current.cloned(), &self.device_id);
            self.store.insert_revision(project_id, &rev)?;
            self.store.set_disk_state(project_id, entity, &rev.rev, &hash)?;
            for t in transports {
                self.store.enqueue(project_id, t, &rev.rev)?;
            }
            created.push(rev);
        }
        tx.commit().map_err(err)?;
        Ok(created)
    }

    // ---- applying remote revisions ----------------------------------------------------------

    /// Fetch, verify and store a blob the revision needs. `Ok(false)` = not available yet.
    fn ensure_blob(
        &self,
        project_id: &str,
        dir: &Path,
        rev: &Revision,
        transport: &mut dyn Transport,
    ) -> Result<bool, TransportError> {
        let Some(sha) = rev.blob() else { return Ok(true) };
        let (kind, name) = parse_entity(&rev.entity).ok_or_else(|| TransportError::Other("bad entity".into()))?;
        if kind == Kind::Asset {
            let path = dir.join("assets").join(name);
            if path.exists() {
                return Ok(true);
            }
            let Some(bytes) = transport.get_blob(project_id, &sha)? else { return Ok(false) };
            if model::sha256_hex(&bytes) != sha {
                return Err(TransportError::Other("Downloaded image failed its checksum".into()));
            }
            fs::create_dir_all(dir.join("assets")).map_err(err)?;
            let tmp = dir.join("assets").join(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()));
            fs::write(&tmp, &bytes).map_err(err)?;
            fs::rename(&tmp, &path).map_err(|e| {
                let _ = fs::remove_file(&tmp);
                TransportError::Other(e.to_string())
            })?;
            return Ok(true);
        }
        if self.store.blob(&sha)?.is_some() {
            return Ok(true);
        }
        let Some(bytes) = transport.get_blob(project_id, &sha)? else { return Ok(false) };
        if model::sha256_hex(&bytes) != sha || std::str::from_utf8(&bytes).is_err() {
            return Err(TransportError::Other("Downloaded chapter failed its checksum".into()));
        }
        self.store.put_blob(&sha, &bytes)?;
        Ok(true)
    }

    /// Apply one remote batch. `Ok(false)` means it must wait (missing parents or blobs).
    pub fn apply_batch(
        &self,
        project_id: &str,
        dir: &Path,
        batch: &Batch,
        transport: &mut dyn Transport,
        active_doc: Option<&str>,
        report: &mut SyncReport,
    ) -> Result<bool, TransportError> {
        let tid = transport.id();
        if self.store.batch_applied(project_id, tid, &batch.device_id, batch.seq)? {
            return Ok(true);
        }
        if batch.schema_version != SCHEMA_VERSION {
            return Err(TransportError::Other("Another device uses a newer sync format; update MnemoScript".into()));
        }
        if batch.project_id != project_id || batch.revisions.iter().any(|r| !r.verify()) {
            // Damaged or forged data never reaches disk; record it and move on.
            self.store.add_notice(project_id, "project", "rejected", &format!("Ignored damaged changes from {}", batch.device_name))?;
            self.store.mark_applied(project_id, tid, &batch.device_id, batch.seq)?;
            return Ok(true);
        }
        let mut in_batch = BTreeSet::new();
        for rev in &batch.revisions {
            for parent in &rev.parents {
                if !in_batch.contains(parent) && !self.store.has_revision(project_id, parent)? {
                    return Ok(false);
                }
            }
            in_batch.insert(rev.rev.clone());
        }
        for rev in &batch.revisions {
            if !self.ensure_blob(project_id, dir, rev, transport)? {
                return Ok(false);
            }
        }
        if batch.device_id != self.device_id {
            self.store.remember_device(&batch.device_id, &batch.device_name)?;
        }
        let mut touched = BTreeSet::new();
        for rev in &batch.revisions {
            if self.store.insert_revision(project_id, rev)? {
                touched.insert(rev.entity.clone());
            }
        }
        let mut incoming: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for rev in &batch.revisions {
            incoming.entry(rev.entity.clone()).or_default().push(rev.rev.clone());
        }
        // Folders and documents first so text always lands in an existing chapter file.
        let order = |e: &String| match parse_entity(e).map(|k| k.0) {
            Some(Kind::Project) => 0,
            Some(Kind::Folder) => 1,
            Some(Kind::Asset) => 2,
            Some(Kind::Doc) => 3,
            _ => 4,
        };
        let mut entities: Vec<String> = touched.into_iter().collect();
        entities.sort_by_key(order);
        for entity in &entities {
            self.reconcile(project_id, dir, entity, &incoming[entity], active_doc, report)?;
        }
        self.repair(project_id, dir, report)?;
        self.store.mark_applied(project_id, tid, &batch.device_id, batch.seq)?;
        Ok(true)
    }

    fn payload(&self, project_id: &str, rev: &str) -> Result<Option<Value>, String> {
        Ok(self.store.revision(project_id, rev)?.and_then(|r| r.payload))
    }

    /// The maximal revisions among `candidates` (none is an ancestor of another).
    fn heads(&self, project_id: &str, candidates: &BTreeSet<String>) -> Result<Vec<String>, String> {
        let mut heads = Vec::new();
        for c in candidates {
            let mut dominated = false;
            for other in candidates {
                if other != c && self.store.is_ancestor(project_id, c, other)? {
                    dominated = true;
                    break;
                }
            }
            if !dominated {
                heads.push(c.clone());
            }
        }
        Ok(heads)
    }

    fn record_local(&self, project_id: &str, rev: &Revision) -> Result<(), String> {
        if self.store.insert_revision(project_id, rev)? {
            for t in self.store.project_transports(project_id)? {
                self.store.enqueue(project_id, t, &rev.rev)?;
            }
        }
        Ok(())
    }

    fn reconcile(
        &self,
        project_id: &str,
        dir: &Path,
        entity: &str,
        incoming: &[String],
        active_doc: Option<&str>,
        report: &mut SyncReport,
    ) -> Result<(), String> {
        let (kind, id) = parse_entity(entity).ok_or("bad entity")?;
        let disk = self.store.disk_state(project_id, entity)?.map(|(r, _)| r);
        let staged = self.store.staged(project_id, entity)?;
        let mut candidates: BTreeSet<String> = self.store.conflicts(project_id, entity)?.into_iter().collect();
        candidates.extend(disk.iter().cloned());
        candidates.extend(staged.iter().cloned());
        candidates.extend(incoming.iter().cloned());
        let heads = self.heads(project_id, &candidates)?;

        let target = if heads.len() == 1 {
            self.store.set_conflicts(project_id, entity, &[])?;
            heads[0].clone()
        } else if kind == Kind::Text {
            let payloads: BTreeSet<String> = heads
                .iter()
                .map(|h| self.payload(project_id, h).map(|p| state_hash(p.as_ref())))
                .collect::<Result<_, _>>()?;
            let all_same = payloads.len() == 1;
            let some_deleted = heads.iter().any(|h| self.payload(project_id, h).ok().flatten().is_none());
            if all_same || some_deleted {
                // Identical results merge silently; edit beats delete (keep the newest edit set).
                let keep = self.first_live(project_id, &heads)?;
                let merged = Revision::new(entity, heads.clone(), self.payload(project_id, &keep)?, &self.device_id);
                if some_deleted && !all_same {
                    self.store.add_notice(project_id, entity, "kept", "Kept a chapter that was deleted on another device but edited elsewhere")?;
                }
                self.record_local(project_id, &merged)?;
                self.store.set_conflicts(project_id, entity, &[])?;
                merged.rev
            } else {
                // Keep what the writer has on this device; preserve every other version.
                let local = match &disk {
                    Some(d) => heads
                        .iter()
                        .find(|h| self.store.is_ancestor(project_id, d, h).unwrap_or(false))
                        .cloned()
                        .unwrap_or_else(|| heads[0].clone()),
                    None => heads[0].clone(),
                };
                let others: Vec<String> = heads.iter().filter(|h| **h != local).cloned().collect();
                self.store.set_conflicts(project_id, entity, &others)?;
                local
            }
        } else {
            // Metadata: deterministic field merge folded over every head.
            let mut acc = heads[0].clone();
            for other in &heads[1..] {
                let base = self.store.merge_base(project_id, &acc, other)?;
                let base_payload = match base {
                    Some(b) => self.payload(project_id, &b)?,
                    None => None,
                };
                let (ours, theirs) = (self.payload(project_id, &acc)?, self.payload(project_id, other)?);
                let (merged, collided) = merge_fields(base_payload.as_ref(), (&acc, ours.as_ref()), (other, theirs.as_ref()));
                let rev = Revision::new(entity, vec![acc.clone(), other.clone()], merged, &self.device_id);
                if !collided.is_empty() {
                    let label = theirs.or(ours).and_then(|p| p.get("title").or(p.get("name")).and_then(Value::as_str).map(String::from)).unwrap_or_default();
                    self.store.add_notice(project_id, entity, "merged", &format!("\"{label}\" changed on two devices ({}); one version was kept", collided.join(", ")))?;
                }
                self.record_local(project_id, &rev)?;
                acc = rev.rev;
            }
            self.store.set_conflicts(project_id, entity, &[])?;
            acc
        };

        if disk.as_deref() == Some(target.as_str()) {
            if staged.is_some() {
                self.store.set_staged(project_id, entity, None)?;
            }
            return Ok(());
        }
        // Never write under the editor: the open chapter's text (or its removal) waits for the
        // writer. Title, folder and order changes still apply; the app merges them in place.
        let removes = kind == Kind::Doc && self.payload(project_id, &target)?.is_none();
        if (kind == Kind::Text || removes) && active_doc == Some(id) {
            self.store.set_staged(project_id, entity, Some(&target))?;
            report.staged.push(entity.to_string());
            return Ok(());
        }
        self.store.set_staged(project_id, entity, None)?;
        self.write(project_id, dir, entity, &target)?;
        report.changed.push(entity.to_string());
        Ok(())
    }

    fn first_live(&self, project_id: &str, heads: &[String]) -> Result<String, String> {
        for h in heads {
            if self.payload(project_id, h)?.is_some() {
                return Ok(h.clone());
            }
        }
        Ok(heads[0].clone())
    }

    /// Write one entity's revision to the project files and remember it as the disk state.
    fn write(&self, project_id: &str, dir: &Path, entity: &str, rev: &str) -> Result<(), String> {
        let (kind, id) = parse_entity(entity).ok_or("bad entity")?;
        let payload = self.payload(project_id, rev)?;
        match kind {
            Kind::Project => {
                let path = dir.join("project.json");
                let mut meta = read_json(&path)?;
                if let Some(p) = &payload {
                    for key in ["name", "description", "author"] {
                        meta[key] = p.get(key).cloned().unwrap_or(Value::Null);
                    }
                }
                crate::project::write_atomic(&path, &serde_json::to_string_pretty(&meta).map_err(err)?)?;
            }
            Kind::Folder => {
                let path = dir.join("project.json");
                let mut meta = read_json(&path)?;
                let folders = meta.as_object_mut().ok_or("bad project.json")?.entry("folders").or_insert(json!([]));
                let list = folders.as_array_mut().ok_or("bad folders")?;
                list.retain(|f| f.get("id").and_then(Value::as_str) != Some(id));
                if let Some(p) = &payload {
                    list.push(json!({"id": id, "name": p["name"], "order": p["order"], "parentId": p["parentId"]}));
                }
                crate::project::write_atomic(&path, &serde_json::to_string_pretty(&meta).map_err(err)?)?;
            }
            Kind::Doc => {
                let path = dir.join("documents").join(format!("{id}.json"));
                match &payload {
                    None => {
                        if path.exists() {
                            let title = read_json(&path).ok().and_then(|d| d.get("title").and_then(Value::as_str).map(String::from));
                            fs::remove_file(&path).map_err(err)?;
                            self.store.add_notice(
                                project_id,
                                entity,
                                "deleted",
                                &format!("\"{}\" was deleted on another device", title.unwrap_or_else(|| "Untitled".into())),
                            )?;
                        }
                    }
                    Some(p) => {
                        let mut doc = read_json(&path).unwrap_or_else(|_| json!({"id": id, "content": ""}));
                        for key in ["title", "docType", "order", "folderId"] {
                            doc[key] = p.get(key).cloned().unwrap_or(Value::Null);
                        }
                        if doc["title"].is_null() {
                            doc["title"] = json!("Untitled");
                        }
                        doc["updated_at"] = json!(chrono::Utc::now().to_rfc3339());
                        crate::project::write_atomic(&path, &serde_json::to_string_pretty(&doc).map_err(err)?)?;
                    }
                }
            }
            Kind::Text => {
                let path = dir.join("documents").join(format!("{id}.json"));
                if let Some(p) = &payload {
                    let sha = p.get("sha256").and_then(Value::as_str).ok_or("bad text payload")?;
                    let body = self.store.blob(sha)?.ok_or("Missing chapter text")?;
                    let body = String::from_utf8(body).map_err(err)?;
                    let mut doc = match read_json(&path) {
                        Ok(doc) => doc,
                        Err(_) => self.restore_doc_meta(project_id, id)?,
                    };
                    let doc_type = doc.get("docType").and_then(Value::as_str).unwrap_or("text").to_string();
                    doc["content"] = json!(portable::to_local(&body, &doc_type, dir));
                    doc["updated_at"] = json!(chrono::Utc::now().to_rfc3339());
                    crate::project::write_atomic(&path, &serde_json::to_string_pretty(&doc).map_err(err)?)?;
                }
            }
            Kind::Asset => {}
        }
        self.store.set_disk_state(project_id, entity, rev, &state_hash(payload.as_ref()))
    }

    /// Keep the tree valid after merging concurrent changes from several devices: no chapter in
    /// a deleted folder, no folder cycles, and no chapter text without its chapter.
    fn repair(&self, project_id: &str, dir: &Path, report: &mut SyncReport) -> Result<(), String> {
        let disk = self.read_disk(project_id, dir)?;
        let folders: BTreeMap<String, Option<String>> = disk
            .entities
            .iter()
            .filter_map(|(k, v)| k.strip_prefix("folder:").map(|id| (id.to_string(), v["parentId"].as_str().map(String::from))))
            .collect();
        let mut fixes: Vec<(String, Value)> = Vec::new();
        for (id, parent) in &folders {
            let mut cycle = vec![id.clone()];
            let mut cursor = parent.clone();
            let mut broken = false;
            while let Some(p) = cursor {
                if !folders.contains_key(&p) {
                    broken = true;
                    break;
                }
                if cycle.contains(&p) {
                    // Detach the smallest id in the loop: every device picks the same one.
                    broken = cycle.iter().min() == Some(id);
                    break;
                }
                cycle.push(p.clone());
                cursor = folders[&p].clone();
            }
            if broken && parent.is_some() {
                let mut v = disk.entities[&format!("folder:{id}")].clone();
                v["parentId"] = Value::Null;
                fixes.push((format!("folder:{id}"), v));
            }
        }
        for (key, v) in &disk.entities {
            if key.starts_with("doc:") {
                if let Some(f) = v["folderId"].as_str() {
                    if !folders.contains_key(f) {
                        let mut v = v.clone();
                        v["folderId"] = Value::Null;
                        fixes.push((key.clone(), v));
                    }
                }
            }
        }
        for (entity, value) in fixes {
            let Some((parent, _)) = self.store.disk_state(project_id, &entity)? else { continue };
            let r = Revision::new(&entity, vec![parent], Some(value), &self.device_id);
            self.record_local(project_id, &r)?;
            self.write(project_id, dir, &entity, &r.rev)?;
            report.changed.push(entity);
        }
        Ok(())
    }

    /// The chapter file is missing but its text is live (edit beat a delete, or text arrived
    /// first): rebuild the chapter from its last known metadata, recorded as a revision so every
    /// device reaches the same result.
    fn restore_doc_meta(&self, project_id: &str, id: &str) -> Result<Value, String> {
        let doc_key = format!("doc:{id}");
        let mut meta = json!({"title": "Untitled", "docType": "text", "order": 0, "folderId": null});
        if let Some((doc_rev, _)) = self.store.disk_state(project_id, &doc_key)? {
            match self.payload(project_id, &doc_rev)? {
                Some(live) => meta = live,
                None => {
                    if let Some(last) = self.last_live(project_id, &doc_rev)? {
                        let r = Revision::new(&doc_key, vec![doc_rev], Some(last.clone()), &self.device_id);
                        self.record_local(project_id, &r)?;
                        self.store.set_disk_state(project_id, &doc_key, &r.rev, &state_hash(Some(&last)))?;
                        self.store.add_notice(project_id, &doc_key, "kept", &format!(
                            "Kept \"{}\": it was deleted on one device but edited on another",
                            last["title"].as_str().unwrap_or("Untitled")
                        ))?;
                        meta = last;
                    }
                }
            }
        }
        let mut doc = meta;
        doc["id"] = json!(id);
        doc["content"] = json!("");
        Ok(doc)
    }

    fn last_live(&self, project_id: &str, rev: &str) -> Result<Option<Value>, String> {
        let mut queue = std::collections::VecDeque::from([rev.to_string()]);
        let mut seen = BTreeSet::new();
        while let Some(r) = queue.pop_front() {
            if !seen.insert(r.clone()) {
                continue;
            }
            if let Some(found) = self.store.revision(project_id, &r)? {
                if found.payload.is_some() {
                    return Ok(found.payload);
                }
                queue.extend(found.parents);
            }
        }
        Ok(None)
    }

    /// Apply a staged remote update for a chapter once the writer allows it (or leaves it).
    /// Local edits made in the meantime are captured first and become a conflict, never lost.
    pub fn apply_staged(&self, project_id: &str, dir: &Path, doc_id: &str, report: &mut SyncReport) -> Result<(), String> {
        let mut staged = Vec::new();
        for entity in [format!("doc:{doc_id}"), format!("text:{doc_id}")] {
            if let Some(rev) = self.store.staged(project_id, &entity)? {
                staged.push((entity, rev));
            }
        }
        if staged.is_empty() {
            return Ok(());
        }
        let transports = self.store.project_transports(project_id)?;
        self.scan(project_id, dir, &transports)?;
        for (entity, rev) in staged {
            self.reconcile(project_id, dir, &entity, &[rev], None, report)?;
            self.store.set_staged(project_id, &entity, None)?;
        }
        self.repair(project_id, dir, report)
    }

    // ---- publishing ----------------------------------------------------------------------------

    /// The next batch to publish for a transport (a frozen, previously started one first).
    pub fn next_batch(&self, project_id: &str, transport: &str) -> Result<Option<Batch>, String> {
        if let Some(b) = self.store.pending_batch(project_id, transport)? {
            return Ok(Some(b));
        }
        let revs = self.store.outbox(project_id, transport, MAX_BATCH)?;
        if revs.is_empty() {
            return Ok(None);
        }
        let mut revisions = Vec::new();
        for r in &revs {
            if let Some(rev) = self.store.revision(project_id, r)? {
                revisions.push(rev);
            }
        }
        let batch = Batch {
            schema_version: SCHEMA_VERSION,
            project_id: project_id.into(),
            device_id: self.device_id.clone(),
            device_name: self.device_name.clone(),
            seq: self.store.next_seq(project_id)?,
            created_at: chrono::Utc::now().to_rfc3339(),
            revisions,
        };
        self.store.freeze_batch(&batch, transport)?;
        Ok(Some(batch))
    }

    /// Upload content first, then the batch: a published batch never points at missing bytes.
    pub fn publish(&self, project_id: &str, dir: &Path, transport: &mut dyn Transport) -> Result<usize, TransportError> {
        let tid = transport.id();
        let mut published = 0;
        while let Some(mut batch) = self.next_batch(project_id, tid)? {
            let before = batch.revisions.len();
            let mut kept = Vec::new();
            for rev in std::mem::take(&mut batch.revisions) {
                let Some(sha) = rev.blob() else {
                    kept.push(rev);
                    continue;
                };
                if !self.store.remote_has_blob(project_id, tid, &sha)? {
                    let bytes = match parse_entity(&rev.entity) {
                        Some((Kind::Asset, name)) => fs::read(dir.join("assets").join(name)).ok().filter(|b| model::sha256_hex(b) == sha),
                        _ => self.store.blob(&sha)?,
                    };
                    let Some(bytes) = bytes else {
                        // The bytes are gone locally; a reference to them would stall other devices.
                        self.store.dequeue(project_id, tid, &rev.rev)?;
                        continue;
                    };
                    if !transport.has_blob(project_id, &sha)? {
                        transport.put_blob(project_id, &sha, &bytes)?;
                    }
                    self.store.mark_remote_blob(project_id, tid, &sha)?;
                }
                kept.push(rev);
            }
            batch.revisions = kept;
            if batch.revisions.len() != before {
                // Not uploaded yet, so the frozen batch can still shrink under the same number.
                self.store.refreeze_batch(&batch, tid)?;
            }
            if !batch.revisions.is_empty() {
                transport.put_batch(&batch)?;
            }
            self.store.publish_done(&batch, tid)?;
            published += batch.revisions.len();
        }
        Ok(published)
    }

    /// One full round: capture local edits, apply what others published, publish ours.
    pub fn sync(&self, project_id: &str, dir: &Path, transport: &mut dyn Transport, active_doc: Option<&str>) -> Result<SyncReport, TransportError> {
        let tid = transport.id();
        let mut report = SyncReport::default();
        // A freshly downloaded project is an empty skeleton: pull first so its placeholder
        // metadata never competes with the real project.
        if self.store.is_fresh(project_id)? {
            self.pull(project_id, dir, transport, active_doc, &mut report)?;
            self.store.set_fresh(project_id, false)?;
        }
        self.scan(project_id, dir, &[tid])?;
        self.pull(project_id, dir, transport, active_doc, &mut report)?;
        report.published = self.publish(project_id, dir, transport)?;
        report.changed.sort();
        report.changed.dedup();
        report.staged.sort();
        report.staged.dedup();
        Ok(report)
    }

    fn pull(&self, project_id: &str, dir: &Path, transport: &mut dyn Transport, active_doc: Option<&str>, report: &mut SyncReport) -> Result<(), TransportError> {
        let tid = transport.id();
        let store = self.store;
        let seen = |device: &str, seq: u64| store.batch_applied(project_id, tid, device, seq).unwrap_or(false);
        let mut pending = self.store.held(project_id, tid)?;
        for b in transport.pull(project_id, &seen)? {
            if b.project_id == project_id && !pending.iter().any(|p| p.device_id == b.device_id && p.seq == b.seq) {
                pending.push(b);
            }
        }
        pending.sort_by(|a, b| (a.device_id.as_str(), a.seq).cmp(&(b.device_id.as_str(), b.seq)));
        loop {
            let mut progressed = false;
            let mut waiting = Vec::new();
            for batch in pending {
                if batch.device_id == self.device_id {
                    // Our own batch seen through the remote: nothing to apply.
                    self.store.mark_applied(project_id, tid, &batch.device_id, batch.seq)?;
                    continue;
                }
                if self.apply_batch(project_id, dir, &batch, transport, active_doc, report)? {
                    progressed = true;
                } else {
                    waiting.push(batch);
                }
            }
            pending = waiting;
            if !progressed || pending.is_empty() {
                break;
            }
        }
        for b in &pending {
            self.store.hold(b, tid)?;
        }
        report.held = pending.len();
        Ok(())
    }

    // ---- conflicts -----------------------------------------------------------------------------

    pub fn conflict_versions(&self, project_id: &str, dir: &Path, doc_id: &str) -> Result<Vec<ConflictVersion>, String> {
        let entity = format!("text:{doc_id}");
        let mut out = Vec::new();
        let doc_type = read_json(&dir.join("documents").join(format!("{doc_id}.json")))
            .ok()
            .and_then(|d| d.get("docType").and_then(Value::as_str).map(String::from))
            .unwrap_or_else(|| "text".into());
        let mut revs: Vec<(String, bool)> = Vec::new();
        if let Some((disk, _)) = self.store.disk_state(project_id, &entity)? {
            revs.push((disk, true));
        }
        revs.extend(self.store.conflicts(project_id, &entity)?.into_iter().map(|r| (r, false)));
        for (rev, local) in revs {
            let Some(r) = self.store.revision(project_id, &rev)? else { continue };
            let content = match r.payload.as_ref().and_then(|p| p.get("sha256")).and_then(Value::as_str) {
                Some(sha) => String::from_utf8(self.store.blob(sha)?.unwrap_or_default()).map_err(err)?,
                None => String::new(),
            };
            let device = if r.origin == self.device_id {
                self.device_name.clone()
            } else {
                self.store.device_name(&r.origin)?.unwrap_or_else(|| "Another device".into())
            };
            out.push(ConflictVersion { rev, local, device, content: portable::to_local(&content, &doc_type, dir) });
        }
        Ok(out)
    }

    /// Settle a text conflict: `keep` names the version to keep in place; with `keep_copies`
    /// every other version becomes its own chapter next to it, so nothing is lost either way.
    pub fn resolve(&self, project_id: &str, dir: &Path, doc_id: &str, keep: &str, keep_copies: bool) -> Result<Vec<String>, String> {
        let entity = format!("text:{doc_id}");
        let (disk, _) = self.store.disk_state(project_id, &entity)?.ok_or("Nothing to resolve")?;
        let others = self.store.conflicts(project_id, &entity)?;
        if others.is_empty() {
            return Ok(Vec::new());
        }
        let mut all = vec![disk.clone()];
        all.extend(others.iter().cloned());
        if !all.iter().any(|r| r == keep) {
            return Err("That version is no longer part of the conflict".into());
        }
        let versions = self.conflict_versions(project_id, dir, doc_id)?;
        let mut created = Vec::new();
        if keep_copies {
            let doc_path = dir.join("documents").join(format!("{doc_id}.json"));
            let doc = read_json(&doc_path)?;
            for v in versions.iter().filter(|v| v.rev != keep) {
                let mut copy = doc.clone();
                let id = uuid::Uuid::new_v4().to_string();
                copy["id"] = json!(id);
                copy["title"] = json!(format!("{} ({})", doc["title"].as_str().unwrap_or("Untitled"), v.device));
                copy["content"] = json!(v.content);
                copy["order"] = json!(doc["order"].as_i64().unwrap_or(0) + 1);
                copy["updated_at"] = json!(chrono::Utc::now().to_rfc3339());
                crate::project::write_atomic(&dir.join("documents").join(format!("{id}.json")), &serde_json::to_string_pretty(&copy).map_err(err)?)?;
                created.push(id);
            }
        }
        let merged = Revision::new(&entity, all, self.payload(project_id, keep)?, &self.device_id);
        self.record_local(project_id, &merged)?;
        self.store.set_conflicts(project_id, &entity, &[])?;
        self.store.set_staged(project_id, &entity, None)?;
        self.write(project_id, dir, &entity, &merged.rev)?;
        Ok(created)
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersion {
    pub rev: String,
    pub local: bool,
    pub device: String,
    pub content: String,
}

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;
