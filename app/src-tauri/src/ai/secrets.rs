//! API-key storage. Keys never leave the backend: the frontend can set, clear and ask *whether*
//! a key exists, but never read one back. Provider calls are made from Rust.
//!
//! * Desktop: the OS secret store (Windows Credential Manager / macOS Keychain) via `keyring`.
//!   (On Linux, `keyring` is built without a backend for now, so keys do not persist there.)
//! * Android/iOS: a JSON file in the app-private data dir, which other apps cannot read.
//!
//! Debug builds use a separate service name / file so development never touches the keys of
//! the installed app.
use std::collections::BTreeMap;
use std::path::Path;

pub const PROVIDERS: [&str; 3] = ["anthropic", "openai", "gemini"];

pub fn check_provider(provider: &str) -> Result<(), String> {
    if PROVIDERS.contains(&provider) {
        Ok(())
    } else {
        Err(format!("Unknown API-key provider \"{provider}\""))
    }
}

#[cfg(desktop)]
mod store {
    const SERVICE: &str = if cfg!(debug_assertions) { "MnemoScript-dev" } else { "MnemoScript" };

    fn entry(provider: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, &format!("ai-key-{provider}")).map_err(|e| e.to_string())
    }
    pub fn get(provider: &str) -> Result<Option<String>, String> {
        match entry(provider)?.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn set(provider: &str, key: &str) -> Result<(), String> {
        entry(provider)?.set_password(key).map_err(|e| e.to_string())
    }
    pub fn clear(provider: &str) -> Result<(), String> {
        match entry(provider)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(desktop))]
mod store {
    use std::path::PathBuf;
    fn path() -> PathBuf {
        crate::project::data_dir().join("secrets").join("ai-keys.json")
    }
    pub fn get(provider: &str) -> Result<Option<String>, String> {
        Ok(super::file_read(&path())?.get(provider).cloned())
    }
    pub fn set(provider: &str, key: &str) -> Result<(), String> {
        let mut all = super::file_read(&path())?;
        all.insert(provider.to_string(), key.to_string());
        super::file_write(&path(), &all)
    }
    pub fn clear(provider: &str) -> Result<(), String> {
        let mut all = super::file_read(&path())?;
        all.remove(provider);
        super::file_write(&path(), &all)
    }
}

// File backend helpers (used on mobile; unit-tested on every platform).
#[cfg_attr(desktop, allow(dead_code))]
fn file_read(path: &Path) -> Result<BTreeMap<String, String>, String> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let s = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}
#[cfg_attr(desktop, allow(dead_code))]
fn file_write(path: &Path, all: &BTreeMap<String, String>) -> Result<(), String> {
    let json = serde_json::to_string(all).map_err(|e| e.to_string())?;
    crate::project::write_atomic(path, &json)
}

pub fn get(provider: &str) -> Result<Option<String>, String> {
    check_provider(provider)?;
    store::get(provider)
}

pub fn set(provider: &str, key: &str) -> Result<(), String> {
    check_provider(provider)?;
    let key = key.trim();
    if key.is_empty() {
        return Err("The API key is empty".into());
    }
    store::set(provider, key)
}

pub fn clear(provider: &str) -> Result<(), String> {
    check_provider(provider)?;
    store::clear(provider)
}

/// Which providers have a key saved (never the keys themselves).
pub fn status() -> BTreeMap<String, bool> {
    PROVIDERS
        .iter()
        .map(|p| (p.to_string(), matches!(store::get(p), Ok(Some(_)))))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_backend_round_trips_and_removes_keys() {
        let path = std::env::temp_dir().join(format!("mnemo-keys-{}.json", uuid::Uuid::new_v4()));
        let mut all = file_read(&path).unwrap();
        assert!(all.is_empty());
        all.insert("openai".into(), "sk-test".into());
        file_write(&path, &all).unwrap();
        assert_eq!(file_read(&path).unwrap().get("openai").map(String::as_str), Some("sk-test"));
        all.remove("openai");
        file_write(&path, &all).unwrap();
        assert!(file_read(&path).unwrap().is_empty());
    }

    #[test]
    fn only_known_providers_are_accepted() {
        assert!(check_provider("anthropic").is_ok());
        assert!(check_provider("claude-code").is_err());
        assert!(set("../x", "k").is_err());
    }
}
