//! Google sign-in for Drive sync.
//!
//! * Desktop: OAuth 2.0 authorization code + PKCE (S256) with a loopback redirect on
//!   `127.0.0.1:<random port>`, in the writer's own browser. MnemoScript never sees the Google
//!   password. The refresh token goes to the OS secret store (as AI keys do); access tokens
//!   live only in memory.
//! * Android: Google's native authorization API supplies short-lived access tokens through the
//!   app (`set_access_token`); no refresh token is stored on the phone.
//!
//! Only the `drive.appdata` scope is requested: MnemoScript's own hidden Drive folder, never
//! the writer's other files.
// The loopback flow (PKCE, redirect parsing, the browser page) is desktop-only.
#![cfg_attr(not(desktop), allow(dead_code))]
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";

/// The OAuth client this build was configured with (see `build.rs` / `.env.local.example`).
pub fn client_id() -> Option<&'static str> {
    option_env!("MNEMO_GOOGLE_CLIENT_ID").filter(|v| !v.is_empty())
}

fn client_secret() -> Option<&'static str> {
    option_env!("MNEMO_GOOGLE_CLIENT_SECRET").filter(|v| !v.is_empty())
}

/// Whether this build can sign in to Google at all.
pub fn configured() -> bool {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        // Android authorizes by package name + signing certificate; no client id is compiled in.
        cfg!(target_os = "android")
    } else {
        client_id().is_some()
    }
}

#[derive(Debug)]
pub enum AuthError {
    /// The grant is gone (revoked, expired, password changed): the writer must sign in again.
    Revoked(String),
    Network(String),
    Other(String),
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::Revoked(m) | AuthError::Network(m) | AuthError::Other(m) => f.write_str(m),
        }
    }
}

struct Access {
    token: String,
    expires: Instant,
}

static ACCESS: Mutex<Option<Access>> = Mutex::new(None);
static CANCEL: AtomicBool = AtomicBool::new(false);

fn lock() -> std::sync::MutexGuard<'static, Option<Access>> {
    ACCESS.lock().unwrap_or_else(|p| p.into_inner())
}

pub fn forget_access() {
    *lock() = None;
}

/// Android: the app obtained a fresh access token from Google's authorization API.
pub fn set_access_token(token: &str, expires_in: u64) {
    *lock() = Some(Access { token: token.into(), expires: Instant::now() + Duration::from_secs(expires_in.saturating_sub(60)) });
}

/// A valid access token, refreshing it from the stored grant when needed.
pub fn access_token(force_refresh: bool) -> Result<String, AuthError> {
    if !force_refresh {
        if let Some(a) = lock().as_ref() {
            if a.expires > Instant::now() {
                return Ok(a.token.clone());
            }
        }
    }
    let Some(refresh) = secret::get()? else {
        return Err(AuthError::Revoked("Sign in to Google Drive to sync".into()));
    };
    let (token, expires_in) = refresh_access(&refresh)?;
    set_access_token(&token, expires_in);
    Ok(token)
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: u64,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
    #[serde(default)]
    error_description: String,
}

fn http() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("MnemoScript")
        .build()
        .expect("HTTP client")
}

fn token_request(form: &[(&str, &str)]) -> Result<TokenResponse, AuthError> {
    let response = http().post(TOKEN_URL).form(form).send().map_err(|e| AuthError::Network(e.to_string()))?;
    let status = response.status();
    let body = response.text().map_err(|e| AuthError::Network(e.to_string()))?;
    if status.is_success() {
        return serde_json::from_str(&body).map_err(|e| AuthError::Other(e.to_string()));
    }
    let detail: Option<TokenError> = serde_json::from_str(&body).ok();
    match detail {
        Some(e) if e.error == "invalid_grant" => Err(AuthError::Revoked("Google sign-in expired; sign in again".into())),
        Some(e) => Err(AuthError::Other(format!("Google sign-in failed: {} {}", e.error, e.error_description).trim().to_string())),
        None if status.is_server_error() => Err(AuthError::Network(format!("Google sign-in is unavailable ({status})"))),
        None => Err(AuthError::Other(format!("Google sign-in failed ({status})"))),
    }
}

fn refresh_access(refresh: &str) -> Result<(String, u64), AuthError> {
    let id = client_id().ok_or_else(|| AuthError::Other("Drive sync is not configured in this build".into()))?;
    let mut form = vec![("client_id", id), ("refresh_token", refresh), ("grant_type", "refresh_token")];
    if let Some(secret) = client_secret() {
        form.push(("client_secret", secret));
    }
    let t = token_request(&form)?;
    Ok((t.access_token, t.expires_in.max(60)))
}

/// PKCE verifier/challenge pair (RFC 7636): 64 random URL-safe characters, S256 challenge.
pub fn pkce() -> (String, String) {
    let mut bytes = Vec::with_capacity(48);
    for _ in 0..3 {
        bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    }
    let verifier = URL_SAFE_NO_PAD.encode(&bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

pub fn authorize_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    let mut url = url::Url::parse(AUTH_URL).expect("static URL");
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    url.into()
}

/// Parse the loopback redirect. Returns the code only when `state` matches.
pub fn parse_redirect(path: &str, state: &str) -> Result<Option<String>, String> {
    let url = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
    if url.path() != "/" {
        return Ok(None);
    }
    let get = |k: &str| url.query_pairs().find(|(key, _)| key == k).map(|(_, v)| v.into_owned());
    if get("state").as_deref() != Some(state) {
        return Err("Sign-in response did not match this request; please try again".into());
    }
    if let Some(e) = get("error") {
        return Err(if e == "access_denied" { "Google sign-in was cancelled".into() } else { format!("Google sign-in failed: {e}") });
    }
    get("code").map(Some).ok_or_else(|| "Google did not return an authorization code".into())
}

const DONE_PAGE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>MnemoScript</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14110f;color:#efe6da;font:16px/1.6 Georgia,'Iowan Old Style',serif}
main{max-width:30rem;padding:2.5rem;text-align:center}h1{font-weight:400;font-size:1.6rem;letter-spacing:.01em;margin:0 0 .5rem}
p{color:#b9ad9e;margin:0}.mark{width:44px;height:44px;margin:0 auto 1.25rem;border-radius:50%;border:1px solid #c9a46a;display:grid;place-items:center;color:#c9a46a;font-size:1.3rem}</style></head>
<body><main><div class="mark">&#10003;</div><h1>{{TITLE}}</h1><p>{{BODY}}</p></main></body></html>"#;

fn page(title: &str, body: &str) -> String {
    DONE_PAGE.replace("{{TITLE}}", title).replace("{{BODY}}", body)
}

pub fn cancel_sign_in() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Desktop sign-in. Blocks until the browser returns, the writer cancels, or 5 minutes pass.
#[cfg(desktop)]
pub fn sign_in() -> Result<(), AuthError> {
    let id = client_id().ok_or_else(|| AuthError::Other("Drive sync is not configured in this build".into()))?;
    CANCEL.store(false, Ordering::SeqCst);
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| AuthError::Other(e.to_string()))?;
    let port = server.server_addr().to_ip().map(|a| a.port()).ok_or_else(|| AuthError::Other("No loopback port".into()))?;
    let redirect = format!("http://127.0.0.1:{port}");
    let (verifier, challenge) = pkce();
    let state = uuid::Uuid::new_v4().simple().to_string();
    open::that_detached(authorize_url(id, &redirect, &challenge, &state)).map_err(|e| AuthError::Other(format!("Could not open your browser: {e}")))?;
    let deadline = Instant::now() + Duration::from_secs(300);
    let code = loop {
        if CANCEL.load(Ordering::SeqCst) {
            return Err(AuthError::Other("Google sign-in was cancelled".into()));
        }
        if Instant::now() > deadline {
            return Err(AuthError::Other("Google sign-in timed out; please try again".into()));
        }
        let Ok(Some(request)) = server.recv_timeout(Duration::from_millis(400)) else { continue };
        let html = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).expect("static header");
        match parse_redirect(request.url(), &state) {
            Ok(None) => {
                let _ = request.respond(tiny_http::Response::empty(404));
            }
            Ok(Some(code)) => {
                let _ = request.respond(tiny_http::Response::from_string(page("You're connected", "Google Drive sync is ready. You can close this tab and return to MnemoScript.")).with_header(html));
                break code;
            }
            Err(e) => {
                let _ = request.respond(tiny_http::Response::from_string(page("Sign-in didn't finish", &html_escape::encode_text(&e))).with_header(html));
                return Err(AuthError::Other(e));
            }
        }
    };
    let mut form = vec![
        ("client_id", id),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect.as_str()),
    ];
    if let Some(secret) = client_secret() {
        form.push(("client_secret", secret));
    }
    let tokens = token_request(&form)?;
    let refresh = tokens.refresh_token.ok_or_else(|| AuthError::Other("Google did not grant offline access; please sign in again".into()))?;
    secret::set(&refresh)?;
    set_access_token(&tokens.access_token, tokens.expires_in.max(60));
    Ok(())
}

#[cfg(not(desktop))]
pub fn sign_in() -> Result<(), AuthError> {
    Err(AuthError::Other("On this device, sign in through the Google prompt".into()))
}

/// Revoke the grant at Google (best effort) and forget it locally.
pub fn sign_out() -> Result<(), String> {
    let token = secret::get().ok().flatten().or_else(|| lock().as_ref().map(|a| a.token.clone()));
    if let Some(token) = token {
        let _ = http().post(REVOKE_URL).form(&[("token", token.as_str())]).send();
    }
    forget_access();
    secret::clear().map_err(|e| e.to_string())
}

pub fn has_grant() -> bool {
    matches!(secret::get(), Ok(Some(_))) || lock().as_ref().is_some_and(|a| a.expires > Instant::now())
}

/// Refresh-token storage: the OS secret store on desktop (debug builds use their own service
/// name so development never touches the installed app). Phones keep no refresh token.
#[cfg(desktop)]
mod secret {
    use super::AuthError;
    const SERVICE: &str = if cfg!(debug_assertions) { "MnemoScript-dev" } else { "MnemoScript" };
    const ACCOUNT: &str = "google-drive-refresh";

    fn entry() -> Result<keyring::Entry, AuthError> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| AuthError::Other(e.to_string()))
    }
    pub fn get() -> Result<Option<String>, AuthError> {
        match entry()?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AuthError::Other(e.to_string())),
        }
    }
    pub fn set(value: &str) -> Result<(), AuthError> {
        entry()?.set_password(value).map_err(|e| AuthError::Other(format!("Could not store the Google sign-in securely: {e}")))
    }
    pub fn clear() -> Result<(), AuthError> {
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AuthError::Other(e.to_string())),
        }
    }
}

#[cfg(not(desktop))]
mod secret {
    use super::AuthError;
    pub fn get() -> Result<Option<String>, AuthError> {
        Ok(None)
    }
    pub fn clear() -> Result<(), AuthError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc7636_s256() {
        let (verifier, challenge) = pkce();
        assert!(verifier.len() >= 43 && verifier.len() <= 128);
        assert!(verifier.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_eq!(challenge, URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())));
        assert_ne!(pkce().0, verifier, "fresh randomness per sign-in");
        // RFC 7636 appendix B test vector.
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn authorize_url_requests_only_app_data_with_pkce() {
        let url = url::Url::parse(&authorize_url("cid.apps.googleusercontent.com", "http://127.0.0.1:5123", "chal", "st8")).unwrap();
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["scope"], SCOPE);
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5123");
        assert_eq!(q["access_type"], "offline");
        assert!(!url.as_str().contains("auth/drive "), "never the full-Drive scope");
    }

    #[test]
    fn redirect_requires_matching_state() {
        assert_eq!(parse_redirect("/?state=abc&code=4%2F0xyz", "abc").unwrap(), Some("4/0xyz".into()));
        assert!(parse_redirect("/?state=evil&code=x", "abc").is_err());
        assert!(parse_redirect("/?state=abc&error=access_denied", "abc").unwrap_err().contains("cancelled"));
        assert_eq!(parse_redirect("/favicon.ico", "abc").unwrap(), None);
    }
}
