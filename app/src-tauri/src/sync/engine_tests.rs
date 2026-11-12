//! Multi-device simulations over the in-memory transport. Synthetic writing only.
use super::*;
use crate::sync::memory::{MemoryTransport, Remote};
use std::cell::RefCell;
use std::rc::Rc;
use tempfile::TempDir;

const PID: &str = "6f0e3a52-1b7c-4f43-9d55-0a1b2c3d4e5f";

struct Device {
    store: Store,
    dir: TempDir,
    name: &'static str,
}

impl Device {
    fn engine(&self) -> Engine<'_> {
        Engine::new(&self.store, self.name).unwrap()
    }
    fn path(&self) -> &Path {
        self.dir.path()
    }
    fn sync(&self, remote: &Rc<RefCell<Remote>>) -> SyncReport {
        self.sync_with(remote, None)
    }
    fn sync_with(&self, remote: &Rc<RefCell<Remote>>, active: Option<&str>) -> SyncReport {
        let mut t = MemoryTransport::new(remote);
        self.engine().sync(PID, self.path(), &mut t, active).unwrap()
    }
    fn doc(&self, id: &str) -> Option<Value> {
        read_json(&self.path().join("documents").join(format!("{id}.json"))).ok()
    }
    fn content(&self, id: &str) -> String {
        self.doc(id).map(|d| d["content"].as_str().unwrap().to_string()).unwrap_or_default()
    }
    fn write_doc(&self, id: &str, title: &str, content: &str, folder: Option<&str>, order: i64) {
        let doc = json!({"id": id, "title": title, "content": content, "updated_at": "2026-11-13T00:00:00Z", "docType": "text", "order": order, "folderId": folder});
        crate::project::write_atomic(&self.path().join("documents").join(format!("{id}.json")), &doc.to_string()).unwrap();
    }
    fn edit(&self, id: &str, f: impl FnOnce(&mut Value)) {
        let mut doc = self.doc(id).unwrap();
        f(&mut doc);
        crate::project::write_atomic(&self.path().join("documents").join(format!("{id}.json")), &doc.to_string()).unwrap();
    }
    fn meta(&self) -> Value {
        read_json(&self.path().join("project.json")).unwrap()
    }
    fn set_meta(&self, f: impl FnOnce(&mut Value)) {
        let mut m = self.meta();
        f(&mut m);
        crate::project::write_atomic(&self.path().join("project.json"), &m.to_string()).unwrap();
    }
    /// Comparable view of the project (portable text, so paths differ per device but not here).
    fn snapshot(&self) -> BTreeMap<String, Value> {
        let disk = self.engine().read_disk(PID, self.path()).unwrap();
        disk.entities
    }
}

fn origin(name: &'static str) -> Device {
    let dir = TempDir::new().unwrap();
    let meta = json!({"id": PID, "name": "The Ashen Crown", "description": null, "created_at": "2026-11-01T00:00:00Z",
        "folders": [{"id": "vol1", "name": "Volume 1", "order": 0, "parentId": null}], "ai": {"provider": "local-only"}});
    crate::project::write_atomic(&dir.path().join("project.json"), &meta.to_string()).unwrap();
    let d = Device { store: Store::memory(), dir, name };
    d.store.enable_project(PID, "acct-1", false).unwrap();
    d
}

/// A second device that downloads the project into an empty skeleton.
fn joiner(name: &'static str) -> Device {
    let dir = TempDir::new().unwrap();
    let meta = json!({"id": PID, "name": "Downloading…", "description": null, "created_at": "2026-11-13T00:00:00Z", "folders": []});
    crate::project::write_atomic(&dir.path().join("project.json"), &meta.to_string()).unwrap();
    let d = Device { store: Store::memory(), dir, name };
    d.store.enable_project(PID, "acct-1", true).unwrap();
    d
}

fn remote() -> Rc<RefCell<Remote>> {
    Rc::new(RefCell::new(Remote::default()))
}

fn seeded() -> (Rc<RefCell<Remote>>, Device, Device) {
    let r = remote();
    let a = origin("Desktop");
    a.write_doc("ch1", "Chapter 1", "<p>The bells rang at dawn.</p>", Some("vol1"), 1);
    a.write_doc("ch2", "Chapter 2", "<p>Ash fell like snow.</p>", Some("vol1"), 2);
    a.write_doc("ch3", "Chapter 3", "<p>The crown was cold.</p>", Some("vol1"), 3);
    a.sync(&r);
    let b = joiner("Pixel");
    b.sync(&r);
    (r, a, b)
}

#[test]
fn a_second_device_downloads_the_whole_project_with_portable_images() {
    let r = remote();
    let a = origin("Desktop");
    fs::create_dir_all(a.path().join("assets")).unwrap();
    fs::write(a.path().join("assets").join("map1.png"), b"\x89PNG fake bytes").unwrap();
    let img = a.path().join("assets").join("map1.png").to_string_lossy().into_owned();
    a.write_doc("ch1", "Chapter 1", &format!(r#"<p>Look:</p><img src="{img}">"#), Some("vol1"), 1);
    let report = a.sync(&r);
    assert!(report.published >= 4, "{report:?}");

    let b = joiner("Pixel");
    let got = b.sync(&r);
    assert!(got.changed.contains(&"text:ch1".to_string()));
    assert_eq!(b.meta()["name"], "The Ashen Crown");
    assert_eq!(b.meta()["folders"][0]["name"], "Volume 1");
    assert!(b.meta().get("ai").is_none(), "per-device AI settings never sync");
    let doc = b.doc("ch1").unwrap();
    assert_eq!(doc["title"], "Chapter 1");
    assert_eq!(doc["folderId"], "vol1");
    let local_img = b.path().join("assets").join("map1.png");
    assert_eq!(fs::read(&local_img).unwrap(), b"\x89PNG fake bytes");
    assert!(doc["content"].as_str().unwrap().contains(&html_escape::encode_double_quoted_attribute(&local_img.to_string_lossy()).to_string()));
    assert_eq!(a.snapshot(), b.snapshot());
    // Nothing more to send or apply.
    let again = b.sync(&r);
    assert_eq!(again.published, 0);
    assert!(again.changed.is_empty());
}

#[test]
fn move_on_one_device_and_text_edit_on_the_other_both_apply() {
    let (r, a, b) = seeded();
    a.edit("ch2", |d| d["folderId"] = Value::Null);
    b.edit("ch2", |d| d["content"] = json!("<p>Ash fell like snow, then like rain.</p>"));
    a.sync(&r);
    b.sync(&r);
    a.sync(&r);
    for d in [&a, &b] {
        let doc = d.doc("ch2").unwrap();
        assert_eq!(doc["folderId"], Value::Null);
        assert_eq!(doc["content"], "<p>Ash fell like snow, then like rain.</p>");
        assert!(d.store.conflicted_entities(PID).unwrap().is_empty());
    }
    assert_eq!(a.snapshot(), b.snapshot());
}

#[test]
fn concurrent_chapter_edits_keep_both_versions_until_the_writer_chooses() {
    let (r, a, b) = seeded();
    a.edit("ch3", |d| d["content"] = json!("<p>Desktop draft.</p>"));
    b.edit("ch3", |d| d["content"] = json!("<p>Phone draft.</p>"));
    a.sync(&r);
    b.sync(&r);
    a.sync(&r);
    // Each device keeps its own text in place; the other version is preserved, never dropped.
    assert_eq!(a.content("ch3"), "<p>Desktop draft.</p>");
    assert_eq!(b.content("ch3"), "<p>Phone draft.</p>");
    for d in [&a, &b] {
        assert_eq!(d.store.conflicted_entities(PID).unwrap(), vec!["text:ch3".to_string()]);
        let versions = d.engine().conflict_versions(PID, d.path(), "ch3").unwrap();
        let texts: BTreeSet<String> = versions.iter().map(|v| v.content.clone()).collect();
        assert_eq!(texts, BTreeSet::from(["<p>Desktop draft.</p>".to_string(), "<p>Phone draft.</p>".to_string()]));
    }
    // The phone keeps the desktop text and saves its own draft as a separate chapter.
    let versions = b.engine().conflict_versions(PID, b.path(), "ch3").unwrap();
    let desktop = versions.iter().find(|v| !v.local).unwrap();
    assert_eq!(desktop.device, "Desktop");
    let copies = b.engine().resolve(PID, b.path(), "ch3", &desktop.rev, true).unwrap();
    assert_eq!(copies.len(), 1);
    assert_eq!(b.content("ch3"), "<p>Desktop draft.</p>");
    assert_eq!(b.content(&copies[0]), "<p>Phone draft.</p>");
    assert_eq!(b.doc(&copies[0]).unwrap()["title"], "Chapter 3 (Pixel)");
    b.sync(&r);
    a.sync(&r);
    assert!(a.store.conflicted_entities(PID).unwrap().is_empty());
    assert_eq!(a.content(&copies[0]), "<p>Phone draft.</p>");
    assert_eq!(a.snapshot(), b.snapshot());
}

#[test]
fn delete_on_one_device_and_edit_on_the_other_keeps_the_chapter() {
    let (r, a, b) = seeded();
    fs::remove_file(a.path().join("documents").join("ch1.json")).unwrap();
    b.edit("ch1", |d| d["content"] = json!("<p>Saved from deletion.</p>"));
    a.sync(&r);
    b.sync(&r);
    a.sync(&r);
    b.sync(&r);
    for d in [&a, &b] {
        assert_eq!(d.content("ch1"), "<p>Saved from deletion.</p>", "{}", d.name);
        assert_eq!(d.doc("ch1").unwrap()["title"], "Chapter 1");
    }
    // The device that merged the delete with the edit tells its writer why the chapter stayed.
    assert!(b.store.notices(PID, 10).unwrap().iter().any(|n| n.2 == "kept"));
    assert_eq!(a.snapshot(), b.snapshot());
}

#[test]
fn a_delete_reaches_an_offline_device_and_is_not_resurrected() {
    let (r, a, b) = seeded();
    fs::remove_file(a.path().join("documents").join("ch2.json")).unwrap();
    a.set_meta(|m| m["name"] = json!("The Ashen Crown (draft 2)"));
    r.borrow_mut().offline = true;
    let mut t = MemoryTransport::new(&r);
    assert!(matches!(a.engine().sync(PID, a.path(), &mut t, None), Err(TransportError::Offline(_))));
    r.borrow_mut().offline = false;
    a.sync(&r);
    b.sync(&r);
    assert!(b.doc("ch2").is_none());
    assert_eq!(b.meta()["name"], "The Ashen Crown (draft 2)");
    assert!(b.store.notices(PID, 10).unwrap().iter().any(|n| n.2 == "deleted"));
    // The phone syncing again later must not bring the chapter back.
    b.sync(&r);
    a.sync(&r);
    assert!(a.doc("ch2").is_none());
    assert_eq!(a.snapshot(), b.snapshot());
}

#[test]
fn duplicate_and_reordered_deliveries_apply_once() {
    let (r, a, b) = seeded();
    a.write_doc("ch4", "Chapter 4", "<p>New.</p>", Some("vol1"), 4);
    a.sync(&r);
    a.edit("ch4", |d| d["content"] = json!("<p>New, revised.</p>"));
    a.sync(&r);
    {
        let mut remote = r.borrow_mut();
        let copies = remote.batches.clone();
        remote.batches.extend(copies);
        remote.reverse = true;
    }
    b.sync(&r);
    assert_eq!(b.content("ch4"), "<p>New, revised.</p>");
    let docs = fs::read_dir(b.path().join("documents")).unwrap().count();
    assert_eq!(docs, 4, "no duplicated chapters");
    assert_eq!(a.snapshot(), b.snapshot());
}

#[test]
fn the_open_chapter_is_never_overwritten_under_the_editor() {
    let (r, a, b) = seeded();
    a.edit("ch1", |d| d["content"] = json!("<p>Desktop rewrite.</p>"));
    a.sync(&r);
    let report = b.sync_with(&r, Some("ch1"));
    assert_eq!(report.staged, vec!["text:ch1".to_string()]);
    assert_eq!(b.content("ch1"), "<p>The bells rang at dawn.</p>");
    // Writer accepts the update without having typed: plain fast-forward.
    let mut rep = SyncReport::default();
    b.engine().apply_staged(PID, b.path(), "ch1", &mut rep).unwrap();
    assert_eq!(b.content("ch1"), "<p>Desktop rewrite.</p>");

    // Next time the writer keeps typing before accepting: their words become a conflict.
    a.edit("ch1", |d| d["content"] = json!("<p>Desktop again.</p>"));
    a.sync(&r);
    b.sync_with(&r, Some("ch1"));
    b.edit("ch1", |d| d["content"] = json!("<p>Phone typing meanwhile.</p>"));
    b.engine().apply_staged(PID, b.path(), "ch1", &mut rep).unwrap();
    assert_eq!(b.content("ch1"), "<p>Phone typing meanwhile.</p>");
    assert_eq!(b.store.conflicted_entities(PID).unwrap(), vec!["text:ch1".to_string()]);
}

#[test]
fn a_remote_delete_of_the_open_chapter_waits_and_typing_keeps_it() {
    let (r, a, b) = seeded();
    fs::remove_file(a.path().join("documents").join("ch2.json")).unwrap();
    a.sync(&r);
    let report = b.sync_with(&r, Some("ch2"));
    assert!(report.staged.contains(&"doc:ch2".to_string()), "{report:?}");
    assert!(b.doc("ch2").is_some(), "the open chapter's file is not removed under the editor");
    // The writer kept typing, then left the chapter: their words win over the delete.
    b.edit("ch2", |d| d["content"] = json!("<p>Still writing.</p>"));
    let mut rep = SyncReport::default();
    b.engine().apply_staged(PID, b.path(), "ch2", &mut rep).unwrap();
    assert_eq!(b.content("ch2"), "<p>Still writing.</p>");
    b.sync(&r);
    a.sync(&r);
    assert_eq!(a.content("ch2"), "<p>Still writing.</p>");
    assert_eq!(a.snapshot(), b.snapshot());
}

#[test]
fn a_batch_waits_for_content_that_is_not_visible_yet() {
    let (r, a, b) = seeded();
    a.edit("ch1", |d| d["content"] = json!("<p>Slow upload.</p>"));
    a.sync(&r);
    let sha = model::sha256_hex(b"<p>Slow upload.</p>");
    r.borrow_mut().hidden.push(sha);
    let held = b.sync(&r);
    assert_eq!(held.held, 1);
    assert_eq!(b.content("ch1"), "<p>The bells rang at dawn.</p>");
    r.borrow_mut().hidden.clear();
    b.sync(&r);
    assert_eq!(b.content("ch1"), "<p>Slow upload.</p>");
}

#[test]
fn an_interrupted_publish_retries_the_same_frozen_batch() {
    let r = remote();
    let a = origin("Desktop");
    a.write_doc("ch1", "Chapter 1", "<p>One.</p>", None, 1);
    let e = a.engine();
    e.scan(PID, a.path(), &["drive"]).unwrap();
    let frozen = e.next_batch(PID, "drive").unwrap().unwrap();
    // More writing happens before the retry; it must go into a *later* batch.
    a.write_doc("ch2", "Chapter 2", "<p>Two.</p>", None, 2);
    e.scan(PID, a.path(), &["drive"]).unwrap();
    let mut t = MemoryTransport::new(&r);
    e.publish(PID, a.path(), &mut t).unwrap();
    let remote = r.borrow();
    assert_eq!(remote.batches.len(), 2);
    assert_eq!(remote.batches[0].seq, frozen.seq);
    assert_eq!(remote.batches[0].revisions, frozen.revisions);
    assert_eq!(remote.batches[1].seq, frozen.seq + 1);
}

#[test]
fn concurrent_folder_moves_never_leave_a_cycle_or_orphan() {
    let (r, a, b) = seeded();
    a.set_meta(|m| m["folders"] = json!([{"id": "vol1", "name": "Volume 1", "order": 0, "parentId": null}, {"id": "vol2", "name": "Volume 2", "order": 1, "parentId": null}]));
    a.sync(&r);
    b.sync(&r);
    // Desktop nests Volume 1 in Volume 2; phone nests Volume 2 in Volume 1 and deletes nothing.
    a.set_meta(|m| m["folders"][0]["parentId"] = json!("vol2"));
    b.set_meta(|m| m["folders"][1]["parentId"] = json!("vol1"));
    a.sync(&r);
    b.sync(&r);
    a.sync(&r);
    b.sync(&r);
    for d in [&a, &b] {
        let folders = d.meta()["folders"].as_array().unwrap().clone();
        let roots = folders.iter().filter(|f| f["parentId"].is_null()).count();
        assert!(roots >= 1, "a cycle must be broken: {folders:?}");
    }
    assert_eq!(a.snapshot(), b.snapshot());
}

#[test]
fn three_devices_converge_under_shuffled_sync_order() {
    let (r, a, b) = seeded();
    let c = joiner("Tablet");
    c.sync(&r);
    let devices = [&a, &b, &c];
    let mut seed: u64 = 0x5eed;
    let mut next = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) as usize
    };
    for round in 0..12 {
        let d = devices[next() % 3];
        // Each device edits a different field, so everything should merge without conflicts.
        match d.name {
            "Desktop" => d.edit("ch1", |doc| doc["content"] = json!(format!("<p>Desktop {round}</p>"))),
            "Pixel" => d.edit("ch2", |doc| doc["title"] = json!(format!("Chapter Two v{round}"))),
            _ => d.set_meta(|m| m["description"] = json!(format!("Tablet note {round}"))),
        }
        devices[next() % 3].sync(&r);
        d.sync(&r);
    }
    for _ in 0..2 {
        for d in devices {
            d.sync(&r);
        }
    }
    assert_eq!(a.snapshot(), b.snapshot());
    assert_eq!(b.snapshot(), c.snapshot());
    for d in devices {
        assert!(d.store.conflicted_entities(PID).unwrap().is_empty());
    }
}

#[test]
fn damaged_remote_data_is_rejected_without_touching_disk() {
    let (r, a, b) = seeded();
    a.edit("ch1", |d| d["content"] = json!("<p>Real.</p>"));
    a.sync(&r);
    {
        let mut remote = r.borrow_mut();
        let last = remote.batches.last_mut().unwrap();
        last.revisions[0].payload = Some(json!({"title": "Forged"}));
    }
    b.sync(&r);
    assert_eq!(b.content("ch1"), "<p>The bells rang at dawn.</p>");
    assert!(b.store.notices(PID, 10).unwrap().iter().any(|n| n.2 == "rejected"));
}
