//! Live Google Drive round trip (ignored by default; needs a signed-in dev build).
//!
//! `cargo test live_drive -- --ignored --nocapture`
//!
//! Plays two devices against the real Drive of the account signed in to the *debug* app
//! (keychain service `MnemoScript-dev`), under a throwaway project id, and deletes every file it
//! created afterwards. Synthetic text only; no real project is touched.
use super::api::{self as drive_api, query, Drive, DriveTransport};
use super::auth;
use crate::sync::engine::Engine;
use crate::sync::store::Store;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

fn write(path: &Path, value: &Value) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, value.to_string()).unwrap();
}

fn read(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

/// One sync round as the service runs it: change feed first, then the engine.
fn round(drive: &Drive, store: &Store, engine: &Engine, pid: &str, dir: &Path) -> crate::sync::engine::SyncReport {
    drive_api::refresh_changes(drive, store, "live-test").expect("change feed");
    let mut t = DriveTransport { drive, store, device_id: engine.device_id.clone() };
    engine.sync(pid, dir, &mut t, None).expect("sync round")
}

#[test]
#[ignore]
fn live_drive_round_trip() {
    if auth::client_id().is_none() || auth::access_token(false).is_err() {
        panic!("Sign in to Google Drive in the dev app first (Settings -> Sync with Google Drive)");
    }
    let drive = Drive::new();
    let account = drive.about().expect("Drive account");
    println!("Drive account reachable (id length {})", account.id.len());

    let pid = uuid::Uuid::new_v4().to_string();
    let (a_dir, b_dir) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a_store, b_store) = (Store::memory(), Store::memory());
    for s in [&a_store, &b_store] {
        drive_api::ensure_tables(s).unwrap();
    }
    let a = Engine::new(&a_store, "Live test desktop").unwrap();
    let b = Engine::new(&b_store, "Live test phone").unwrap();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // Device A: a small project with a folder, two chapters and an image.
        write(&a_dir.path().join("project.json"), &json!({"id": pid, "name": "Live sync test", "description": null,
            "created_at": "2026-11-15T00:00:00Z", "folders": [{"id": "vol1", "name": "Volume 1", "order": 0, "parentId": null}]}));
        fs::create_dir_all(a_dir.path().join("assets")).unwrap();
        fs::write(a_dir.path().join("assets").join("map.png"), b"\x89PNG live test bytes").unwrap();
        let img = a_dir.path().join("assets").join("map.png").to_string_lossy().into_owned();
        write(&a_dir.path().join("documents").join("ch1.json"), &json!({"id": "ch1", "title": "Chapter 1",
            "content": format!("<p>The bells rang at dawn.</p><img src=\"{img}\">"), "updated_at": "now", "docType": "text", "order": 1, "folderId": "vol1"}));
        write(&a_dir.path().join("documents").join("ch2.json"), &json!({"id": "ch2", "title": "Chapter 2",
            "content": "<p>Ash fell like snow.</p>", "updated_at": "now", "docType": "text", "order": 2, "folderId": "vol1"}));
        a_store.enable_project(&pid, "live-test", false).unwrap();
        let published = round(&drive, &a_store, &a, &pid, a_dir.path()).published;
        println!("device A published {published} revisions");
        assert!(published >= 6);

        // Device B downloads it (Drive listings can lag a few seconds).
        write(&b_dir.path().join("project.json"), &json!({"id": pid, "name": "Downloading", "description": null,
            "created_at": "2026-11-15T00:00:00Z", "folders": []}));
        b_store.enable_project(&pid, "live-test", true).unwrap();
        for attempt in 0..6 {
            round(&drive, &b_store, &b, &pid, b_dir.path());
            if b_dir.path().join("documents").join("ch2.json").exists() {
                break;
            }
            println!("device B: waiting for Drive (attempt {attempt})");
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
        assert_eq!(read(&b_dir.path().join("project.json"))["name"], "Live sync test");
        assert_eq!(read(&b_dir.path().join("documents").join("ch2.json"))["content"], "<p>Ash fell like snow.</p>");
        assert_eq!(fs::read(b_dir.path().join("assets").join("map.png")).unwrap(), b"\x89PNG live test bytes");
        let ch1 = read(&b_dir.path().join("documents").join("ch1.json"));
        assert!(ch1["content"].as_str().unwrap().contains(&*b_dir.path().join("assets").join("map.png").to_string_lossy()));
        println!("device B downloaded the project, image and portable image reference");

        // B edits, A picks it up through the change feed.
        let mut doc = read(&b_dir.path().join("documents").join("ch2.json"));
        doc["content"] = json!("<p>Ash fell like snow, then like rain.</p>");
        write(&b_dir.path().join("documents").join("ch2.json"), &doc);
        round(&drive, &b_store, &b, &pid, b_dir.path());
        let mut got = false;
        for attempt in 0..6 {
            round(&drive, &a_store, &a, &pid, a_dir.path());
            if read(&a_dir.path().join("documents").join("ch2.json"))["content"] == "<p>Ash fell like snow, then like rain.</p>" {
                got = true;
                break;
            }
            println!("device A: waiting for the change feed (attempt {attempt})");
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
        assert!(got, "device A never saw device B's edit");
        println!("device A received device B's edit through the change feed");
    }));

    // Clean up every file this run created in the app folder, pass or fail.
    let files = drive.list(&query(&[("m", "1"), ("p", &pid)])).unwrap_or_default();
    for f in &files {
        let _ = drive.delete(&f.id);
    }
    println!("cleaned up {} test files from the app folder", files.len());
    if let Err(e) = result {
        std::panic::resume_unwind(e);
    }
}
