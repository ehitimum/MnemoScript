//! The sync service: a background worker that runs sync rounds, and the Tauri commands the
//! frontend reaches through `lib/api.ts`. Saving never waits for it; a save only nudges it.
use super::drive::api::{self as drive_api, Account, Drive, DriveTransport, RemoteProject};
use super::drive::auth;
use super::engine::{ConflictVersion, Engine, SyncReport, TransportError};
use super::model;
use super::store::Store;
use crate::project::{Project, Registry};
use crate::ApiResponse;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const POLL: Duration = Duration::from_secs(90);
const SAVE_DELAY: Duration = Duration::from_secs(8);
const MAX_BACKOFF: Duration = Duration::from_secs(15 * 60);

/// One sync round (or engine-changing command) at a time.
static ENGINE: Mutex<()> = Mutex::new(());
static SERVICE: OnceLock<Service> = OnceLock::new();

struct Wake {
    due: Option<Instant>,
    backoff: Duration,
}

#[derive(Default, Clone)]
struct Global {
    state: String,
    message: Option<String>,
    last_round: Option<String>,
}

struct Service {
    app: Option<AppHandle>,
    wake: Mutex<Wake>,
    cv: Condvar,
    active: Mutex<Option<(String, String)>>,
    global: Mutex<Global>,
}

fn service() -> Option<&'static Service> {
    SERVICE.get()
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

fn db_path() -> PathBuf {
    crate::project::data_dir().join("sync").join("mnemosync.db")
}

fn open_store() -> Result<Store, String> {
    let store = Store::open(&db_path())?;
    drive_api::ensure_tables(&store)?;
    Ok(store)
}

pub fn device_name() -> String {
    if cfg!(target_os = "android") {
        return "Android device".into();
    }
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Desktop".into())
}

fn account(store: &Store) -> Result<Option<Account>, String> {
    store.get_meta("drive.account")?.map(|a| serde_json::from_str(&a).map_err(|e| e.to_string())).transpose()
}

/// Start the worker (once, from the Tauri setup hook).
pub fn start(app: AppHandle) {
    let svc = Service {
        app: Some(app),
        wake: Mutex::new(Wake { due: Some(Instant::now() + Duration::from_secs(3)), backoff: POLL }),
        cv: Condvar::new(),
        active: Mutex::new(None),
        global: Mutex::new(Global { state: "idle".into(), ..Default::default() }),
    };
    if SERVICE.set(svc).is_err() {
        return;
    }
    std::thread::Builder::new()
        .name("mnemosync".into())
        .spawn(worker)
        .expect("sync worker thread");
}

/// A save happened: sync soon (debounced so a burst of saves makes one round).
pub fn nudge(project_id: &str) {
    let Some(s) = service() else { return };
    if !model::safe_id(project_id) {
        return;
    }
    let mut w = lock(&s.wake);
    let soon = Instant::now() + SAVE_DELAY;
    if w.due.is_none_or(|d| d > soon) {
        w.due = Some(soon);
    }
    s.cv.notify_all();
}

/// The project left this device's library: stop syncing it here. Its history stays, so adding
/// it again later resumes instead of duplicating.
pub fn forget(project_id: &str) {
    if service().is_none() {
        return;
    }
    let _guard = lock(&ENGINE);
    if let Ok(store) = open_store() {
        let _ = store.disable_project(project_id);
    }
}

fn wake_now() {
    if let Some(s) = service() {
        lock(&s.wake).due = Some(Instant::now());
        s.cv.notify_all();
    }
}

fn worker() {
    let Some(s) = service() else { return };
    loop {
        {
            let mut w = lock(&s.wake);
            loop {
                let now = Instant::now();
                match w.due {
                    Some(due) if due <= now => break,
                    Some(due) => w = s.cv.wait_timeout(w, due - now).unwrap_or_else(|p| p.into_inner()).0,
                    None => w = s.cv.wait(w).unwrap_or_else(|p| p.into_inner()),
                }
            }
            w.due = None;
        }
        let outcome = round(None);
        let mut w = lock(&s.wake);
        let next = match outcome {
            Round::Idle => None,
            Round::Ok => {
                w.backoff = POLL;
                Some(POLL)
            }
            Round::Retry => {
                w.backoff = (w.backoff * 2).clamp(Duration::from_secs(30), MAX_BACKOFF);
                Some(w.backoff)
            }
        };
        if let Some(delay) = next {
            let at = Instant::now() + delay;
            if w.due.is_none_or(|d| d > at) {
                w.due = Some(at);
            }
        }
    }
}

enum Round {
    /// Nothing to do (signed out / nothing enabled): sleep until nudged.
    Idle,
    Ok,
    Retry,
}

fn set_global(state: &str, message: Option<String>) {
    if let Some(s) = service() {
        let mut g = lock(&s.global);
        g.state = state.into();
        g.message = message;
        if state == "idle" {
            g.last_round = Some(chrono::Utc::now().to_rfc3339());
        }
    }
    emit("sync://status", status_value());
}

fn emit(event: &str, payload: Value) {
    if let Some(app) = service().and_then(|s| s.app.as_ref()) {
        let _ = app.emit(event, payload);
    }
}

fn active_doc(project_id: &str) -> Option<String> {
    let s = service()?;
    lock(&s.active).as_ref().filter(|(p, _)| p == project_id).map(|(_, d)| d.clone())
}

/// Rebuild project.json's content-free document index after remote changes so the library and
/// `list_projects` see the same chapters as the documents folder.
fn refresh_index(dir: &Path) -> Result<(), String> {
    let project = Project::load_from_path(dir)?;
    project.save()
}

fn after_changes(project_id: &str, dir: &Path, report: &SyncReport) {
    if report.changed.is_empty() && report.staged.is_empty() {
        return;
    }
    if !report.changed.is_empty() {
        if let Err(e) = refresh_index(dir) {
            log::warn!("sync: index refresh failed: {e}");
        }
    }
    emit("sync://applied", json!({"projectId": project_id, "changed": report.changed, "staged": report.staged}));
}

/// Run a sync round for every enabled project (or just `only`). Holds the engine lock.
fn round(only: Option<&str>) -> Round {
    let _guard = lock(&ENGINE);
    let store = match open_store() {
        Ok(s) => s,
        Err(e) => {
            set_global("error", Some(e));
            return Round::Retry;
        }
    };
    let projects = store.enabled_projects().unwrap_or_default();
    let Ok(Some(acct)) = account(&store) else {
        set_global("signed-out", None);
        return Round::Idle;
    };
    if projects.is_empty() {
        set_global("idle", None);
        return Round::Idle;
    }
    if !auth::has_grant() && !cfg!(target_os = "android") {
        set_global("needs-auth", Some("Sign in to Google Drive again to keep syncing".into()));
        return Round::Idle;
    }
    set_global("syncing", None);
    let drive = Drive::new();
    if let Err(e) = drive_api::refresh_changes(&drive, &store, &acct.id) {
        return fail(e);
    }
    let name = device_name();
    let mut worst: Option<TransportError> = None;
    for (project_id, project_account) in projects {
        if only.is_some_and(|o| o != project_id) || project_account != acct.id {
            continue;
        }
        let dir = Project::resolve_dir(&project_id);
        if !dir.join("project.json").exists() {
            let _ = store.set_project_result(&project_id, Some("The project folder is missing on this device"));
            continue;
        }
        let Ok(engine) = Engine::new(&store, &name) else { continue };
        let mut transport = DriveTransport { drive: &drive, store: &store, device_id: engine.device_id.clone() };
        let active = active_doc(&project_id);
        match engine.sync(&project_id, &dir, &mut transport, active.as_deref()) {
            Ok(report) => {
                let _ = store.set_project_result(&project_id, None);
                after_changes(&project_id, &dir, &report);
                if let Ok(project) = Project::load_from_path(&dir) {
                    if let Err(e) = drive.publish_info(&store, &project_id, &project.name, &engine.device_id, &name) {
                        log::warn!("sync: catalogue update failed: {e}");
                    }
                }
            }
            Err(e) => {
                let _ = store.set_project_result(&project_id, Some(&e.to_string()));
                let severe = matches!(e, TransportError::Auth(_) | TransportError::Offline(_));
                if worst.is_none() || severe {
                    worst = Some(e);
                }
            }
        }
    }
    match worst {
        None => {
            set_global("idle", None);
            Round::Ok
        }
        Some(e) => fail(e),
    }
}

fn fail(e: TransportError) -> Round {
    match e {
        TransportError::Auth(m) => {
            set_global("needs-auth", Some(m));
            Round::Idle
        }
        TransportError::Offline(m) => {
            set_global("offline", Some(m));
            Round::Retry
        }
        TransportError::Busy(m) => {
            set_global("busy", Some(m));
            Round::Retry
        }
        TransportError::Quota(m) => {
            set_global("error", Some(m));
            Round::Retry
        }
        TransportError::Other(m) => {
            set_global("error", Some(m));
            Round::Retry
        }
    }
}

// ---- status ---------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSummary {
    pub doc_id: String,
    pub title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatus {
    pub project_id: String,
    pub state: String,
    pub pending: u64,
    pub conflicts: Vec<ConflictSummary>,
    pub staged: Vec<String>,
    pub last_sync: Option<String>,
    pub error: Option<String>,
    pub notices: Vec<Notice>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub id: i64,
    pub kind: String,
    pub detail: String,
    pub created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub configured: bool,
    pub platform: &'static str,
    pub account: Option<Account>,
    pub state: String,
    pub message: Option<String>,
    pub last_round: Option<String>,
    pub device_name: String,
    pub projects: Vec<ProjectStatus>,
}

fn doc_title(dir: &Path, doc_id: &str) -> String {
    std::fs::read(dir.join("documents").join(format!("{doc_id}.json")))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|d| d["title"].as_str().map(String::from))
        .unwrap_or_else(|| "Untitled".into())
}

fn project_status(store: &Store, project_id: &str, global: &str) -> Result<ProjectStatus, String> {
    let dir = Project::resolve_dir(project_id);
    let pending = store.outbox_len(project_id, "drive")?;
    let conflicts: Vec<ConflictSummary> = store
        .conflicted_entities(project_id)?
        .into_iter()
        .filter_map(|e| e.strip_prefix("text:").map(String::from))
        .map(|doc_id| ConflictSummary { title: doc_title(&dir, &doc_id), doc_id })
        .collect();
    let mut staged: Vec<String> = store
        .staged_entities(project_id)?
        .into_iter()
        .filter_map(|e| e.split_once(':').map(|(_, id)| id.to_string()))
        .collect();
    staged.sort();
    staged.dedup();
    let (last_sync, error) = store.project_result(project_id)?;
    let acct = account(store)?;
    let state = if store.project_account(project_id)? != acct.as_ref().map(|a| a.id.clone()) {
        "account-mismatch"
    } else if !conflicts.is_empty() {
        "conflict"
    } else if error.is_some() && global != "syncing" {
        match global {
            "offline" => "offline",
            "needs-auth" => "needs-auth",
            _ => "error",
        }
    } else if global == "syncing" {
        "syncing"
    } else if pending > 0 || last_sync.is_none() {
        "pending"
    } else {
        "synced"
    };
    let notices = store
        .notices(project_id, 20)?
        .into_iter()
        .map(|(id, _, kind, detail, created_at)| Notice { id, kind, detail, created_at })
        .collect();
    Ok(ProjectStatus { project_id: project_id.into(), state: state.into(), pending, conflicts, staged, last_sync, error, notices })
}

fn status_value() -> Value {
    serde_json::to_value(status().unwrap_or_else(|e| SyncStatus {
        configured: auth::configured(),
        platform: platform(),
        account: None,
        state: "error".into(),
        message: Some(e),
        last_round: None,
        device_name: device_name(),
        projects: Vec::new(),
    }))
    .unwrap_or(Value::Null)
}

fn platform() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else if cfg!(any(target_os = "ios")) {
        "ios"
    } else {
        "desktop"
    }
}

pub fn status() -> Result<SyncStatus, String> {
    let store = open_store()?;
    let g = service().map(|s| lock(&s.global).clone()).unwrap_or_default();
    let acct = account(&store)?;
    let state = if !auth::configured() {
        "unconfigured".to_string()
    } else if acct.is_none() {
        "signed-out".to_string()
    } else if !cfg!(target_os = "android") && !auth::has_grant() {
        // Signed out (or revoked) while projects stay bound to this account: offer Reconnect.
        "needs-auth".to_string()
    } else if g.state.is_empty() {
        "idle".to_string()
    } else {
        g.state.clone()
    };
    let projects = store
        .enabled_projects()?
        .into_iter()
        .map(|(id, _)| project_status(&store, &id, &state))
        .collect::<Result<_, _>>()?;
    Ok(SyncStatus {
        configured: auth::configured(),
        platform: platform(),
        account: acct,
        state,
        message: g.message,
        last_round: g.last_round,
        device_name: device_name(),
        projects,
    })
}

// ---- commands ---------------------------------------------------------------------------------

fn respond<T>(r: Result<T, String>) -> ApiResponse<T> {
    match r {
        Ok(v) => ApiResponse::success(v),
        Err(e) => ApiResponse::error(e),
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> ApiResponse<T> {
    respond(tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string()).and_then(|r| r))
}

fn valid_project(project_id: &str) -> Result<(), String> {
    if uuid::Uuid::parse_str(project_id).is_ok() || model::safe_id(project_id) {
        Ok(())
    } else {
        Err("Invalid project".into())
    }
}

/// After a grant: identify the Google account and refuse to silently switch accounts.
fn adopt_account() -> Result<Account, String> {
    let fresh = Drive::new().about().map_err(|e| e.to_string())?;
    let store = open_store()?;
    if let Some(previous) = account(&store)? {
        if previous.id != fresh.id && !store.enabled_projects()?.is_empty() {
            // Keep the grant out of use: projects stay tied to the account they were synced with.
            let _ = auth::sign_out();
            return Err(format!(
                "Signed in as {}, but this device syncs with {}. Sign in with that account, or turn sync off for every project first.",
                if fresh.email.is_empty() { "another account".to_string() } else { fresh.email.clone() },
                if previous.email.is_empty() { "another account".to_string() } else { previous.email.clone() },
            ));
        }
    }
    store.set_meta("drive.account", &serde_json::to_string(&fresh).map_err(|e| e.to_string())?)?;
    Ok(fresh)
}

#[tauri::command]
pub fn sync_status() -> ApiResponse<SyncStatus> {
    respond(status())
}

#[tauri::command]
pub async fn drive_sign_in() -> ApiResponse<SyncStatus> {
    blocking(|| {
        auth::sign_in().map_err(|e| e.to_string())?;
        adopt_account()?;
        wake_now();
        status()
    })
    .await
}

#[tauri::command]
pub fn drive_cancel_sign_in() -> ApiResponse<()> {
    auth::cancel_sign_in();
    ApiResponse::success(())
}

/// Android: an access token from Google's native authorization prompt.
#[tauri::command]
pub async fn drive_set_access_token(token: String, expires_in: u64) -> ApiResponse<SyncStatus> {
    blocking(move || {
        if token.trim().is_empty() || token.len() > 4096 {
            return Err("Invalid Google authorization".into());
        }
        auth::set_access_token(token.trim(), expires_in.clamp(60, 3600));
        adopt_account()?;
        wake_now();
        status()
    })
    .await
}

/// Sign out of Google on this device. Synced projects stay on disk and keep their history,
/// so signing back in with the same account resumes without duplicating anything.
#[tauri::command]
pub async fn drive_sign_out() -> ApiResponse<SyncStatus> {
    blocking(|| {
        let _guard = lock(&ENGINE);
        auth::sign_out()?;
        let store = open_store()?;
        if store.enabled_projects()?.is_empty() {
            store.delete_meta("drive.account")?;
        }
        drop(store);
        set_global("signed-out", None);
        status()
    })
    .await
}

#[tauri::command]
pub async fn sync_enable_project(project_id: String) -> ApiResponse<SyncStatus> {
    blocking(move || {
        valid_project(&project_id)?;
        {
            let _guard = lock(&ENGINE);
            let store = open_store()?;
            let acct = account(&store)?.ok_or("Sign in to Google Drive first")?;
            if !Project::resolve_dir(&project_id).join("project.json").exists() {
                return Err("Project not found".into());
            }
            store.enable_project(&project_id, &acct.id, false)?;
        }
        wake_now();
        status()
    })
    .await
}

#[tauri::command]
pub async fn sync_disable_project(project_id: String) -> ApiResponse<SyncStatus> {
    blocking(move || {
        let _guard = lock(&ENGINE);
        open_store()?.disable_project(&project_id)?;
        drop(_guard);
        status()
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    #[serde(flatten)]
    pub remote: RemoteProject,
    /// Already on this device (same project identity).
    pub local: bool,
    pub syncing: bool,
}

#[tauri::command]
pub async fn drive_remote_projects() -> ApiResponse<Vec<RemoteEntry>> {
    blocking(|| {
        let store = open_store()?;
        account(&store)?.ok_or("Sign in to Google Drive first")?;
        let enabled: Vec<String> = store.enabled_projects()?.into_iter().map(|(p, _)| p).collect();
        let remote = Drive::new().remote_projects().map_err(|e| e.to_string())?;
        Ok(remote
            .into_iter()
            .map(|r| RemoteEntry {
                local: Registry::get_path(&r.project_id).is_some(),
                syncing: enabled.contains(&r.project_id),
                remote: r,
            })
            .collect())
    })
    .await
}

/// Download a project from Drive into a new local folder (or link the same project already here).
#[tauri::command]
pub async fn sync_download_project(project_id: String, name: String) -> ApiResponse<Project> {
    blocking(move || {
        valid_project(&project_id)?;
        {
            let _guard = lock(&ENGINE);
            let store = open_store()?;
            let acct = account(&store)?.ok_or("Sign in to Google Drive first")?;
            let existing = Registry::get_path(&project_id).map(PathBuf::from).filter(|d| d.join("project.json").exists());
            match existing {
                Some(_) => store.enable_project(&project_id, &acct.id, false)?,
                None => {
                    let dir = Project::projects_dir().join(&project_id);
                    if dir.join("project.json").exists() {
                        return Err("A project folder with this identity already exists".into());
                    }
                    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                    let label = name.trim().chars().take(200).collect::<String>();
                    let skeleton = json!({
                        "id": project_id, "name": if label.is_empty() { "Synced project".into() } else { label },
                        "description": null, "created_at": chrono::Utc::now().to_rfc3339(), "folders": [], "documents": []
                    });
                    crate::project::write_atomic(&dir.join("project.json"), &skeleton.to_string())?;
                    Project::load_from_path(&dir)?;
                    store.enable_project(&project_id, &acct.id, true)?;
                }
            }
        }
        // Pull right away so the writer can open it; offline, it finishes in a later round.
        round(Some(&project_id));
        Project::load(&project_id)
    })
    .await
}

#[tauri::command]
pub fn sync_now() -> ApiResponse<()> {
    wake_now();
    ApiResponse::success(())
}

/// The editor tells the backend which chapter is open. Leaving a chapter applies any update
/// that was held back for it (the app has saved it first).
#[tauri::command]
pub async fn sync_set_active(project_id: Option<String>, document_id: Option<String>) -> ApiResponse<()> {
    blocking(move || {
        let next = project_id.zip(document_id);
        let previous = match service() {
            Some(s) => std::mem::replace(&mut *lock(&s.active), next.clone()),
            None => None,
        };
        if let Some((p, d)) = previous.filter(|prev| Some(prev) != next.as_ref()) {
            apply_staged_inner(&p, &d)?;
        }
        Ok(())
    })
    .await
}

fn apply_staged_inner(project_id: &str, doc_id: &str) -> Result<SyncReport, String> {
    let _guard = lock(&ENGINE);
    let store = open_store()?;
    if store.project_account(project_id)?.is_none() {
        return Ok(SyncReport::default());
    }
    let dir = Project::resolve_dir(project_id);
    let engine = Engine::new(&store, &device_name())?;
    let mut report = SyncReport::default();
    engine.apply_staged(project_id, &dir, doc_id, &mut report)?;
    after_changes(project_id, &dir, &report);
    emit("sync://status", status_value());
    Ok(report)
}

/// "Load the new version": the writer accepts a held-back update for the open chapter.
#[tauri::command]
pub async fn sync_apply_staged(project_id: String, document_id: String) -> ApiResponse<SyncReport> {
    blocking(move || {
        valid_project(&project_id)?;
        let report = apply_staged_inner(&project_id, &document_id)?;
        nudge(&project_id);
        Ok(report)
    })
    .await
}

#[tauri::command]
pub async fn sync_conflict(project_id: String, document_id: String) -> ApiResponse<Vec<ConflictVersion>> {
    blocking(move || {
        let _guard = lock(&ENGINE);
        let store = open_store()?;
        let dir = Project::resolve_dir(&project_id);
        Engine::new(&store, &device_name())?.conflict_versions(&project_id, &dir, &document_id)
    })
    .await
}

/// Keep one version in place; with `keep_copies` the others become separate chapters.
#[tauri::command]
pub async fn sync_resolve_conflict(project_id: String, document_id: String, keep: String, keep_copies: bool) -> ApiResponse<Vec<String>> {
    blocking(move || {
        let created = {
            let _guard = lock(&ENGINE);
            let store = open_store()?;
            let dir = Project::resolve_dir(&project_id);
            let created = Engine::new(&store, &device_name())?.resolve(&project_id, &dir, &document_id, &keep, keep_copies)?;
            refresh_index(&dir)?;
            created
        };
        emit("sync://applied", json!({"projectId": project_id, "changed": [format!("text:{document_id}")], "staged": []}));
        nudge(&project_id);
        emit("sync://status", status_value());
        Ok(created)
    })
    .await
}

#[tauri::command]
pub fn sync_dismiss_notice(id: i64) -> ApiResponse<()> {
    respond(open_store().and_then(|s| s.dismiss_notice(id)))
}
