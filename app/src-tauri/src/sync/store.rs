//! Durable MnemoSync state in SQLite (WAL). Project JSON files remain the source of truth;
//! this database only remembers revisions, what is on disk, what is still unsent, conflicts
//! and per-transport cursors. It lives outside every project folder and is never synced.
use super::model::{Batch, Revision};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;

pub struct Store {
    pub conn: Connection,
}

pub type NoticeRow = (i64, String, String, String, String);

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  next_seq INTEGER NOT NULL DEFAULT 1,
  fresh INTEGER NOT NULL DEFAULT 0,
  last_sync TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS revisions (
  project_id TEXT NOT NULL, rev TEXT NOT NULL, entity TEXT NOT NULL,
  parents TEXT NOT NULL, payload TEXT, origin TEXT NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (project_id, rev)
);
CREATE INDEX IF NOT EXISTS revisions_entity ON revisions (project_id, entity);
CREATE TABLE IF NOT EXISTS entity_state (
  project_id TEXT NOT NULL, entity TEXT NOT NULL, disk_rev TEXT NOT NULL, disk_hash TEXT NOT NULL,
  PRIMARY KEY (project_id, entity)
);
CREATE TABLE IF NOT EXISTS conflicts (
  project_id TEXT NOT NULL, entity TEXT NOT NULL, rev TEXT NOT NULL,
  PRIMARY KEY (project_id, entity, rev)
);
CREATE TABLE IF NOT EXISTS staged (
  project_id TEXT NOT NULL, entity TEXT NOT NULL, rev TEXT NOT NULL,
  PRIMARY KEY (project_id, entity)
);
CREATE TABLE IF NOT EXISTS blobs (sha TEXT PRIMARY KEY, data BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, transport TEXT NOT NULL, rev TEXT NOT NULL,
  UNIQUE (project_id, transport, rev)
);
CREATE TABLE IF NOT EXISTS pending_batches (
  project_id TEXT NOT NULL, transport TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (project_id, transport)
);
CREATE TABLE IF NOT EXISTS remote_blobs (
  project_id TEXT NOT NULL, transport TEXT NOT NULL, sha TEXT NOT NULL,
  PRIMARY KEY (project_id, transport, sha)
);
CREATE TABLE IF NOT EXISTS applied_batches (
  project_id TEXT NOT NULL, transport TEXT NOT NULL, device TEXT NOT NULL, seq INTEGER NOT NULL,
  PRIMARY KEY (project_id, transport, device, seq)
);
CREATE TABLE IF NOT EXISTS inbox (
  project_id TEXT NOT NULL, transport TEXT NOT NULL, device TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (project_id, transport, device, seq)
);
CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, entity TEXT NOT NULL,
  kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
"#;

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(err)?;
        }
        let conn = Connection::open(path).map_err(err)?;
        conn.busy_timeout(std::time::Duration::from_secs(10)).map_err(err)?;
        conn.execute_batch(SCHEMA).map_err(err)?;
        let store = Store { conn };
        store.migrate()?;
        Ok(store)
    }

    #[cfg(test)]
    pub fn memory() -> Self {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        Store { conn }
    }

    fn migrate(&self) -> Result<(), String> {
        match self.get_meta("schema")?.as_deref() {
            None => self.set_meta("schema", "1"),
            Some("1") => Ok(()),
            Some(other) => Err(format!("Sync data was written by a newer MnemoScript (schema {other}); update the app")),
        }
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .map_err(err)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value])
            .map(|_| ())
            .map_err(err)
    }

    pub fn delete_meta(&self, key: &str) -> Result<(), String> {
        self.conn.execute("DELETE FROM meta WHERE key = ?1", [key]).map(|_| ()).map_err(err)
    }

    /// Random per-install identity, created once. Never derived from hardware or the account.
    pub fn device_id(&self) -> Result<String, String> {
        if let Some(id) = self.get_meta("device_id")? {
            return Ok(id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.set_meta("device_id", &id)?;
        Ok(id)
    }

    // ---- projects -------------------------------------------------------------------------

    /// `fresh` marks an empty downloaded skeleton that must pull before its first scan.
    pub fn enable_project(&self, project_id: &str, account: &str, fresh: bool) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO projects (project_id, account, fresh) VALUES (?1, ?2, ?3) ON CONFLICT(project_id) DO UPDATE SET account = excluded.account",
                params![project_id, account, fresh as i64],
            )
            .map(|_| ())
            .map_err(err)
    }

    pub fn is_fresh(&self, project_id: &str) -> Result<bool, String> {
        self.conn
            .query_row("SELECT fresh FROM projects WHERE project_id = ?1", [project_id], |r| r.get::<_, i64>(0))
            .optional()
            .map(|o| o == Some(1))
            .map_err(err)
    }

    pub fn set_fresh(&self, project_id: &str, fresh: bool) -> Result<(), String> {
        self.conn
            .execute("UPDATE projects SET fresh = ?2 WHERE project_id = ?1", params![project_id, fresh as i64])
            .map(|_| ())
            .map_err(err)
    }

    /// Destinations a project's new revisions are queued for. Only Google Drive exists today;
    /// LAN sync will add its own id here without touching the engine.
    pub fn project_transports(&self, project_id: &str) -> Result<Vec<&'static str>, String> {
        Ok(if self.project_account(project_id)?.is_some() { vec!["drive"] } else { Vec::new() })
    }

    /// Stop syncing. Revisions are kept so turning sync back on resumes rather than duplicating.
    pub fn disable_project(&self, project_id: &str) -> Result<(), String> {
        self.conn.execute("DELETE FROM projects WHERE project_id = ?1", [project_id]).map(|_| ()).map_err(err)
    }

    pub fn enabled_projects(&self) -> Result<Vec<(String, String)>, String> {
        let mut stmt = self.conn.prepare("SELECT project_id, account FROM projects ORDER BY project_id").map_err(err)?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn project_account(&self, project_id: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row("SELECT account FROM projects WHERE project_id = ?1", [project_id], |r| r.get(0))
            .optional()
            .map_err(err)
    }

    pub fn set_project_result(&self, project_id: &str, error: Option<&str>) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        match error {
            None => self.conn.execute(
                "UPDATE projects SET last_sync = ?2, last_error = NULL WHERE project_id = ?1",
                params![project_id, now],
            ),
            Some(e) => self.conn.execute("UPDATE projects SET last_error = ?2 WHERE project_id = ?1", params![project_id, e]),
        }
        .map(|_| ())
        .map_err(err)
    }

    pub fn project_result(&self, project_id: &str) -> Result<(Option<String>, Option<String>), String> {
        self.conn
            .query_row("SELECT last_sync, last_error FROM projects WHERE project_id = ?1", [project_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map(|o| o.unwrap_or((None, None)))
            .map_err(err)
    }

    // ---- revisions ------------------------------------------------------------------------

    pub fn insert_revision(&self, project_id: &str, rev: &Revision) -> Result<bool, String> {
        let payload = rev.payload.as_ref().map(|p| p.to_string());
        let parents = serde_json::to_string(&rev.parents).map_err(err)?;
        let n = self
            .conn
            .execute(
                "INSERT OR IGNORE INTO revisions (project_id, rev, entity, parents, payload, origin) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![project_id, rev.rev, rev.entity, parents, payload, rev.origin],
            )
            .map_err(err)?;
        Ok(n > 0)
    }

    pub fn revision(&self, project_id: &str, rev: &str) -> Result<Option<Revision>, String> {
        self.conn
            .query_row(
                "SELECT entity, parents, payload, origin FROM revisions WHERE project_id = ?1 AND rev = ?2",
                [project_id, rev],
                |r| {
                    let parents: String = r.get(1)?;
                    let payload: Option<String> = r.get(2)?;
                    Ok((r.get::<_, String>(0)?, parents, payload, r.get::<_, String>(3)?))
                },
            )
            .optional()
            .map_err(err)?
            .map(|(entity, parents, payload, origin)| {
                Ok(Revision {
                    entity,
                    rev: rev.to_string(),
                    parents: serde_json::from_str(&parents).map_err(err)?,
                    payload: payload.map(|p| serde_json::from_str::<Value>(&p)).transpose().map_err(err)?,
                    origin,
                })
            })
            .transpose()
    }

    pub fn has_revision(&self, project_id: &str, rev: &str) -> Result<bool, String> {
        self.conn
            .query_row("SELECT 1 FROM revisions WHERE project_id = ?1 AND rev = ?2", [project_id, rev], |_| Ok(()))
            .optional()
            .map(|o| o.is_some())
            .map_err(err)
    }

    /// True when `ancestor` is `rev` itself or reachable through parent links.
    pub fn is_ancestor(&self, project_id: &str, ancestor: &str, rev: &str) -> Result<bool, String> {
        let mut stack = vec![rev.to_string()];
        let mut seen = std::collections::HashSet::new();
        while let Some(current) = stack.pop() {
            if current == ancestor {
                return Ok(true);
            }
            if !seen.insert(current.clone()) {
                continue;
            }
            if let Some(r) = self.revision(project_id, &current)? {
                stack.extend(r.parents);
            }
        }
        Ok(false)
    }

    fn ancestors(&self, project_id: &str, rev: &str) -> Result<Vec<String>, String> {
        let mut order = Vec::new();
        let mut queue = std::collections::VecDeque::from([rev.to_string()]);
        let mut seen = std::collections::HashSet::new();
        while let Some(current) = queue.pop_front() {
            if !seen.insert(current.clone()) {
                continue;
            }
            if let Some(r) = self.revision(project_id, &current)? {
                order.push(current);
                queue.extend(r.parents);
            }
        }
        Ok(order)
    }

    /// The nearest common ancestor (breadth-first from `a`), used as the merge base.
    pub fn merge_base(&self, project_id: &str, a: &str, b: &str) -> Result<Option<String>, String> {
        let theirs: std::collections::HashSet<String> = self.ancestors(project_id, b)?.into_iter().collect();
        Ok(self.ancestors(project_id, a)?.into_iter().find(|r| theirs.contains(r)))
    }

    // ---- what is on disk --------------------------------------------------------------------

    pub fn disk_state(&self, project_id: &str, entity: &str) -> Result<Option<(String, String)>, String> {
        self.conn
            .query_row(
                "SELECT disk_rev, disk_hash FROM entity_state WHERE project_id = ?1 AND entity = ?2",
                [project_id, entity],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)
    }

    pub fn set_disk_state(&self, project_id: &str, entity: &str, rev: &str, hash: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO entity_state (project_id, entity, disk_rev, disk_hash) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(project_id, entity) DO UPDATE SET disk_rev = excluded.disk_rev, disk_hash = excluded.disk_hash",
                params![project_id, entity, rev, hash],
            )
            .map(|_| ())
            .map_err(err)
    }

    pub fn entities(&self, project_id: &str) -> Result<Vec<(String, String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT entity, disk_rev, disk_hash FROM entity_state WHERE project_id = ?1")
            .map_err(err)?;
        let rows = stmt.query_map([project_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    // ---- conflicts and staged updates -------------------------------------------------------

    pub fn conflicts(&self, project_id: &str, entity: &str) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT rev FROM conflicts WHERE project_id = ?1 AND entity = ?2 ORDER BY rev")
            .map_err(err)?;
        let rows = stmt.query_map([project_id, entity], |r| r.get(0)).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn conflicted_entities(&self, project_id: &str) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT entity FROM conflicts WHERE project_id = ?1 ORDER BY entity")
            .map_err(err)?;
        let rows = stmt.query_map([project_id], |r| r.get(0)).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn set_conflicts(&self, project_id: &str, entity: &str, revs: &[String]) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM conflicts WHERE project_id = ?1 AND entity = ?2", [project_id, entity])
            .map_err(err)?;
        for rev in revs {
            self.conn
                .execute("INSERT OR IGNORE INTO conflicts (project_id, entity, rev) VALUES (?1, ?2, ?3)", [project_id, entity, rev])
                .map_err(err)?;
        }
        Ok(())
    }

    pub fn staged(&self, project_id: &str, entity: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row("SELECT rev FROM staged WHERE project_id = ?1 AND entity = ?2", [project_id, entity], |r| r.get(0))
            .optional()
            .map_err(err)
    }

    pub fn staged_entities(&self, project_id: &str) -> Result<Vec<String>, String> {
        let mut stmt = self.conn.prepare("SELECT entity FROM staged WHERE project_id = ?1").map_err(err)?;
        let rows = stmt.query_map([project_id], |r| r.get(0)).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn set_staged(&self, project_id: &str, entity: &str, rev: Option<&str>) -> Result<(), String> {
        match rev {
            Some(rev) => self.conn.execute(
                "INSERT INTO staged (project_id, entity, rev) VALUES (?1, ?2, ?3) ON CONFLICT(project_id, entity) DO UPDATE SET rev = excluded.rev",
                [project_id, entity, rev],
            ),
            None => self.conn.execute("DELETE FROM staged WHERE project_id = ?1 AND entity = ?2", [project_id, entity]),
        }
        .map(|_| ())
        .map_err(err)
    }

    // ---- blobs --------------------------------------------------------------------------------

    pub fn put_blob(&self, sha: &str, data: &[u8]) -> Result<(), String> {
        self.conn
            .execute("INSERT OR IGNORE INTO blobs (sha, data) VALUES (?1, ?2)", params![sha, data])
            .map(|_| ())
            .map_err(err)
    }

    pub fn blob(&self, sha: &str) -> Result<Option<Vec<u8>>, String> {
        self.conn
            .query_row("SELECT data FROM blobs WHERE sha = ?1", [sha], |r| r.get(0))
            .optional()
            .map_err(err)
    }

    // ---- outbox and publication ---------------------------------------------------------------

    pub fn enqueue(&self, project_id: &str, transport: &str, rev: &str) -> Result<(), String> {
        self.conn
            .execute("INSERT OR IGNORE INTO outbox (project_id, transport, rev) VALUES (?1, ?2, ?3)", [project_id, transport, rev])
            .map(|_| ())
            .map_err(err)
    }

    pub fn dequeue(&self, project_id: &str, transport: &str, rev: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM outbox WHERE project_id = ?1 AND transport = ?2 AND rev = ?3", [project_id, transport, rev])
            .map(|_| ())
            .map_err(err)
    }

    pub fn outbox(&self, project_id: &str, transport: &str, limit: usize) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT rev FROM outbox WHERE project_id = ?1 AND transport = ?2 ORDER BY id LIMIT ?3")
            .map_err(err)?;
        let rows = stmt.query_map(params![project_id, transport, limit as i64], |r| r.get(0)).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn outbox_len(&self, project_id: &str, transport: &str) -> Result<u64, String> {
        self.conn
            .query_row("SELECT COUNT(*) FROM outbox WHERE project_id = ?1 AND transport = ?2", [project_id, transport], |r| r.get::<_, i64>(0))
            .map(|n| n as u64)
            .map_err(err)
    }

    /// Freeze the next batch before uploading it, so a crash mid-upload retries the *same* bytes
    /// under the same sequence number instead of publishing two different batches as one.
    pub fn pending_batch(&self, project_id: &str, transport: &str) -> Result<Option<Batch>, String> {
        let body: Option<String> = self
            .conn
            .query_row("SELECT body FROM pending_batches WHERE project_id = ?1 AND transport = ?2", [project_id, transport], |r| r.get(0))
            .optional()
            .map_err(err)?;
        body.map(|b| serde_json::from_str(&b).map_err(err)).transpose()
    }

    pub fn freeze_batch(&self, batch: &Batch, transport: &str) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO pending_batches (project_id, transport, seq, body) VALUES (?1, ?2, ?3, ?4)",
            params![batch.project_id, transport, batch.seq as i64, serde_json::to_string(batch).map_err(err)?],
        )
        .map_err(err)?;
        tx.execute("UPDATE projects SET next_seq = ?2 WHERE project_id = ?1", params![batch.project_id, batch.seq as i64 + 1])
            .map_err(err)?;
        tx.commit().map_err(err)
    }

    pub fn refreeze_batch(&self, batch: &Batch, transport: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE pending_batches SET body = ?3 WHERE project_id = ?1 AND transport = ?2",
                params![batch.project_id, transport, serde_json::to_string(batch).map_err(err)?],
            )
            .map(|_| ())
            .map_err(err)
    }

    pub fn next_seq(&self, project_id: &str) -> Result<u64, String> {
        self.conn
            .query_row("SELECT next_seq FROM projects WHERE project_id = ?1", [project_id], |r| r.get::<_, i64>(0))
            .optional()
            .map(|o| o.unwrap_or(1) as u64)
            .map_err(err)
    }

    pub fn publish_done(&self, batch: &Batch, transport: &str) -> Result<(), String> {
        let tx = self.conn.unchecked_transaction().map_err(err)?;
        for r in &batch.revisions {
            tx.execute("DELETE FROM outbox WHERE project_id = ?1 AND transport = ?2 AND rev = ?3", params![batch.project_id, transport, r.rev])
                .map_err(err)?;
        }
        tx.execute("DELETE FROM pending_batches WHERE project_id = ?1 AND transport = ?2", params![batch.project_id, transport])
            .map_err(err)?;
        tx.commit().map_err(err)
    }

    pub fn remote_has_blob(&self, project_id: &str, transport: &str, sha: &str) -> Result<bool, String> {
        self.conn
            .query_row("SELECT 1 FROM remote_blobs WHERE project_id = ?1 AND transport = ?2 AND sha = ?3", [project_id, transport, sha], |_| Ok(()))
            .optional()
            .map(|o| o.is_some())
            .map_err(err)
    }

    pub fn mark_remote_blob(&self, project_id: &str, transport: &str, sha: &str) -> Result<(), String> {
        self.conn
            .execute("INSERT OR IGNORE INTO remote_blobs (project_id, transport, sha) VALUES (?1, ?2, ?3)", [project_id, transport, sha])
            .map(|_| ())
            .map_err(err)
    }

    // ---- inbox --------------------------------------------------------------------------------

    pub fn batch_applied(&self, project_id: &str, transport: &str, device: &str, seq: u64) -> Result<bool, String> {
        self.conn
            .query_row(
                "SELECT 1 FROM applied_batches WHERE project_id = ?1 AND transport = ?2 AND device = ?3 AND seq = ?4",
                params![project_id, transport, device, seq as i64],
                |_| Ok(()),
            )
            .optional()
            .map(|o| o.is_some())
            .map_err(err)
    }

    pub fn mark_applied(&self, project_id: &str, transport: &str, device: &str, seq: u64) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO applied_batches (project_id, transport, device, seq) VALUES (?1, ?2, ?3, ?4)",
                params![project_id, transport, device, seq as i64],
            )
            .map_err(err)?;
        self.conn
            .execute(
                "DELETE FROM inbox WHERE project_id = ?1 AND transport = ?2 AND device = ?3 AND seq = ?4",
                params![project_id, transport, device, seq as i64],
            )
            .map(|_| ())
            .map_err(err)
    }

    pub fn hold(&self, batch: &Batch, transport: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO inbox (project_id, transport, device, seq, body) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![batch.project_id, transport, batch.device_id, batch.seq as i64, serde_json::to_string(batch).map_err(err)?],
            )
            .map(|_| ())
            .map_err(err)
    }

    pub fn held(&self, project_id: &str, transport: &str) -> Result<Vec<Batch>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT body FROM inbox WHERE project_id = ?1 AND transport = ?2 ORDER BY device, seq")
            .map_err(err)?;
        let rows = stmt.query_map([project_id, transport], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|b| b.map_err(err).and_then(|b| serde_json::from_str(&b).map_err(err))).collect()
    }

    // ---- devices and notices -----------------------------------------------------------------

    pub fn remember_device(&self, device_id: &str, name: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO devices (device_id, name) VALUES (?1, ?2) ON CONFLICT(device_id) DO UPDATE SET name = excluded.name",
                [device_id, name],
            )
            .map(|_| ())
            .map_err(err)
    }

    pub fn device_name(&self, device_id: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row("SELECT name FROM devices WHERE device_id = ?1", [device_id], |r| r.get(0))
            .optional()
            .map_err(err)
    }

    pub fn add_notice(&self, project_id: &str, entity: &str, kind: &str, detail: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO notices (project_id, entity, kind, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![project_id, entity, kind, detail, chrono::Utc::now().to_rfc3339()],
            )
            .map(|_| ())
            .map_err(err)
    }

    /// Recent notices, newest first: `(id, entity, kind, detail, created_at)`.
    pub fn notices(&self, project_id: &str, limit: usize) -> Result<Vec<NoticeRow>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, entity, kind, detail, created_at FROM notices WHERE project_id = ?1 ORDER BY id DESC LIMIT ?2")
            .map_err(err)?;
        let rows = stmt
            .query_map(params![project_id, limit as i64], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)
    }

    pub fn dismiss_notice(&self, id: i64) -> Result<(), String> {
        self.conn.execute("DELETE FROM notices WHERE id = ?1", [id]).map(|_| ()).map_err(err)
    }
}
