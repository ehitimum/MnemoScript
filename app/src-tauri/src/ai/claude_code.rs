//! Claude subscription path: drive the writer's own installed, official Claude Code CLI.
//!
//! MnemoScript never sees or stores a Claude login — the CLI signs in by itself
//! (`claude auth login`). Using a subscription's sign-in token from another app is against
//! Anthropic's terms, so this is the only subscription route. See `docs/AI_PHASE0.md`.
//!
//! Lockdown: every built-in tool is disabled (`--tools ""`), the user's settings/CLAUDE.md are
//! ignored, it runs in an empty folder with a clean environment, and the only tools it gets are
//! MnemoScript's, served from `mcp_http`.
use super::engine::Turn;
use super::types::{AiEvent, ChatMessage, TurnRequest};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

/// Model aliases the CLI resolves against the writer's plan.
pub const MODEL_ALIASES: [&str; 4] = ["fable", "opus", "sonnet", "haiku"];

/// Empty (the plan's default), an alias, or a full `claude-…` id (optionally with a `[1m]` suffix).
pub fn valid_model(model: &str) -> bool {
    model.is_empty()
        || MODEL_ALIASES.contains(&model)
        || (model.starts_with("claude-")
            && model.len() <= 64
            && model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '[' | ']')))
}

/// Environment variables passed to the CLI — nothing else. Inheriting another Claude session's
/// `CLAUDE_*` variables (e.g. `CLAUDE_CODE_SIMPLE=1`) would make it ignore its own sign-in.
const KEEP_ENV: [&str; 16] = [
    "PATH", "Path", "PATHEXT", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT",
    "SystemRoot", "TEMP", "TMP", "COMSPEC", "HOMEDRIVE", "HOMEPATH", "USERNAME", "LANG",
];

pub fn clean_env() -> Vec<(String, String)> {
    KEEP_ENV.iter().filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v))).collect()
}

fn exe_names() -> &'static [&'static str] {
    if cfg!(windows) { &["claude.exe"] } else { &["claude"] }
}

/// Locate the native `claude` binary: PATH first, then the native installer's location (GUI apps
/// often start with a shorter PATH than a terminal).
pub fn find_cli() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".claude").join("local"));
    }
    dirs.iter()
        .flat_map(|d| exe_names().iter().map(move |n| d.join(n)))
        .find(|p| p.is_file())
}

fn command(cli: &Path) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(cli);
    cmd.env_clear().envs(clean_env()).kill_on_drop(true);
    // Ask mode: a write tool waits for the writer's Apply / Reject, which can take a while.
    // Give MnemoScript's MCP tools a day before the CLI gives up on them.
    cmd.env("MCP_TOOL_TIMEOUT", "86400000");
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashes up
    cmd
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub logged_in: bool,
    pub auth_method: Option<String>,
    pub email: Option<String>,
    pub org_name: Option<String>,
    /// e.g. `pro`, `max`, `team`
    pub plan: Option<String>,
}

pub fn parse_auth_status(json_text: &str, version: Option<String>) -> CliStatus {
    let v: Value = serde_json::from_str(json_text).unwrap_or(Value::Null);
    let s = |k: &str| v[k].as_str().map(str::to_string);
    CliStatus {
        installed: true,
        version,
        logged_in: v["loggedIn"].as_bool().unwrap_or(false),
        auth_method: s("authMethod"),
        email: s("email"),
        org_name: s("orgName"),
        plan: s("subscriptionType"),
    }
}

async fn run_quick(cli: &Path, args: &[&str]) -> Option<String> {
    let out = tokio::time::timeout(std::time::Duration::from_secs(20), command(cli).args(args).stdin(Stdio::null()).output())
        .await
        .ok()?
        .ok()?;
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Installed? Signed in? Which plan? (For Settings → AI.)
pub async fn status() -> CliStatus {
    let Some(cli) = find_cli() else { return CliStatus::default() };
    let version = run_quick(&cli, &["--version"]).await.filter(|s| !s.is_empty());
    let auth = run_quick(&cli, &["auth", "status", "--json"]).await.unwrap_or_default();
    parse_auth_status(&auth, version)
}

/// Plan limits exactly as Claude Code reports them: `claude -p /usage` is answered by the CLI
/// itself with its own sign-in (no model call, no cost). Returns the report text
/// ("Current session: 50% used · resets …"); `lib/ai/usage.ts` parses it.
pub async fn usage() -> Result<String, String> {
    let cli = find_cli().ok_or_else(|| "Claude Code is not installed.".to_string())?;
    let dir = std::env::temp_dir().join("mnemoscript-ai").join("usage");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let run = command(&cli)
        .current_dir(&dir)
        // Lockdown as for turns; haiku only matters if an old CLI sent "/usage" to the model.
        .args(["-p", "/usage", "--output-format", "json", "--model", "haiku", "--tools", "", "--setting-sources", ""])
        .args(["--strict-mcp-config", "--no-session-persistence"])
        .stdin(Stdio::null())
        .output();
    let out = tokio::time::timeout(std::time::Duration::from_secs(45), run)
        .await
        .map_err(|_| "Claude Code took too long to answer.".to_string())?
        .map_err(|e| e.to_string())?;
    parse_usage_result(&String::from_utf8_lossy(&out.stdout))
}

pub fn parse_usage_result(json_text: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(json_text.trim()).map_err(|_| "Claude Code did not return a usage report.".to_string())?;
    let text = v["result"].as_str().unwrap_or_default().to_string();
    if v["is_error"].as_bool().unwrap_or(false) {
        return Err(if text.is_empty() { "Claude Code reported an error.".into() } else { text });
    }
    // A model answered instead of the CLI: this Claude Code is too old to report usage.
    if v["num_turns"].as_u64().unwrap_or(0) > 0 || !text.contains('%') {
        return Err("This version of Claude Code can't report usage. Update it with `claude update`.".into());
    }
    Ok(text)
}

/// The CLI takes one prompt per run, so earlier turns go into the system prompt.
pub fn system_with_transcript(system: &str, earlier: &[ChatMessage]) -> String {
    if earlier.is_empty() {
        return system.to_string();
    }
    let transcript: Vec<String> = earlier.iter().map(|m| format!("[{}]\n{}", m.role, m.content)).collect();
    format!(
        "{system}\n\nThe conversation so far (oldest first). Continue it naturally.\n<earlier_turns>\n{}\n</earlier_turns>",
        transcript.join("\n\n")
    )
}

#[derive(Default)]
pub struct StreamState {
    saw_delta: bool,
    pub finished: bool,
}

/// Translate one `stream-json` line into UI events.
pub fn parse_line(v: &Value, st: &mut StreamState) -> Vec<AiEvent> {
    match (v["type"].as_str().unwrap_or_default(), v["subtype"].as_str()) {
        ("system", Some("init")) => v["model"].as_str().map(|m| vec![AiEvent::Started { model: m.to_string() }]).unwrap_or_default(),
        ("stream_event", _) => {
            let e = &v["event"];
            if e["type"] == "content_block_delta" && e["delta"]["type"] == "text_delta" {
                st.saw_delta = true;
                vec![AiEvent::TextDelta { text: e["delta"]["text"].as_str().unwrap_or_default().to_string() }]
            } else {
                vec![]
            }
        }
        ("assistant", _) => {
            // Without partial messages (older CLIs) the text only arrives here.
            if std::mem::take(&mut st.saw_delta) {
                return vec![];
            }
            v["message"]["content"]
                .as_array()
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter(|b| b["type"] == "text")
                        .filter_map(|b| b["text"].as_str())
                        .map(|t| AiEvent::TextDelta { text: t.to_string() })
                        .collect()
                })
                .unwrap_or_default()
        }
        ("rate_limit_event", _) => {
            let i = &v["rate_limit_info"];
            vec![AiEvent::RateLimit {
                window: i["rateLimitType"].as_str().unwrap_or("unknown").to_string(),
                status: i["status"].as_str().unwrap_or("unknown").to_string(),
                resets_at: i["resetsAt"].as_i64(),
                utilization: i["utilization"].as_f64(),
            }]
        }
        ("result", _) => {
            st.finished = true;
            let u = &v["usage"];
            let input = u["input_tokens"].as_u64().unwrap_or(0)
                + u["cache_creation_input_tokens"].as_u64().unwrap_or(0)
                + u["cache_read_input_tokens"].as_u64().unwrap_or(0);
            let mut out = vec![AiEvent::Usage {
                input_tokens: input,
                output_tokens: u["output_tokens"].as_u64().unwrap_or(0),
                cost_usd: v["total_cost_usd"].as_f64(),
            }];
            if v["is_error"].as_bool().unwrap_or(false) {
                let text = v["result"].as_str().unwrap_or("Claude Code reported an error").to_string();
                let lower = text.to_lowercase();
                let kind = if ["authenticat", "log in", "login", "oauth", "not logged"].iter().any(|k| lower.contains(k)) {
                    "auth"
                } else if lower.contains("limit") {
                    "rate_limit"
                } else {
                    "provider"
                };
                out.push(AiEvent::error(kind, text));
            } else {
                out.push(AiEvent::Done { stop_reason: v["stop_reason"].as_str().unwrap_or("end_turn").to_string() });
            }
            out
        }
        _ => vec![],
    }
}

/// Per-turn scratch folder (empty cwd, prompt + MCP config files). Removed on drop.
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub async fn run(turn: &Turn, req: &TurnRequest) -> Result<(), AiEvent> {
    let cli = find_cli().ok_or_else(|| {
        AiEvent::error("unavailable", "Claude Code isn't installed on this computer. Install it from claude.com/code, then run `claude auth login`.")
    })?;
    if !valid_model(&req.model) {
        return Err(AiEvent::error("provider", format!("\"{}\" is not a Claude model name", req.model)));
    }
    let (earlier, last) = req.messages.split_at(req.messages.len() - 1);
    let scratch = Scratch(std::env::temp_dir().join("mnemoscript-ai").join(&turn.id));
    let cwd = scratch.0.join("cwd");
    std::fs::create_dir_all(&cwd).map_err(|e| AiEvent::error("provider", e.to_string()))?;
    let system_file = scratch.0.join("system.txt");
    std::fs::write(&system_file, system_with_transcript(&req.system, earlier)).map_err(|e| AiEvent::error("provider", e.to_string()))?;

    let mcp = super::mcp_http::register(turn, req.tools.clone()).map_err(|e| AiEvent::error("provider", e))?;
    let mcp_file = scratch.0.join("mcp.json");
    std::fs::write(&mcp_file, json!({ "mcpServers": { "mnemo": { "type": "http", "url": mcp.url } } }).to_string())
        .map_err(|e| AiEvent::error("provider", e.to_string()))?;

    let mut cmd = command(&cli);
    cmd.current_dir(&cwd)
        .args(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"])
        .args(["--tools", "", "--strict-mcp-config", "--mcp-config"])
        .arg(&mcp_file)
        .args(["--allowedTools", "mcp__mnemo", "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence"])
        .arg("--system-prompt-file")
        .arg(&system_file);
    if !req.model.is_empty() {
        cmd.args(["--model", &req.model]);
    }
    if let Some(effort) = &req.effort {
        cmd.args(["--effort", effort]);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AiEvent::error("unavailable", format!("Could not start Claude Code: {e}")))?;

    // The prompt goes through stdin: no command-line length limit, no quoting issues.
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(last[0].content.as_bytes()).await.map_err(|e| AiEvent::error("provider", e.to_string()))?;
    }
    let mut stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut s = String::new();
        if let Some(e) = stderr.as_mut() {
            let _ = e.take(64 * 1024).read_to_string(&mut s).await;
        }
        s
    });
    let mut lines = BufReader::new(child.stdout.take().expect("piped stdout")).lines();
    let mut st = StreamState::default();
    loop {
        let line = tokio::select! {
            l = lines.next_line() => l,
            _ = turn.cancelled() => {
                let _ = child.kill().await;
                return Err(AiEvent::error("cancelled", "Stopped"));
            }
        };
        match line {
            Ok(Some(line)) if !line.trim().is_empty() => {
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    for ev in parse_line(&v, &mut st) {
                        turn.emit(ev);
                    }
                }
            }
            Ok(Some(_)) => {}
            _ => break,
        }
    }
    let _ = child.wait().await;
    drop(mcp);
    if !st.finished {
        let err = stderr_task.await.unwrap_or_default();
        let tail: String = err.trim().chars().rev().take(400).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(AiEvent::error("provider", if tail.is_empty() { "Claude Code stopped unexpectedly".to_string() } else { tail }));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live: asks the installed, signed-in Claude Code for its usage report (free: no model call).
    /// `cargo test live_claude_code_usage -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_claude_code_usage() {
        let text = usage().await.expect("usage report");
        println!("{text}");
        assert!(text.contains("% used"));
    }

    #[test]
    fn usage_report_is_returned_only_when_the_cli_answered_it() {
        let ok = r#"{"type":"result","is_error":false,"num_turns":0,"result":"Current session: 50% used · resets Nov 12, 4pm","total_cost_usd":0}"#;
        assert!(parse_usage_result(ok).unwrap().starts_with("Current session: 50%"));
        let model = r#"{"type":"result","is_error":false,"num_turns":1,"result":"I'll read that file","total_cost_usd":0.02}"#;
        assert!(parse_usage_result(model).unwrap_err().contains("claude update"));
        let err = r#"{"type":"result","is_error":true,"num_turns":0,"result":"Not logged in"}"#;
        assert_eq!(parse_usage_result(err).unwrap_err(), "Not logged in");
        assert!(parse_usage_result("garbage").is_err());
    }

    #[test]
    fn stream_json_lines_become_ui_events() {
        let mut st = StreamState::default();
        let lines = [
            json!({"type":"system","subtype":"init","model":"claude-sonnet-5","tools":[]}),
            json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}}),
            json!({"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}}),
            json!({"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}),
            json!({"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1794441600,"rateLimitType":"five_hour"}}),
            json!({"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","total_cost_usd":0.01,
                   "usage":{"input_tokens":3,"cache_read_input_tokens":7,"output_tokens":5}}),
        ];
        let events: Vec<AiEvent> = lines.iter().flat_map(|l| parse_line(l, &mut st)).collect();
        assert_eq!(events, [
            AiEvent::Started { model: "claude-sonnet-5".into() },
            AiEvent::TextDelta { text: "Hel".into() },
            AiEvent::TextDelta { text: "lo".into() }, // the full assistant message is not repeated
            AiEvent::RateLimit { window: "five_hour".into(), status: "allowed".into(), resets_at: Some(1794441600), utilization: None },
            AiEvent::Usage { input_tokens: 10, output_tokens: 5, cost_usd: Some(0.01) },
            AiEvent::Done { stop_reason: "end_turn".into() },
        ]);
        assert!(st.finished);
    }

    #[test]
    fn assistant_text_is_used_when_no_partial_deltas_arrive() {
        let mut st = StreamState::default();
        let ev = parse_line(&json!({"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}), &mut st);
        assert_eq!(ev, [AiEvent::TextDelta { text: "Hi".into() }]);
    }

    #[test]
    fn not_signed_in_is_reported_as_an_auth_error() {
        let mut st = StreamState::default();
        let ev = parse_line(&json!({"type":"result","is_error":true,"result":"Failed to authenticate: OAuth session expired and could not be refreshed","usage":{}}), &mut st);
        assert!(matches!(&ev[1], AiEvent::Error { kind, .. } if kind == "auth"));
    }

    #[test]
    fn auth_status_and_transcript_formatting() {
        let s = parse_auth_status(r#"{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c","orgName":"Org","subscriptionType":"pro"}"#, Some("2.1.215".into()));
        assert!(s.installed && s.logged_in);
        assert_eq!(s.plan.as_deref(), Some("pro"));
        assert!(!parse_auth_status("", None).logged_in);
        let sys = system_with_transcript("S", &[ChatMessage { role: "user".into(), content: "q".into() }, ChatMessage { role: "assistant".into(), content: "a".into() }]);
        assert!(sys.starts_with("S\n\n") && sys.contains("[user]\nq\n\n[assistant]\na"));
        assert_eq!(system_with_transcript("S", &[]), "S");
    }

    /// Live end-to-end check against the writer's real Claude Code sign-in (costs a little usage,
    /// so it is ignored by default): `cargo test live_claude_code -- --ignored --nocapture`.
    /// Proves the in-app MCP endpoint, the tool round trip, and switching models in one subscription.
    #[tokio::test]
    #[ignore]
    async fn live_claude_code_round_trip_and_model_switch() {
        use crate::ai::engine::{resolve_tool, Sink, Turn};
        use crate::ai::types::{ToolOutcome, ToolSpec};
        use std::sync::{Arc, Mutex};

        for alias in ["haiku", "sonnet"] {
            let events = Arc::new(Mutex::new(Vec::<AiEvent>::new()));
            let turn_id = format!("live-{alias}-{}", uuid::Uuid::new_v4());
            let (ev2, tid) = (events.clone(), turn_id.clone());
            let sink: Sink = Arc::new(move |e: AiEvent| {
                if let AiEvent::ToolCall { call_id, .. } = &e {
                    let (tid, call_id) = (tid.clone(), call_id.clone());
                    // Answer like the frontend would, from another thread.
                    std::thread::spawn(move || {
                        let docs = r#"[{"id":"ch3","title":"Chapter 3 - The Ember Crown","docType":"text"}]"#;
                        resolve_tool(&tid, &call_id, ToolOutcome { content: docs.into(), is_error: false }).unwrap();
                    });
                }
                ev2.lock().unwrap().push(e);
            });
            let turn = Turn::register(&turn_id, sink).unwrap();
            let req: TurnRequest = serde_json::from_value(json!({
                "turnId": turn_id, "provider": "claude-code", "model": alias,
                "system": "You are the writing assistant in MnemoScript. Use the tools to see the project.",
                "messages": [{"role":"user","content":"Call list_documents, then tell me the title of the only document."}],
                "tools": [serde_json::to_value(ToolSpec { name: "list_documents".into(), description: "List the project's documents".into(), input_schema: json!({"type":"object","properties":{}}) }).unwrap()],
            }))
            .unwrap();
            let result = run(&turn, &req).await;
            turn.finish();
            let events = events.lock().unwrap().clone();
            println!("--- {alias}: {result:?}");
            for e in &events {
                if !matches!(e, AiEvent::TextDelta { .. }) {
                    println!("{e:?}");
                }
            }
            let text: String = events.iter().filter_map(|e| if let AiEvent::TextDelta { text } = e { Some(text.as_str()) } else { None }).collect();
            println!("reply: {text}");
            assert!(result.is_ok());
            let model = events.iter().find_map(|e| if let AiEvent::Started { model } = e { Some(model.clone()) } else { None }).unwrap();
            assert!(model.contains(alias), "{alias} resolved to {model}");
            assert!(events.iter().any(|e| matches!(e, AiEvent::ToolCall { name, .. } if name == "list_documents")));
            assert!(text.contains("Ember Crown"));
            assert!(matches!(events.last(), Some(AiEvent::Done { .. })));
        }
    }

    #[test]
    fn model_names_are_aliases_or_claude_ids() {
        for ok in ["", "opus", "sonnet", "haiku", "fable", "claude-opus-5-5", "claude-sonnet-5[1m]"] {
            assert!(valid_model(ok), "{ok}");
        }
        for bad in ["gpt-5", "--dangerously-skip-permissions", "opus; rm", "claude-x y"] {
            assert!(!valid_model(bad), "{bad}");
        }
    }

    #[test]
    fn the_cli_gets_a_clean_environment() {
        std::env::set_var("CLAUDE_CODE_SIMPLE", "1");
        assert!(clean_env().iter().all(|(k, _)| !k.starts_with("CLAUDE")));
    }
}
