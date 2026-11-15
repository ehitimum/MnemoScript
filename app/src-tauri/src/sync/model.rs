//! Transport-neutral MnemoSync records: entity keys, canonical snapshots and revision ids.
//!
//! A project is split into small entities so independent edits never collide:
//! `project` (name/description/author), `folder:<id>` (name/order/parent),
//! `doc:<id>` (title/type/order/folder), `text:<id>` (the chapter or map body, by hash) and
//! `asset:<file>` (image bytes, by hash). Moving a chapter on one device and editing its text
//! on another therefore touches two different entities and both changes apply.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub const SCHEMA_VERSION: u32 = 1;

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Serialise with object keys sorted at every level, independent of serde_json's map backend,
/// so the same logical snapshot always hashes to the same revision id on every device.
pub fn canonical(value: &Value) -> String {
    fn write(value: &Value, out: &mut String) {
        match value {
            Value::Object(map) => {
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                out.push('{');
                for (i, key) in keys.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&Value::String((*key).clone()).to_string());
                    out.push(':');
                    write(&map[*key], out);
                }
                out.push('}');
            }
            Value::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write(item, out);
                }
                out.push(']');
            }
            other => out.push_str(&other.to_string()),
        }
    }
    let mut out = String::new();
    write(value, &mut out);
    out
}

/// Hash of an entity state (`None` = deleted). Used to notice local edits cheaply.
pub fn state_hash(payload: Option<&Value>) -> String {
    sha256_hex(payload.map(canonical).unwrap_or_else(|| "null".into()).as_bytes())
}

/// The id of a revision depends only on its entity, causal parents and content, never on the
/// device or clock. Two devices that reach the same merge independently produce the same id.
pub fn revision_id(entity: &str, parents: &[String], payload: Option<&Value>) -> String {
    let mut sorted = parents.to_vec();
    sorted.sort();
    sorted.dedup();
    let body = format!(
        "mnemo-rev-v1\n{entity}\n{}\n{}",
        sorted.join(","),
        payload.map(canonical).unwrap_or_else(|| "null".into())
    );
    sha256_hex(body.as_bytes())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Project,
    Folder,
    Doc,
    Text,
    Asset,
}

/// Parse and validate an entity key. Remote data is untrusted: ids become file names, so only
/// plain identifier characters are accepted.
pub fn parse_entity(entity: &str) -> Option<(Kind, &str)> {
    if entity == "project" {
        return Some((Kind::Project, ""));
    }
    let (kind, id) = entity.split_once(':')?;
    let kind = match kind {
        "folder" => Kind::Folder,
        "doc" => Kind::Doc,
        "text" => Kind::Text,
        "asset" => Kind::Asset,
        _ => return None,
    };
    let ok = match kind {
        Kind::Asset => safe_asset_name(id),
        _ => safe_id(id),
    };
    ok.then_some((kind, id))
}

pub fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn safe_asset_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.contains("..")
}

/// One immutable revision as exchanged between devices.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub entity: String,
    pub rev: String,
    pub parents: Vec<String>,
    /// `null` is a tombstone (the entity was deleted).
    pub payload: Option<Value>,
    pub origin: String,
}

impl Revision {
    pub fn new(entity: &str, parents: Vec<String>, payload: Option<Value>, origin: &str) -> Self {
        let mut parents = parents;
        parents.sort();
        parents.dedup();
        let rev = revision_id(entity, &parents, payload.as_ref());
        Revision { entity: entity.into(), rev, parents, payload, origin: origin.into() }
    }

    /// Recompute the id: a received revision whose id does not match its content is rejected.
    pub fn verify(&self) -> bool {
        parse_entity(&self.entity).is_some()
            && self.parents.len() <= 64
            && self.rev == revision_id(&self.entity, &self.parents, self.payload.as_ref())
    }

    /// Hash of a content blob this revision needs (`text` and `asset` entities only).
    pub fn blob(&self) -> Option<String> {
        let (kind, _) = parse_entity(&self.entity)?;
        if !matches!(kind, Kind::Text | Kind::Asset) {
            return None;
        }
        let sha = self.payload.as_ref()?.get("sha256")?.as_str()?;
        (sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit())).then(|| sha.to_ascii_lowercase())
    }
}

/// A device's numbered publication. Batches from one device are applied in sequence order.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub schema_version: u32,
    pub project_id: String,
    pub device_id: String,
    pub device_name: String,
    pub seq: u64,
    pub created_at: String,
    pub revisions: Vec<Revision>,
}

/// Field-level three-way merge for small metadata entities. Symmetric and deterministic: both
/// devices compute the same result. Returns the merged value and the keys that truly collided.
pub fn merge_fields(
    base: Option<&Value>,
    ours: (&str, Option<&Value>),
    theirs: (&str, Option<&Value>),
) -> (Option<Value>, Vec<String>) {
    let (our_rev, ours) = ours;
    let (their_rev, theirs) = theirs;
    match (ours, theirs) {
        (None, None) => return (None, Vec::new()),
        // Edit beats delete: a chapter changed elsewhere is never silently lost. An unchanged
        // side accepts the delete.
        (None, Some(kept)) | (Some(kept), None) => {
            return if base == Some(kept) {
                (None, Vec::new())
            } else {
                (Some(kept.clone()), vec!["deleted".into()])
            };
        }
        _ => {}
    }
    let empty = Map::new();
    let o = ours.and_then(Value::as_object).unwrap_or(&empty);
    let t = theirs.and_then(Value::as_object).unwrap_or(&empty);
    let b = base.and_then(Value::as_object).unwrap_or(&empty);
    let mut keys: Vec<&String> = o.keys().chain(t.keys()).collect();
    keys.sort();
    keys.dedup();
    let mut merged = Map::new();
    let mut collided = Vec::new();
    for key in keys {
        let (ov, tv, bv) = (o.get(key), t.get(key), b.get(key));
        let pick = if ov == tv || tv == bv {
            ov
        } else if ov == bv {
            tv
        } else {
            collided.push(key.clone());
            // Deterministic, clock-free tie-break so every replica converges.
            if our_rev > their_rev { ov } else { tv }
        };
        if let Some(v) = pick {
            merged.insert(key.clone(), v.clone());
        }
    }
    (Some(Value::Object(merged)), collided)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_json_ignores_key_order() {
        let a = json!({"b": 1, "a": {"y": [1, {"d": 2, "c": 3}], "x": null}});
        let b: Value = serde_json::from_str(r#"{"a":{"x":null,"y":[1,{"c":3,"d":2}]},"b":1}"#).unwrap();
        assert_eq!(canonical(&a), canonical(&b));
        assert_eq!(canonical(&a), r#"{"a":{"x":null,"y":[1,{"c":3,"d":2}]},"b":1}"#);
    }

    #[test]
    fn revision_ids_are_device_independent_and_verified() {
        let one = Revision::new("doc:a", vec!["p2".into(), "p1".into()], Some(json!({"title": "One"})), "phone");
        let two = Revision::new("doc:a", vec!["p1".into(), "p2".into()], Some(json!({"title": "One"})), "desktop");
        assert_eq!(one.rev, two.rev);
        assert!(one.verify());
        let mut forged = one.clone();
        forged.payload = Some(json!({"title": "Two"}));
        assert!(!forged.verify());
    }

    #[test]
    fn entity_keys_reject_paths() {
        assert!(parse_entity("doc:3f2a-11").is_some());
        assert!(parse_entity("asset:9c1e.png").is_some());
        assert!(parse_entity("doc:../x").is_none());
        assert!(parse_entity("asset:..png").is_none());
        assert!(parse_entity("asset:a/b.png").is_none());
        assert!(parse_entity("asset:.hidden").is_none());
        assert!(parse_entity("other:x").is_none());
    }

    #[test]
    fn metadata_merge_takes_both_sides_and_is_symmetric() {
        let base = json!({"title": "Ch 2", "folderId": null, "order": 1});
        let moved = json!({"title": "Ch 2", "folderId": "vol1", "order": 1});
        let renamed = json!({"title": "Chapter Two", "folderId": null, "order": 1});
        let (m1, c1) = merge_fields(Some(&base), ("a", Some(&moved)), ("b", Some(&renamed)));
        let (m2, c2) = merge_fields(Some(&base), ("b", Some(&renamed)), ("a", Some(&moved)));
        assert_eq!(m1, Some(json!({"title": "Chapter Two", "folderId": "vol1", "order": 1})));
        assert_eq!(m1, m2);
        assert!(c1.is_empty() && c2.is_empty());

        let x = json!({"title": "X"});
        let y = json!({"title": "Y"});
        let (r1, k1) = merge_fields(Some(&base), ("a", Some(&x)), ("b", Some(&y)));
        let (r2, _) = merge_fields(Some(&base), ("b", Some(&y)), ("a", Some(&x)));
        assert_eq!(r1, r2);
        assert_eq!(k1, vec!["title".to_string()]);
    }

    #[test]
    fn edit_wins_over_concurrent_delete() {
        let base = json!({"title": "A"});
        let edited = json!({"title": "B"});
        let (merged, notes) = merge_fields(Some(&base), ("a", None), ("b", Some(&edited)));
        assert_eq!(merged, Some(edited));
        assert_eq!(notes, vec!["deleted".to_string()]);
    }
}
