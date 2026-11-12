//! Google Drive transport over the hidden `appDataFolder`.
//!
//! Nothing on Drive is ever edited in place except a device's own small catalogue entry.
//! Files (flat names; `appProperties` carry the query keys):
//!   `mnemo-b-<project>-<sha256>`            gzip blob: chapter text or image bytes
//!   `mnemo-o-<project>-<device>-<seq>`      gzip JSON batch of revisions (the commit marker)
//!   `mnemo-i-<project>-<device>`            JSON catalogue entry (project name, device name)
//! Blobs are uploaded before the batch that references them. New batches are found through the
//! Drive changes feed (one cursor per account), with a full listing as the fallback.
use super::super::engine::{Transport, TransportError};
use super::super::model::{self, Batch};
use super::super::store::Store;
use super::auth;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use reqwest::blocking::{Client, RequestBuilder, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::time::Duration;

const FILES: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files";
const CHANGES: &str = "https://www.googleapis.com/drive/v3/changes";
const ABOUT: &str = "https://www.googleapis.com/drive/v3/about";
/// Above this, use a resumable upload session (Drive's multipart limit is 5 MB).
const SIMPLE_LIMIT: usize = 4 * 1024 * 1024;
/// Hard ceiling on any decompressed download (defends against decompression bombs).
const MAX_DOWNLOAD: u64 = 256 * 1024 * 1024;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    pub id: String,
    #[serde(default)]
    pub app_properties: std::collections::BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileList {
    #[serde(default)]
    files: Vec<DriveFile>,
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Change {
    #[serde(default)]
    removed: bool,
    file: Option<DriveFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeList {
    #[serde(default)]
    changes: Vec<Change>,
    next_page_token: Option<String>,
    new_start_page_token: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProject {
    pub project_id: String,
    pub name: String,
    pub device_name: String,
    pub updated_at: String,
}

/// Map an HTTP failure to the engine's error classes. Pure, so it is unit tested.
pub fn classify(status: u16, body: &str) -> TransportError {
    let reason = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/errors/0/reason").and_then(Value::as_str).map(String::from))
        .unwrap_or_default();
    match (status, reason.as_str()) {
        (401, _) => TransportError::Auth("Google Drive sign-in expired".into()),
        (403, "storageQuotaExceeded") => TransportError::Quota("Your Google Drive storage is full".into()),
        (403, "rateLimitExceeded" | "userRateLimitExceeded" | "backendError") | (429, _) => TransportError::Busy("Google Drive asked MnemoScript to slow down".into()),
        (403, "insufficientPermissions" | "insufficientScopes" | "appNotAuthorizedToFile") => {
            TransportError::Auth("MnemoScript no longer has access to its Drive folder".into())
        }
        (500..=599, _) => TransportError::Busy(format!("Google Drive is temporarily unavailable ({status})")),
        _ => TransportError::Other(format!("Google Drive request failed ({status}{})", if reason.is_empty() { String::new() } else { format!(": {reason}") })),
    }
}

fn net(e: reqwest::Error) -> TransportError {
    if e.is_connect() || e.is_timeout() || e.is_request() {
        TransportError::Offline("Can't reach Google Drive".into())
    } else {
        TransportError::Other(e.to_string())
    }
}

fn auth_err(e: auth::AuthError) -> TransportError {
    match e {
        auth::AuthError::Revoked(m) => TransportError::Auth(m),
        auth::AuthError::Network(_) => TransportError::Offline("Can't reach Google".into()),
        auth::AuthError::Other(m) => TransportError::Auth(m),
    }
}

pub fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut e = GzEncoder::new(Vec::new(), flate2::Compression::default());
    e.write_all(bytes).expect("in-memory gzip");
    e.finish().expect("in-memory gzip")
}

pub fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, TransportError> {
    let mut out = Vec::new();
    GzDecoder::new(bytes)
        .take(MAX_DOWNLOAD + 1)
        .read_to_end(&mut out)
        .map_err(|_| TransportError::Other("A Drive file is damaged".into()))?;
    if out.len() as u64 > MAX_DOWNLOAD {
        return Err(TransportError::Other("A Drive file is too large".into()));
    }
    Ok(out)
}

/// Drive query for files with all of the given app properties. Values are validated ids.
pub fn query(props: &[(&str, &str)]) -> String {
    props
        .iter()
        .map(|(k, v)| format!("appProperties has {{ key='{k}' and value='{}' }}", v.replace(['\\', '\''], "")))
        .collect::<Vec<_>>()
        .join(" and ")
}

pub struct Drive {
    http: Client,
}

impl Default for Drive {
    fn default() -> Self {
        Self::new()
    }
}

impl Drive {
    pub fn new() -> Self {
        Drive {
            http: Client::builder()
                .timeout(Duration::from_secs(120))
                .connect_timeout(Duration::from_secs(15))
                .user_agent("MnemoScript")
                .build()
                .expect("HTTP client"),
        }
    }

    /// Send with a bearer token; on 401 refresh once and retry.
    fn send(&self, build: &dyn Fn(&Client) -> RequestBuilder) -> Result<Response, TransportError> {
        for attempt in 0..2 {
            let token = auth::access_token(attempt > 0).map_err(auth_err)?;
            let response = build(&self.http).bearer_auth(token).send().map_err(net)?;
            let status = response.status().as_u16();
            if status == 401 && attempt == 0 {
                auth::forget_access();
                continue;
            }
            if response.status().is_success() {
                return Ok(response);
            }
            if status == 404 {
                return Ok(response);
            }
            let body = response.text().unwrap_or_default();
            return Err(classify(status, &body));
        }
        Err(TransportError::Auth("Google Drive sign-in expired".into()))
    }

    fn json<T: for<'de> Deserialize<'de>>(&self, build: &dyn Fn(&Client) -> RequestBuilder) -> Result<Option<T>, TransportError> {
        let r = self.send(build)?;
        if r.status().as_u16() == 404 {
            return Ok(None);
        }
        r.json().map(Some).map_err(|e| TransportError::Other(e.to_string()))
    }

    pub fn about(&self) -> Result<Account, TransportError> {
        let v: Value = self
            .json(&|c| c.get(ABOUT).query(&[("fields", "user(displayName,emailAddress,permissionId)")]))?
            .ok_or_else(|| TransportError::Other("Drive account not found".into()))?;
        let user = &v["user"];
        let id = user["permissionId"].as_str().ok_or_else(|| TransportError::Other("Drive did not identify the account".into()))?;
        Ok(Account {
            id: id.into(),
            email: user["emailAddress"].as_str().unwrap_or_default().into(),
            name: user["displayName"].as_str().unwrap_or_default().into(),
        })
    }

    pub fn list(&self, q: &str) -> Result<Vec<DriveFile>, TransportError> {
        let mut out = Vec::new();
        let mut page: Option<String> = None;
        loop {
            let token = page.clone();
            let list: FileList = self
                .json(&|c| {
                    let mut r = c.get(FILES).query(&[
                        ("spaces", "appDataFolder"),
                        ("q", q),
                        ("pageSize", "1000"),
                        ("fields", "nextPageToken,files(id,appProperties)"),
                    ]);
                    if let Some(t) = &token {
                        r = r.query(&[("pageToken", t.as_str())]);
                    }
                    r
                })?
                .ok_or_else(|| TransportError::Other("Drive listing failed".into()))?;
            out.extend(list.files);
            match list.next_page_token {
                Some(t) => page = Some(t),
                None => return Ok(out),
            }
        }
    }

    pub fn download(&self, id: &str) -> Result<Option<Vec<u8>>, TransportError> {
        let url = format!("{FILES}/{id}");
        let r = self.send(&|c| c.get(&url).query(&[("alt", "media")]))?;
        if r.status().as_u16() == 404 {
            return Ok(None);
        }
        let mut bytes = Vec::new();
        r.take(MAX_DOWNLOAD + 1).read_to_end(&mut bytes).map_err(|e| TransportError::Offline(e.to_string()))?;
        Ok(Some(bytes))
    }

    pub fn create(&self, name: &str, props: Value, bytes: &[u8], mime: &str) -> Result<String, TransportError> {
        let meta = json!({"name": name, "parents": ["appDataFolder"], "appProperties": props});
        let v: Value = if bytes.len() <= SIMPLE_LIMIT {
            let boundary = format!("mnemo{}", uuid::Uuid::new_v4().simple());
            let mut body = Vec::with_capacity(bytes.len() + 512);
            body.extend_from_slice(format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n").as_bytes());
            body.extend_from_slice(bytes);
            body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
            self.json(&|c| {
                c.post(UPLOAD)
                    .query(&[("uploadType", "multipart"), ("fields", "id")])
                    .header("Content-Type", format!("multipart/related; boundary={boundary}"))
                    .body(body.clone())
            })?
        } else {
            let session = self.send(&|c| {
                c.post(UPLOAD)
                    .query(&[("uploadType", "resumable"), ("fields", "id")])
                    .header("X-Upload-Content-Type", mime)
                    .json(&meta)
            })?;
            let location = session
                .headers()
                .get("location")
                .and_then(|l| l.to_str().ok())
                .ok_or_else(|| TransportError::Other("Drive did not start the upload".into()))?
                .to_string();
            self.json(&|c| c.put(&location).header("Content-Type", mime).body(bytes.to_vec()))?
        }
        .ok_or_else(|| TransportError::Other("Drive upload failed".into()))?;
        v["id"].as_str().map(String::from).ok_or_else(|| TransportError::Other("Drive upload returned no id".into()))
    }

    pub fn update(&self, id: &str, bytes: &[u8], mime: &str) -> Result<bool, TransportError> {
        let url = format!("{UPLOAD}/{id}");
        let r = self.send(&|c| c.patch(&url).query(&[("uploadType", "media")]).header("Content-Type", mime).body(bytes.to_vec()))?;
        Ok(r.status().as_u16() != 404)
    }

    pub fn start_page_token(&self) -> Result<String, TransportError> {
        let v: Value = self
            .json(&|c| c.get(format!("{CHANGES}/startPageToken")))?
            .ok_or_else(|| TransportError::Other("Drive changes are unavailable".into()))?;
        v["startPageToken"].as_str().map(String::from).ok_or_else(|| TransportError::Other("Drive returned no change cursor".into()))
    }

    /// New/changed files since `token`, and the cursor to continue from. `Ok(None)` when the
    /// cursor is no longer valid (the caller falls back to a full listing).
    pub fn changes(&self, token: &str) -> Result<Option<(Vec<DriveFile>, String)>, TransportError> {
        let mut files = Vec::new();
        let mut page = token.to_string();
        loop {
            let current = page.clone();
            let r = self.send(&|c| {
                c.get(CHANGES).query(&[
                    ("pageToken", current.as_str()),
                    ("spaces", "appDataFolder"),
                    ("pageSize", "1000"),
                    ("fields", "nextPageToken,newStartPageToken,changes(removed,file(id,appProperties))"),
                ])
            });
            let list: ChangeList = match r {
                Ok(r) if r.status().as_u16() == 404 => return Ok(None),
                Ok(r) => r.json().map_err(|e| TransportError::Other(e.to_string()))?,
                Err(TransportError::Other(m)) if m.contains("(400") || m.contains("(410") => return Ok(None),
                Err(e) => return Err(e),
            };
            files.extend(list.changes.into_iter().filter(|c| !c.removed).filter_map(|c| c.file));
            if let Some(next) = list.next_page_token {
                page = next;
                continue;
            }
            return Ok(Some((files, list.new_start_page_token.unwrap_or(page))));
        }
    }

    // ---- catalogue -------------------------------------------------------------------------

    pub fn remote_projects(&self) -> Result<Vec<RemoteProject>, TransportError> {
        let mut by_project: std::collections::BTreeMap<String, RemoteProject> = Default::default();
        for f in self.list(&query(&[("m", "1"), ("k", "i")]))? {
            let Some(bytes) = self.download(&f.id)? else { continue };
            let Ok(entry) = serde_json::from_slice::<RemoteProject>(&bytes) else { continue };
            if !model::safe_id(&entry.project_id) || f.app_properties.get("p") != Some(&entry.project_id) {
                continue;
            }
            let newer = by_project.get(&entry.project_id).is_none_or(|e| e.updated_at < entry.updated_at);
            if newer {
                by_project.insert(entry.project_id.clone(), entry);
            }
        }
        Ok(by_project.into_values().collect())
    }

    /// Create or refresh this device's catalogue entry for a project.
    pub fn publish_info(&self, store: &Store, project_id: &str, name: &str, device_id: &str, device_name: &str) -> Result<(), TransportError> {
        let entry = RemoteProject {
            project_id: project_id.into(),
            name: name.into(),
            device_name: device_name.into(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        let bytes = serde_json::to_vec(&entry).map_err(|e| TransportError::Other(e.to_string()))?;
        let key = format!("drive.info.{project_id}");
        if store.get_meta(&format!("{key}.name"))?.as_deref() == Some(name) {
            return Ok(());
        }
        if let Some(id) = store.get_meta(&key)? {
            if self.update(&id, &bytes, "application/json")? {
                store.set_meta(&format!("{key}.name"), name)?;
                return Ok(());
            }
        }
        let id = self.create(
            &format!("mnemo-i-{project_id}-{device_id}"),
            json!({"m": "1", "k": "i", "p": project_id, "d": device_id}),
            &bytes,
            "application/json",
        )?;
        store.set_meta(&key, &id)?;
        store.set_meta(&format!("{key}.name"), name)?;
        Ok(())
    }
}

/// Remember batch files found on Drive (from the change feed or a listing).
fn record_batches(store: &Store, files: &[DriveFile]) -> Result<(), String> {
    for f in files {
        let p = &f.app_properties;
        if p.get("m").map(String::as_str) != Some("1") || p.get("k").map(String::as_str) != Some("o") {
            continue;
        }
        let (Some(project), Some(device), Some(seq)) = (p.get("p"), p.get("d"), p.get("s").and_then(|s| s.parse::<u64>().ok())) else { continue };
        if !model::safe_id(project) || !model::safe_id(device) {
            continue;
        }
        // The first file wins for a (device, seq): a retried upload's duplicate is ignored.
        store
            .conn
            .execute(
                "INSERT OR IGNORE INTO drive_files (project_id, device, seq, file_id) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![project, device, seq as i64, f.id],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn ensure_tables(store: &Store) -> Result<(), String> {
    store
        .conn
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS drive_files (project_id TEXT NOT NULL, device TEXT NOT NULL, seq INTEGER NOT NULL, file_id TEXT NOT NULL, PRIMARY KEY (project_id, device, seq));
             CREATE TABLE IF NOT EXISTS drive_blob_ids (project_id TEXT NOT NULL, sha TEXT NOT NULL, file_id TEXT NOT NULL, PRIMARY KEY (project_id, sha));",
        )
        .map_err(|e| e.to_string())
}

/// Read the change feed once per round for every project (one cheap request when idle).
pub fn refresh_changes(drive: &Drive, store: &Store, account: &str) -> Result<(), TransportError> {
    ensure_tables(store)?;
    let key = format!("drive.cursor.{account}");
    match store.get_meta(&key)? {
        None => {
            // Take the cursor *before* any listing so nothing published meanwhile is missed.
            let token = drive.start_page_token()?;
            store.set_meta(&key, &token)?;
        }
        Some(token) => match drive.changes(&token)? {
            Some((files, next)) => {
                record_batches(store, &files)?;
                store.set_meta(&key, &next)?;
            }
            None => {
                // The cursor expired: start again and re-list every synced project.
                store.delete_meta(&key)?;
                store.conn.execute("DELETE FROM meta WHERE key LIKE 'drive.listed.%'", []).map_err(|e| e.to_string())?;
                let token = drive.start_page_token()?;
                store.set_meta(&key, &token)?;
            }
        },
    }
    Ok(())
}

pub struct DriveTransport<'a> {
    pub drive: &'a Drive,
    pub store: &'a Store,
    pub device_id: String,
}

impl DriveTransport<'_> {
    fn blob_file(&mut self, project_id: &str, sha: &str) -> Result<Option<String>, TransportError> {
        let cached: Option<String> = self
            .store
            .conn
            .query_row("SELECT file_id FROM drive_blob_ids WHERE project_id = ?1 AND sha = ?2", [project_id, sha], |r| r.get(0))
            .ok();
        if cached.is_some() {
            return Ok(cached);
        }
        let found = self.drive.list(&query(&[("k", "b"), ("p", project_id), ("h", sha)]))?.into_iter().next().map(|f| f.id);
        if let Some(id) = &found {
            self.store
                .conn
                .execute("INSERT OR IGNORE INTO drive_blob_ids (project_id, sha, file_id) VALUES (?1, ?2, ?3)", [project_id, sha, id])
                .map_err(|e| TransportError::Other(e.to_string()))?;
        }
        Ok(found)
    }
}

impl Transport for DriveTransport<'_> {
    fn id(&self) -> &'static str {
        "drive"
    }

    fn has_blob(&mut self, project_id: &str, sha: &str) -> Result<bool, TransportError> {
        Ok(self.blob_file(project_id, sha)?.is_some())
    }

    fn put_blob(&mut self, project_id: &str, sha: &str, bytes: &[u8]) -> Result<(), TransportError> {
        let id = self.drive.create(
            &format!("mnemo-b-{project_id}-{sha}"),
            json!({"m": "1", "k": "b", "p": project_id, "h": sha}),
            &gzip(bytes),
            "application/gzip",
        )?;
        self.store
            .conn
            .execute("INSERT OR IGNORE INTO drive_blob_ids (project_id, sha, file_id) VALUES (?1, ?2, ?3)", [project_id, sha, &id])
            .map_err(|e| TransportError::Other(e.to_string()))?;
        Ok(())
    }

    fn get_blob(&mut self, project_id: &str, sha: &str) -> Result<Option<Vec<u8>>, TransportError> {
        let Some(id) = self.blob_file(project_id, sha)? else { return Ok(None) };
        match self.drive.download(&id)? {
            Some(bytes) => gunzip(&bytes).map(Some),
            None => {
                self.store.conn.execute("DELETE FROM drive_blob_ids WHERE file_id = ?1", [&id]).map_err(|e| TransportError::Other(e.to_string()))?;
                Ok(None)
            }
        }
    }

    fn put_batch(&mut self, batch: &Batch) -> Result<(), TransportError> {
        let seq = batch.seq.to_string();
        let props = [("k", "o"), ("p", batch.project_id.as_str()), ("d", batch.device_id.as_str()), ("s", seq.as_str())];
        // A retry after a lost reply must not publish a second copy.
        if !self.drive.list(&query(&props))?.is_empty() {
            return Ok(());
        }
        let body = serde_json::to_vec(batch).map_err(|e| TransportError::Other(e.to_string()))?;
        self.drive.create(
            &format!("mnemo-o-{}-{}-{:08}", batch.project_id, batch.device_id, batch.seq),
            json!({"m": "1", "k": "o", "p": batch.project_id, "d": batch.device_id, "s": seq}),
            &gzip(&body),
            "application/gzip",
        )?;
        Ok(())
    }

    fn pull(&mut self, project_id: &str, seen: &dyn Fn(&str, u64) -> bool) -> Result<Vec<Batch>, TransportError> {
        ensure_tables(self.store)?;
        let listed = format!("drive.listed.{project_id}");
        if self.store.get_meta(&listed)?.is_none() {
            let files = self.drive.list(&query(&[("m", "1"), ("k", "o"), ("p", project_id)]))?;
            record_batches(self.store, &files)?;
            self.store.set_meta(&listed, "1")?;
        }
        let rows: Vec<(String, i64, String)> = {
            let mut stmt = self
                .store
                .conn
                .prepare("SELECT device, seq, file_id FROM drive_files WHERE project_id = ?1 ORDER BY device, seq")
                .map_err(|e| TransportError::Other(e.to_string()))?;
            let rows = stmt
                .query_map([project_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(|e| TransportError::Other(e.to_string()))?;
            rows.collect::<Result<_, _>>().map_err(|e| TransportError::Other(e.to_string()))?
        };
        let mut out = Vec::new();
        for (device, seq, file) in rows {
            if device == self.device_id || seen(&device, seq as u64) {
                continue;
            }
            let Some(bytes) = self.drive.download(&file)? else {
                self.store.conn.execute("DELETE FROM drive_files WHERE file_id = ?1", [&file]).map_err(|e| TransportError::Other(e.to_string()))?;
                continue;
            };
            match serde_json::from_slice::<Batch>(&gunzip(&bytes)?) {
                Ok(b) if b.device_id == device && b.seq == seq as u64 && b.project_id == project_id => out.push(b),
                // A file whose content contradicts its labels is ignored, never applied.
                _ => log::warn!("ignoring malformed sync batch {file}"),
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_map_to_actionable_states() {
        let quota = r#"{"error":{"errors":[{"reason":"storageQuotaExceeded"}],"code":403}}"#;
        let rate = r#"{"error":{"errors":[{"reason":"userRateLimitExceeded"}],"code":403}}"#;
        assert!(matches!(classify(403, quota), TransportError::Quota(_)));
        assert!(matches!(classify(403, rate), TransportError::Busy(_)));
        assert!(matches!(classify(429, ""), TransportError::Busy(_)));
        assert!(matches!(classify(503, ""), TransportError::Busy(_)));
        assert!(matches!(classify(401, ""), TransportError::Auth(_)));
        assert!(matches!(classify(400, "{}"), TransportError::Other(_)));
    }

    #[test]
    fn queries_escape_values_and_target_app_properties() {
        assert_eq!(query(&[("k", "o"), ("p", "a'b")]), "appProperties has { key='k' and value='o' } and appProperties has { key='p' and value='ab' }");
    }

    #[test]
    fn gzip_round_trips_and_rejects_garbage() {
        let data = b"<p>The bells rang at dawn.</p>".repeat(100);
        let packed = gzip(&data);
        assert!(packed.len() < data.len());
        assert_eq!(gunzip(&packed).unwrap(), data);
        assert!(gunzip(b"not gzip").is_err());
    }

    #[test]
    fn duplicate_batch_files_keep_the_first_and_ignore_foreign_labels() {
        let store = Store::memory();
        ensure_tables(&store).unwrap();
        let file = |id: &str, props: &[(&str, &str)]| DriveFile {
            id: id.into(),
            app_properties: props.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        };
        record_batches(
            &store,
            &[
                file("f1", &[("m", "1"), ("k", "o"), ("p", "proj"), ("d", "dev"), ("s", "1")]),
                file("f2", &[("m", "1"), ("k", "o"), ("p", "proj"), ("d", "dev"), ("s", "1")]),
                file("f3", &[("m", "1"), ("k", "o"), ("p", "../x"), ("d", "dev"), ("s", "2")]),
                file("f4", &[("m", "1"), ("k", "b"), ("p", "proj"), ("h", "abc")]),
            ],
        )
        .unwrap();
        let ids: Vec<String> = store.conn.prepare("SELECT file_id FROM drive_files").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        assert_eq!(ids, vec!["f1".to_string()]);
    }
}
