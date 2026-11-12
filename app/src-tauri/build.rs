/// Google Drive sync is enabled only in builds that know an OAuth client. The values come from
/// the environment or from a git-ignored `.env.local`, so no client is ever committed.
fn google_oauth_env() {
    const KEYS: [&str; 2] = ["MNEMO_GOOGLE_CLIENT_ID", "MNEMO_GOOGLE_CLIENT_SECRET"];
    println!("cargo:rerun-if-changed=.env.local");
    let file = std::fs::read_to_string(".env.local").unwrap_or_default();
    for key in KEYS {
        println!("cargo:rerun-if-env-changed={key}");
        let from_file = file.lines().find_map(|line| {
            let (k, v) = line.trim().split_once('=')?;
            (k.trim() == key).then(|| v.trim().trim_matches('"').to_string())
        });
        let value = std::env::var(key).ok().or(from_file).unwrap_or_default();
        if !value.is_empty() {
            println!("cargo:rustc-env={key}={value}");
        }
    }
}

fn main() {
    google_oauth_env();
    tauri_build::build()
}
