use super::*;
use std::io::Cursor;
use tempfile::{tempdir, TempDir};

fn put(root: &Path, name: &str, bytes: impl AsRef<[u8]>) {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn fixture() -> TempDir {
    let dir = tempfile::Builder::new()
        .prefix("mnemo & test ")
        .tempdir()
        .unwrap();
    let project = serde_json::json!({
        "id": Uuid::new_v4().to_string(), "name": "Novel", "created_at": "2026-11-12",
        "path": dir.path(), "author": "Writer", "customField": { "kept": true },
        "folders": [{"id": "volume-1", "name": "Volume 1", "order": 0}],
        "documents": [{"id": "chapter-1", "title": "Chapter 1", "content": "", "updated_at": "now"}],
        "ai": { "provider": "paired-pc", "model": "local" }
    });
    put(dir.path(), "project.json", project.to_string());
    put(dir.path(), "assets/image.png", [0, 255, 12, 34]);
    let content = format!(
        "<h2>Chapter 1</h2><p><strong>বাংলা</strong> — {}</p><img src=\"{}\" alt=\"Map\">",
        dir.path().display(),
        html_escape::encode_double_quoted_attribute(
            &dir.path().join("assets/image.png").to_string_lossy()
        )
    );
    put(
        dir.path(),
        "documents/chapter-1.json",
        serde_json::json!({
            "id": "chapter-1", "title": "Chapter 1", "content": content, "updated_at": "now",
            "folderId": "volume-1", "docType": "text", "order": 2, "unknown": 42
        })
        .to_string(),
    );
    for (id, kind) in [("map-1", "fantasymap"), ("mind-1", "mindmap")] {
        let content = serde_json::json!({
            "nodes": [{ "id": "n1", "data": { "label": dir.path().display().to_string() }}], "edges": [],
            "items": [{ "assetPath": dir.path().join("assets/image.png") }],
            "canvas": { "background": { "imagePath": dir.path().join("assets/image.png") } },
            "terrain": { "bakedAssetPath": dir.path().join("assets/image.png") }
        }).to_string();
        put(dir.path(), &format!("documents/{id}.json"), serde_json::json!({
            "id": id, "title": id, "content": content, "updated_at": "now", "docType": kind, "order": 0
        }).to_string());
    }
    put(
        dir.path(),
        "ai/sessions/session.json",
        "{\"id\":\"session\",\"messages\":[\"private conversation\"]}",
    );
    put(dir.path(), "exports/book.pdf", b"test exported bytes");
    put(dir.path(), "credentials.json", "never back this up");
    put(dir.path(), "ai/keys.json", "never back this up either");
    dir
}

fn archive(root: &Path) -> Vec<u8> {
    let dir = tempdir().unwrap();
    let path = dir.path().join("backup.zip");
    export_in(root, &path).unwrap();
    fs::read(path).unwrap()
}

fn unpack(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut file = zip.by_index(i).unwrap();
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).unwrap();
            (file.name().unwrap().into_owned(), bytes)
        })
        .collect()
}

fn repack(files: BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in files {
        zip.start_file(name, SimpleFileOptions::default()).unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

fn rejected(bytes: Vec<u8>) -> String {
    let destination = tempdir().unwrap();
    let error = restore_in(Cursor::new(bytes), destination.path())
        .err()
        .expect("must reject");
    assert_eq!(
        fs::read_dir(destination.path()).unwrap().count(),
        0,
        "no activated or staged partial project"
    );
    error
}

#[test]
fn round_trip_preserves_text_hierarchy_graphs_assets_sessions_exports_and_originals() {
    let source = fixture();
    let before = inventory(source.path()).unwrap();
    let bytes = archive(source.path());
    let entries = unpack(&bytes);
    assert!(!entries.contains_key("credentials.json"));
    assert!(!entries.contains_key("ai/keys.json"));
    let destination = tempdir().unwrap();
    let restored = restore_in(Cursor::new(bytes), destination.path()).unwrap();
    assert_eq!(restored.documents.len(), 3);
    assert_eq!(restored.folders[0].name, "Volume 1");
    assert_eq!(restored.author.as_deref(), Some("Writer"));
    assert!(restored.ai.is_none());
    let original: Project =
        serde_json::from_slice(&fs::read(source.path().join("project.json")).unwrap()).unwrap();
    assert_ne!(restored.id, original.id);
    let target = restored.get_dir();
    for name in [
        "assets/image.png",
        "ai/sessions/session.json",
        "exports/book.pdf",
    ] {
        assert_eq!(fs::read(target.join(name)).unwrap(), entries[name]);
    }
    let chapter = restored
        .documents
        .iter()
        .find(|d| d.id == "chapter-1")
        .unwrap();
    assert_eq!(chapter.folder_id.as_deref(), Some("volume-1"));
    assert!(chapter.content.contains("<strong>বাংলা</strong>"));
    assert!(chapter.content.contains(&format!(
        "<p><strong>বাংলা</strong> — {}</p>",
        source.path().display()
    )));
    assert!(chapter.content.contains(
        &target
            .join("assets/image.png")
            .to_string_lossy()
            .to_string()
    ));
    let doc: Value =
        serde_json::from_slice(&fs::read(target.join("documents/chapter-1.json")).unwrap())
            .unwrap();
    assert_eq!(doc["unknown"], 42);
    let metadata: Value =
        serde_json::from_slice(&fs::read(target.join("project.json")).unwrap()).unwrap();
    assert_eq!(metadata["customField"]["kept"], true);
    let map = restored.documents.iter().find(|d| d.id == "map-1").unwrap();
    let graph: Value = serde_json::from_str(&map.content).unwrap();
    for path in [
        "/items/0/assetPath",
        "/canvas/background/imagePath",
        "/terrain/bakedAssetPath",
    ] {
        assert_eq!(
            graph.pointer(path).unwrap(),
            &target
                .join("assets/image.png")
                .to_string_lossy()
                .to_string()
        );
    }
    assert_eq!(
        graph["nodes"][0]["data"]["label"],
        source.path().display().to_string()
    );
    assert_eq!(
        before.keys().collect::<Vec<_>>(),
        inventory(source.path()).unwrap().keys().collect::<Vec<_>>()
    );
    for (name, digest) in before {
        assert_eq!(
            digest.sha256,
            hash(&fs::read(source.path().join(name)).unwrap())
        );
    }
    // Repeated restore never replaces an existing recovered copy.
    let second = restore_in(Cursor::new(archive(source.path())), destination.path()).unwrap();
    assert_ne!(second.id, restored.id);
    assert!(target.exists());
}

#[test]
fn refuses_overwrite_and_preserves_the_existing_destination() {
    let source = fixture();
    let target = source.path().join("project.json");
    let original = fs::read(&target).unwrap();
    assert!(export_in(source.path(), &target).is_err());
    assert_eq!(fs::read(target).unwrap(), original);
}

#[test]
fn detects_tampered_missing_extra_and_truncated_files() {
    let source = fixture();
    let bytes = archive(source.path());
    for change in ["tamper", "missing", "extra"] {
        let mut files = unpack(&bytes);
        match change {
            "tamper" => {
                files.insert("assets/image.png".into(), vec![1, 2, 3, 4]);
            }
            "missing" => {
                files.remove("assets/image.png");
            }
            _ => {
                files.insert("assets/extra.png".into(), vec![1]);
            }
        }
        rejected(repack(files));
    }
    rejected(bytes[..bytes.len() / 2].to_vec());
}

#[test]
fn rejects_newer_schema_and_oversized_entries_before_extraction() {
    let source = fixture();
    let bytes = archive(source.path());
    for mode in ["schema", "size", "identity"] {
        let mut files = unpack(&bytes);
        let mut manifest: Value = serde_json::from_slice(&files[MANIFEST]).unwrap();
        match mode {
            "schema" => manifest["schemaVersion"] = 999.into(),
            "size" => manifest["files"]["assets/image.png"]["size"] = (MAX_FILE + 1).into(),
            _ => manifest["projectId"] = Uuid::new_v4().to_string().into(),
        }
        files.insert(MANIFEST.into(), serde_json::to_vec(&manifest).unwrap());
        rejected(repack(files));
    }
}

#[test]
fn rejects_paths_unsafe_on_either_platform_and_case_collisions() {
    for name in [
        "../escape",
        "/root",
        "C:/file",
        "assets/../file",
        "assets\\evil",
        "assets/x:stream",
        "assets/CON.txt",
        "assets/LPT1",
        "assets/trailing.",
        "assets/a//b",
    ] {
        assert!(!safe_name(name), "{name}");
    }
    let source = fixture();
    let bytes = archive(source.path());
    for name in ["../escape", "assets/IMAGE.PNG", "ai/keys.json"] {
        let mut files = unpack(&bytes);
        let digest = serde_json::json!({"size": 1, "sha256": hash(&[1])});
        let mut manifest: Value = serde_json::from_slice(&files[MANIFEST]).unwrap();
        manifest["files"][name] = digest;
        files.insert(name.into(), vec![1]);
        files.insert(MANIFEST.into(), serde_json::to_vec(&manifest).unwrap());
        rejected(repack(files));
    }
}

/// Regression (PR #3 review, item 1): one damaged chapter blocked every backup of the project,
/// though the app itself opens the project. It is now copied as it is, named in a warning, and
/// the backup restores; every other chapter is still checked strictly on restore.
#[test]
fn a_damaged_chapter_is_backed_up_as_is_with_a_warning() {
    let source = fixture();
    put(source.path(), "documents/chapter-1.json", "damaged json");
    let dir = tempdir().unwrap();
    let path = dir.path().join("backup.zip");
    let warnings = export_in(source.path(), &path).unwrap();
    assert_eq!(warnings, vec!["chapter-1.json could not be read and was copied as it is.".to_string()]);
    let bytes = fs::read(&path).unwrap();
    let entries = unpack(&bytes);
    assert_eq!(entries["documents/chapter-1.json"], b"damaged json");
    let manifest: Value = serde_json::from_slice(&entries[MANIFEST]).unwrap();
    assert_eq!(manifest["damaged"], serde_json::json!(["documents/chapter-1.json"]));
    let destination = tempdir().unwrap();
    let restored = restore_in(Cursor::new(bytes.clone()), destination.path()).unwrap();
    assert_eq!(restored.documents.len(), 2, "the readable chapters come back");
    assert_eq!(fs::read(restored.get_dir().join("documents/chapter-1.json")).unwrap(), b"damaged json");

    // Only files the backup itself marked as damaged may be invalid on restore.
    let mut files = unpack(&bytes);
    let mut manifest: Value = serde_json::from_slice(&files[MANIFEST]).unwrap();
    manifest.as_object_mut().unwrap().remove("damaged");
    files.insert(MANIFEST.into(), serde_json::to_vec(&manifest).unwrap());
    assert!(rejected(repack(files)).contains("Invalid document"));

    // A chapter missing from disk but listed in the project file is a warning, not a refusal.
    fs::remove_file(source.path().join("documents/chapter-1.json")).unwrap();
    let warnings = export_in(source.path(), &dir.path().join("second.zip")).unwrap();
    assert!(warnings.iter().any(|w| w.contains("1 chapter listed in the project file was not found")), "{warnings:?}");
}

/// Regression (PR #3 review, item 1): an image outside the project or a missing one refused the
/// whole backup. Both are now warnings, counted per image.
#[test]
fn missing_and_outside_images_are_warnings_not_refusals() {
    let source = fixture();
    fs::remove_file(source.path().join("assets/image.png")).unwrap();
    let outside = tempdir().unwrap();
    let external = outside.path().join("photo.png");
    fs::write(&external, [1, 2]).unwrap();
    let mut doc: Value = serde_json::from_slice(&fs::read(source.path().join("documents/chapter-1.json")).unwrap()).unwrap();
    let content = format!(
        "{}<img src=\"{}\">",
        doc["content"].as_str().unwrap(),
        html_escape::encode_double_quoted_attribute(&external.to_string_lossy())
    );
    doc["content"] = Value::String(content);
    put(source.path(), "documents/chapter-1.json", doc.to_string());
    let dir = tempdir().unwrap();
    let path = dir.path().join("backup.zip");
    let warnings = export_in(source.path(), &path).unwrap();
    assert!(warnings.contains(&"1 image outside this project was not included. Import it into the project to back it up.".to_string()), "{warnings:?}");
    assert!(warnings.contains(&"1 image is missing from the project's assets folder.".to_string()), "{warnings:?}");
    let target = tempdir().unwrap();
    let restored = restore_in(Cursor::new(fs::read(&path).unwrap()), target.path()).unwrap();
    let chapter = restored.documents.iter().find(|d| d.id == "chapter-1").unwrap();
    assert!(chapter.content.contains("mnemo-asset:image.png"), "a missing image stays a portable, harmless reference");
}

/// Regression (PR #3 review, item 2): the archive recorded the project's absolute folder (with
/// the OS user name), and chapters kept absolute image paths.
#[test]
fn archives_are_portable_and_never_record_the_source_folder() {
    let source = fixture();
    let bytes = archive(source.path());
    let entries = unpack(&bytes);
    let manifest: Value = serde_json::from_slice(&entries[MANIFEST]).unwrap();
    assert_eq!(manifest["schemaVersion"], 2);
    assert!(manifest.get("sourceRoot").is_none());
    let root = source.path().canonicalize().unwrap().to_string_lossy().replace('\\', "/");
    let root = root.trim_start_matches("//?/").to_string();
    for name in ["documents/chapter-1.json", "documents/map-1.json", "documents/mind-1.json"] {
        let doc: Value = serde_json::from_slice(&entries[name]).unwrap();
        let content = doc["content"].as_str().unwrap().replace("\\\\", "/").replace('\\', "/");
        assert!(content.contains("mnemo-asset:image.png"), "{name}");
        assert!(!content.contains(&format!("{root}/assets")), "{name} keeps no absolute image path");
    }
    let raw = String::from_utf8_lossy(&entries[MANIFEST]).replace("\\\\", "/");
    assert!(!raw.contains(&root));
}

/// Archives made before schema 2 (with `sourceRoot` and absolute paths) still restore.
#[test]
fn schema_one_archives_still_restore() {
    let mut files = BTreeMap::new();
    let pid = Uuid::new_v4().to_string();
    let old = r"C:\Users\Writer\Novel";
    files.insert(
        "project.json".to_string(),
        serde_json::json!({"id": pid, "name": "Old", "created_at": "2026", "folders": [], "documents": []}).to_string().into_bytes(),
    );
    files.insert("assets/a.png".to_string(), vec![9, 9]);
    let content = format!("<img src=\"{old}\\assets\\a.png\">");
    files.insert(
        "documents/c1.json".to_string(),
        serde_json::json!({"id": "c1", "title": "C1", "content": content, "updated_at": "now"}).to_string().into_bytes(),
    );
    let digests: serde_json::Map<String, Value> =
        files.iter().map(|(n, b)| (n.clone(), serde_json::json!({"size": b.len(), "sha256": hash(b)}))).collect();
    let manifest = serde_json::json!({"format": "mnemoscript-project-backup", "schemaVersion": 1, "projectId": pid, "sourceRoot": old, "files": digests});
    files.insert(MANIFEST.to_string(), serde_json::to_vec(&manifest).unwrap());
    let destination = tempdir().unwrap();
    let restored = restore_in(Cursor::new(repack(files)), destination.path()).unwrap();
    let expected = restored.get_dir().join("assets/a.png").to_string_lossy().into_owned();
    assert!(restored.documents[0].content.contains(&*html_escape::encode_double_quoted_attribute(&expected)));
}

/// Regression (PR #3 review, item 3): every backup was `<id>-<uuid>.zip` and they piled up
/// unseen. Names now carry the project and time, the newest `KEEP` per project are kept, and the
/// list reads the project from inside each archive.
#[test]
fn backups_are_named_listed_and_pruned_per_project() {
    let source = fixture();
    let other = fixture();
    let folder = tempdir().unwrap();
    let pid = |dir: &TempDir| {
        serde_json::from_slice::<Value>(&fs::read(dir.path().join("project.json")).unwrap()).unwrap()["id"].as_str().unwrap().to_string()
    };
    let theirs = create_in(&pid(&other), other.path(), folder.path()).unwrap();
    let mut made = Vec::new();
    for _ in 0..KEEP + 2 {
        made.push(create_in(&pid(&source), source.path(), folder.path()).unwrap());
    }
    let name = &made.last().unwrap().file_name;
    assert!(name.starts_with("Novel-20") && name.ends_with(".zip"), "{name}");
    let list = list_in(folder.path());
    let mine: Vec<_> = list.iter().filter(|b| b.project_id == pid(&source)).collect();
    assert_eq!(mine.len(), KEEP);
    assert!(mine.iter().all(|b| b.project_name == "Novel" && b.size > 0));
    assert!(Path::new(&made.last().unwrap().path).exists(), "the newest is never pruned");
    assert!(Path::new(&theirs.path).exists(), "other projects' backups are untouched");
}

/// Only files directly in the backups folder can be copied or deleted by name.
#[test]
fn only_backups_in_the_backups_folder_can_be_named() {
    let folder = tempdir().unwrap();
    let inside = folder.path().join("Novel-2026-11-15-1200.zip");
    fs::write(&inside, b"zip").unwrap();
    assert!(in_folder(folder.path(), &inside.to_string_lossy()).is_ok());
    let source = fixture();
    let nested = folder.path().join("sub");
    fs::create_dir_all(&nested).unwrap();
    let parent = folder.path().parent().unwrap().join(format!("x-{}.zip", Uuid::new_v4()));
    for outside in [source.path().join("project.json"), nested.join("x.zip"), parent.clone()] {
        fs::write(&outside, b"x").unwrap();
        assert!(in_folder(folder.path(), &outside.to_string_lossy()).is_err(), "{}", outside.display());
    }
    let _ = fs::remove_file(parent);
}

#[test]
fn asset_remapping_is_structural_and_cross_platform() {
    let mut files = BTreeMap::new();
    files.insert(
        "assets/Image.png".into(),
        FileDigest {
            size: 0,
            sha256: hash(&[]),
        },
    );
    let target = Path::new("/restored/novel");
    assert_eq!(
        asset_reference(
            "C:\\Novel\\assets\\image.png",
            "\\\\?\\C:\\Novel",
            target,
            &files
        )
        .unwrap(),
        Some(
            target
                .join("assets/Image.png")
                .to_string_lossy()
                .into_owned()
        )
    );
    assert!(asset_reference(
        "C:\\NovelOther\\assets\\Image.png",
        "C:\\Novel",
        target,
        &files
    )
    .is_err());
    assert!(asset_reference(
        "C:\\Novel\\assets\\missing.png",
        "C:\\Novel",
        target,
        &files
    )
    .is_err());
    assert_eq!(
        asset_reference("https://example.org/image.png", "C:\\Novel", target, &files).unwrap(),
        None
    );
    assert!(asset_reference("file:///private/image.png", "C:\\Novel", target, &files).is_err());
}

#[test]
fn rejects_symlink_archive_entries() {
    let source = fixture();
    let bytes = archive(source.path());
    let files = unpack(&bytes);
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in files {
        if name == "assets/image.png" {
            zip.add_symlink(name, "/private/secret", SimpleFileOptions::default())
                .unwrap();
        } else {
            zip.start_file(name, SimpleFileOptions::default()).unwrap();
            zip.write_all(&bytes).unwrap();
        }
    }
    assert!(rejected(zip.finish().unwrap().into_inner()).contains("Unsafe"));
}

#[test]
fn rejects_folder_cycles() {
    let source = fixture();
    let path = source.path().join("project.json");
    let mut metadata: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    metadata["folders"][0]["parentId"] = "volume-1".into();
    put(source.path(), "project.json", metadata.to_string());
    assert!(export_in(source.path(), &source.path().join("bad.zip"))
        .unwrap_err()
        .contains("cycle"));
}

#[test]
fn image_attributes_decode_source_entities_and_escape_restored_paths() {
    let source = fixture();
    let parent = tempdir().unwrap();
    let target = parent.path().join("Restore &quot; & notes");
    let restored = restore_in(Cursor::new(archive(source.path())), &target).unwrap();
    let chapter = restored
        .documents
        .iter()
        .find(|d| d.id == "chapter-1")
        .unwrap();
    assert!(chapter.content.contains("Restore &amp;quot; &amp; notes"));
    assert!(restored.get_dir().join("assets/image.png").is_file());
}

/// Regression (2026-11-13): restore relocated item/background/terrain paths but left the map's
/// "My Imports" library pointing at the original project, so those images broke once the
/// original was gone or the backup was restored on another device.
#[test]
fn restore_relocates_fantasy_map_import_library_paths() {
    let source = fixture();
    let path = source.path().join("documents/map-1.json");
    let mut doc: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let mut graph: Value = serde_json::from_str(doc["content"].as_str().unwrap()).unwrap();
    graph["imports"] = serde_json::json!([
        { "id": "imp-1", "name": "Tower", "path": source.path().join("assets/image.png") },
        { "id": "imp-2", "name": "Unrelated", "note": { "path": "kept as written" } }
    ]);
    doc["content"] = Value::String(graph.to_string());
    fs::write(&path, doc.to_string()).unwrap();

    let destination = tempdir().unwrap();
    let restored = restore_in(Cursor::new(archive(source.path())), destination.path()).unwrap();
    let map = restored.documents.iter().find(|d| d.id == "map-1").unwrap();
    let graph: Value = serde_json::from_str(&map.content).unwrap();
    assert_eq!(
        graph["imports"][0]["path"],
        restored.get_dir().join("assets/image.png").to_string_lossy().to_string()
    );
    assert_eq!(graph["imports"][1]["note"]["path"], "kept as written");
}

/// A map import outside the project is not included, and the writer is told (PR #3 review:
/// it used to refuse the whole backup).
#[test]
fn a_map_import_outside_the_project_is_a_warning() {
    let source = fixture();
    let path = source.path().join("documents/map-1.json");
    let mut doc: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let mut graph: Value = serde_json::from_str(doc["content"].as_str().unwrap()).unwrap();
    graph["imports"] = serde_json::json!([{ "id": "imp-1", "name": "Elsewhere", "path": "C:/Other/assets/x.png" }]);
    doc["content"] = Value::String(graph.to_string());
    fs::write(&path, doc.to_string()).unwrap();
    let dir = tempdir().unwrap();
    let warnings = export_in(source.path(), &dir.path().join("b.zip")).unwrap();
    assert!(warnings.iter().any(|w| w.contains("1 image outside this project")), "{warnings:?}");
}
