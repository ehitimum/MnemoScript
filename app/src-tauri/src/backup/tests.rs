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

#[test]
fn does_not_skip_damaged_documents_or_missing_indexed_chapters() {
    let source = fixture();
    put(source.path(), "documents/chapter-1.json", "damaged json");
    let target = source.path().join("bad.zip");
    assert!(export_in(source.path(), &target)
        .unwrap_err()
        .contains("Damaged document"));
    assert!(!target.exists());
    fs::remove_file(source.path().join("documents/chapter-1.json")).unwrap();
    assert!(export_in(source.path(), &target)
        .unwrap_err()
        .contains("missing an indexed document"));
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
fn refuses_missing_and_external_local_assets_before_creating_archive() {
    let source = fixture();
    fs::remove_file(source.path().join("assets/image.png")).unwrap();
    let target = source.path().join("bad.zip");
    assert!(export_in(source.path(), &target)
        .unwrap_err()
        .contains("missing project asset"));
    assert!(!target.exists());
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

#[test]
fn backup_rejects_a_map_import_outside_the_project() {
    let source = fixture();
    let path = source.path().join("documents/map-1.json");
    let mut doc: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let mut graph: Value = serde_json::from_str(doc["content"].as_str().unwrap()).unwrap();
    graph["imports"] = serde_json::json!([{ "id": "imp-1", "name": "Elsewhere", "path": "C:/Other/assets/x.png" }]);
    doc["content"] = Value::String(graph.to_string());
    fs::write(&path, doc.to_string()).unwrap();
    let dir = tempdir().unwrap();
    let error = export_in(source.path(), &dir.path().join("b.zip")).unwrap_err();
    assert!(error.contains("external local asset"), "{error}");
}
