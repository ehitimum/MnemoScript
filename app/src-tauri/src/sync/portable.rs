//! Portable asset references for synced content.
//!
//! Documents on disk keep absolute paths to `<project>/assets/<file>` (the editor and maps
//! resolve them at render time). Synced snapshots replace exactly those references with
//! `mnemo-asset:<file>`, and the receiving device turns them back into its own absolute path.
//! Only `<img src>` in chapters and whole JSON string values in maps are touched; prose,
//! graph labels and ids are never rewritten.
use lol_html::{element, rewrite_str, RewriteStrSettings};
use serde_json::Value;
use std::path::Path;

pub const SCHEME: &str = "mnemo-asset:";

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches("//?/").trim_end_matches('/').to_string()
}

/// The asset file name if `value` points into this project's `assets/` folder.
fn project_asset(value: &str, roots: &[String]) -> Option<String> {
    let path = normalize(value);
    for root in roots {
        let prefix = format!("{}/assets/", normalize(root));
        let windows = prefix.as_bytes().get(1) == Some(&b':');
        let matches = path.starts_with(&prefix)
            || (windows && path.get(..prefix.len()).is_some_and(|p| p.eq_ignore_ascii_case(&prefix)));
        if matches {
            let name = &path[prefix.len()..];
            if super::model::safe_asset_name(name) {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Every textual form of a project root that a stored path might start with.
pub fn roots_for(dir: &Path) -> Vec<String> {
    let mut roots = vec![dir.to_string_lossy().into_owned()];
    if let Ok(canonical) = dir.canonicalize() {
        let c = canonical.to_string_lossy().into_owned();
        if !roots.contains(&c) {
            roots.push(c);
        }
    }
    roots
}

fn rewrite_html(html: &str, map: &dyn Fn(&str) -> Option<String>) -> String {
    if !html.contains("<img") {
        return html.to_string();
    }
    let result = rewrite_str(
        html,
        RewriteStrSettings::new().append_element_content_handler(element!("img[src]", |el| {
            let raw = el.get_attribute("src").unwrap_or_default();
            let src = html_escape::decode_html_entities(&raw).into_owned();
            if let Some(mapped) = map(&src) {
                el.set_attribute("src", &html_escape::encode_double_quoted_attribute(&mapped))?;
            }
            Ok(())
        })),
    );
    // A parse failure leaves the chapter exactly as written rather than dropping it.
    result.unwrap_or_else(|_| html.to_string())
}

fn rewrite_json(value: &mut Value, map: &dyn Fn(&str) -> Option<String>) -> bool {
    match value {
        Value::String(s) => match map(s) {
            Some(mapped) => {
                *s = mapped;
                true
            }
            None => false,
        },
        Value::Array(items) => items.iter_mut().fold(false, |changed, v| rewrite_json(v, map) | changed),
        Value::Object(obj) => obj.values_mut().fold(false, |changed, v| rewrite_json(v, map) | changed),
        _ => false,
    }
}

fn rewrite(content: &str, doc_type: &str, map: &dyn Fn(&str) -> Option<String>) -> String {
    if doc_type == "text" {
        return rewrite_html(content, map);
    }
    // Untouched content keeps its exact bytes; only rewritten maps are re-serialised.
    match serde_json::from_str::<Value>(content) {
        Ok(mut graph) => {
            if rewrite_json(&mut graph, map) {
                serde_json::to_string(&graph).unwrap_or_else(|_| content.to_string())
            } else {
                content.to_string()
            }
        }
        Err(_) => content.to_string(),
    }
}

/// Disk content -> synced content.
pub fn to_portable(content: &str, doc_type: &str, roots: &[String]) -> String {
    rewrite(content, doc_type, &|v| project_asset(v, roots).map(|name| format!("{SCHEME}{name}")))
}

/// Synced content -> disk content for this device's copy of the project.
pub fn to_local(content: &str, doc_type: &str, project_dir: &Path) -> String {
    let assets = project_dir.join("assets");
    rewrite(content, doc_type, &|v| {
        let name = v.strip_prefix(SCHEME)?;
        super::model::safe_asset_name(name).then(|| assets.join(name).to_string_lossy().into_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chapter_images_round_trip_between_devices() {
        let desktop = Path::new(r"C:\Users\Writer\Novels\Ashen");
        let roots = roots_for(desktop);
        let html = r#"<p>Before <img src="C:\Users\Writer\Novels\Ashen\assets\a1.png" alt="map"> after &amp; C:\Users\Writer\Novels\Ashen\assets\a1.png</p>"#;
        let portable = to_portable(html, "text", &roots);
        assert!(portable.contains(r#"src="mnemo-asset:a1.png""#), "{portable}");
        assert!(portable.contains(r"after &amp; C:\Users\Writer\Novels\Ashen\assets\a1.png"), "prose is untouched");

        let phone = Path::new("/data/user/0/app/projects/p1");
        let local = to_local(&portable, "text", phone);
        assert!(local.contains("/data/user/0/app/projects/p1"));
        assert_eq!(to_portable(&local, "text", &roots_for(phone)), portable, "stable round trip");
    }

    #[test]
    fn windows_paths_match_case_insensitively_and_with_forward_slashes() {
        let roots = vec![r"C:\Novels\Ashen".to_string()];
        let html = r#"<img src="c:/novels/ashen/assets/B.jpg">"#;
        assert_eq!(to_portable(html, "text", &roots), r#"<img src="mnemo-asset:B.jpg">"#);
    }

    #[test]
    fn map_documents_rewrite_whole_path_values_including_imports() {
        let roots = vec!["/home/w/p".to_string()];
        let map = r#"{"items":[{"assetPath":"/home/w/p/assets/i.png","label":"/home/w/p/assets/i.png is here"}],"imports":[{"id":"x","name":"Tower","path":"/home/w/p/assets/t.png"}],"other":"/elsewhere/z.png"}"#;
        let portable = to_portable(map, "fantasymap", &roots);
        let v: Value = serde_json::from_str(&portable).unwrap();
        assert_eq!(v["items"][0]["assetPath"], "mnemo-asset:i.png");
        assert_eq!(v["items"][0]["label"], "/home/w/p/assets/i.png is here");
        assert_eq!(v["imports"][0]["path"], "mnemo-asset:t.png");
        assert_eq!(v["other"], "/elsewhere/z.png", "assets outside the project are left alone");
        let back = to_local(&portable, "fantasymap", Path::new("/phone/p"));
        assert_eq!(to_portable(&back, "fantasymap", &["/phone/p".to_string()]), portable);
    }

    #[test]
    fn content_without_assets_keeps_its_exact_bytes() {
        let map = "{ \"nodes\": [ ], \"edges\": [] }";
        assert_eq!(to_portable(map, "mindmap", &["/p".into()]), map);
        assert_eq!(to_local(map, "mindmap", Path::new("/p")), map);
        assert_eq!(to_portable("<p>Hi</p>", "text", &["/p".into()]), "<p>Hi</p>");
    }

    #[test]
    fn hostile_portable_names_are_not_turned_into_paths() {
        let html = r#"<img src="mnemo-asset:../../secret.txt">"#;
        assert_eq!(to_local(html, "text", Path::new("/p")), html);
    }
}
