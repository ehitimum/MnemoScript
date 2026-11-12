//! OpenAI Codex CLI bridge: the writer's ChatGPT plan through their own signed-in `codex`.
//!
//! Same idea as `claude_code`: MnemoScript never touches the sign-in; it runs `codex exec` per
//! message, locked down, and Codex reaches the project only through MnemoScript's MCP tools:
//! * every built-in tool family is switched off (shell, code mode, browser, computer use, apps,
//!   plugins, images, multi-agent, web search) and the sandbox is read-only;
//! * the user's own Codex config, rules and history are ignored (`--ignore-user-config`,
//!   `--ignore-rules`, `--ephemeral`), and it runs in an empty folder with a clean environment;
//! * the prompt goes through stdin (no command-line length limit).
use super::claude_code::{command, system_with_transcript, Scratch};
use super::engine::Turn;
use super::types::{AiEvent, TurnRequest};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

/// Built-in Codex features that would give the model access beyond MnemoScript's tools.
const DISABLED_FEATURES: &[&str] = &[
    "shell_tool", "unified_exec", "multi_agent", "apps", "browser_use",
    "browser_use_external", "computer_use", "in_app_browser", "image_generation", "view_image",
    "plugins", "remote_plugin", "hooks", "skill_search", "tool_suggest", "sleep_tool",
];

/// How to start Codex: a native `codex.exe`, or Node + the npm package's script (the npm shim
/// `codex.cmd` would route every argument through cmd.exe quoting).
pub struct CodexCli {
    program: PathBuf,
    prefix: Vec<String>,
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default()
}

pub fn find_cli() -> Option<CodexCli> {
    let dirs = path_dirs();
    let native = if cfg!(windows) { "codex.exe" } else { "codex" };
    if let Some(p) = dirs.iter().map(|d| d.join(native)).find(|p| p.is_file()) {
        return Some(CodexCli { program: p, prefix: vec![] });
    }
    // npm global install: <prefix>/codex.cmd + <prefix>/node_modules/@openai/codex/bin/codex.js
    let mut npm_dirs = dirs.clone();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        npm_dirs.push(PathBuf::from(appdata).join("npm"));
    }
    let script = npm_dirs.iter().map(|d| d.join("node_modules").join("@openai").join("codex").join("bin").join("codex.js")).find(|p| p.is_file())?;
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let node = dirs.iter().map(|d| d.join(node_name)).find(|p| p.is_file())?;
    Some(CodexCli { program: node, prefix: vec![script.to_string_lossy().to_string()] })
}

fn cmd(cli: &CodexCli) -> tokio::process::Command {
    let mut c = command(&cli.program);
    c.args(&cli.prefix);
    c
}

/// Installed? Signed in (and how)? `codex login status` prints to stderr.
pub async fn status() -> super::claude_code::CliStatus {
    let Some(cli) = find_cli() else { return Default::default() };
    let run = |args: &'static [&'static str]| {
        let mut c = cmd(&cli);
        c.args(args).stdin(Stdio::null());
        async move {
            let out = tokio::time::timeout(std::time::Duration::from_secs(20), c.output()).await.ok()?.ok()?;
            Some(format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
        }
    };
    let version = run(&["--version"]).await.map(|s| s.trim().trim_start_matches("codex-cli").trim().to_string()).filter(|s| !s.is_empty());
    let login = run(&["login", "status"]).await.unwrap_or_default();
    parse_login(&login, version)
}

pub fn parse_login(text: &str, version: Option<String>) -> super::claude_code::CliStatus {
    let logged_in = text.contains("Logged in");
    let method = if text.contains("ChatGPT") {
        Some("chatgpt".to_string())
    } else if text.to_ascii_lowercase().contains("api key") {
        Some("apiKey".to_string())
    } else {
        None
    };
    super::claude_code::CliStatus { installed: true, version, logged_in, auth_method: method, ..Default::default() }
}

/// Model id or custom name: letters, digits, `.-_` only (it ends up in a `-m` argument).
pub fn valid_model(m: &str) -> bool {
    m.len() <= 64 && m.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

fn classify(message: &str) -> &'static str {
    let m = message.to_ascii_lowercase();
    if m.contains("log in") || m.contains("login") || m.contains("unauthorized") || m.contains("401") {
        "auth"
    } else if m.contains("usage limit") || m.contains("rate limit") || m.contains("429") {
        "rate_limit"
    } else {
        "provider"
    }
}

#[derive(Default)]
pub struct StreamState {
    wrote_text: bool,
    pub finished: bool,
    last_error: Option<String>,
}

/// Translate one `codex exec --json` line into UI events.
pub fn parse_line(v: &Value, model: &str, st: &mut StreamState) -> Vec<AiEvent> {
    match v["type"].as_str().unwrap_or_default() {
        "turn.started" => vec![AiEvent::Started { model: if model.is_empty() { "codex".into() } else { model.to_string() } }],
        "item.completed" if v["item"]["type"] == "agent_message" => {
            let text = v["item"]["text"].as_str().unwrap_or_default();
            if text.is_empty() {
                return vec![];
            }
            let sep = if st.wrote_text { "\n\n" } else { "" };
            st.wrote_text = true;
            vec![AiEvent::TextDelta { text: format!("{sep}{text}") }]
        }
        "turn.completed" => {
            st.finished = true;
            let u = &v["usage"];
            let n = |k: &str| u[k].as_u64().unwrap_or(0);
            vec![
                AiEvent::Usage { input_tokens: n("input_tokens"), output_tokens: n("output_tokens") + n("reasoning_output_tokens"), cost_usd: None },
                AiEvent::Done { stop_reason: "end_turn".into() },
            ]
        }
        "error" => {
            st.last_error = v["message"].as_str().map(str::to_string);
            vec![]
        }
        "turn.failed" => {
            st.finished = true;
            let msg = v["error"]["message"].as_str().map(str::to_string).or(st.last_error.clone()).unwrap_or_else(|| "Codex stopped with an error".into());
            vec![AiEvent::error(classify(&msg), msg)]
        }
        _ => vec![],
    }
}

pub async fn run(turn: &Turn, req: &TurnRequest) -> Result<(), AiEvent> {
    let cli = find_cli().ok_or_else(|| {
        AiEvent::error("unavailable", "Codex isn't installed on this computer. Install it (npm install -g @openai/codex), then run `codex login`.")
    })?;
    if !valid_model(&req.model) {
        return Err(AiEvent::error("provider", format!("\"{}\" is not a valid model name", req.model)));
    }
    let (earlier, last) = req.messages.split_at(req.messages.len() - 1);
    let scratch = Scratch(std::env::temp_dir().join("mnemoscript-ai").join(&turn.id));
    let cwd = scratch.0.join("cwd");
    std::fs::create_dir_all(&cwd).map_err(|e| AiEvent::error("provider", e.to_string()))?;
    let mcp = super::mcp_http::register(turn, req.tools.clone()).map_err(|e| AiEvent::error("provider", e))?;

    let mut c = cmd(&cli);
    c.current_dir(&cwd)
        .args(["exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check"])
        .args(["-s", "read-only", "-C"])
        .arg(&cwd)
        .args(["-c", "web_search=\"disabled\""])
        .args(["-c", &format!("mcp_servers.mnemo.url=\"{}\"", mcp.url)])
        // Ask mode waits for the writer's Apply / Reject.
        .args(["-c", "mcp_servers.mnemo.tool_timeout_sec=86400"])
        // Exec mode can't ask for approval; MnemoScript's own tools are pre-approved (its modes
        // and the Apply/Reject cards decide what actually changes).
        .args(["-c", "mcp_servers.mnemo.default_tools_approval_mode=\"approve\""]);
    for f in DISABLED_FEATURES {
        c.args(["--disable", f]);
    }
    if !req.model.is_empty() {
        c.args(["-m", &req.model]);
    }
    if let Some(effort) = &req.effort {
        if matches!(effort.as_str(), "minimal" | "low" | "medium" | "high") {
            c.args(["-c", &format!("model_reasoning_effort=\"{effort}\"")]);
        }
    }
    c.arg("-"); // read the prompt from stdin
    let mut child = c
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AiEvent::error("unavailable", format!("Could not start Codex: {e}")))?;

    // Codex has no system-prompt flag: the instructions and earlier turns lead the prompt.
    let prompt = format!("{}\n\n<writer_message>\n{}\n</writer_message>", system_with_transcript(&req.system, earlier), last[0].content);
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).await.map_err(|e| AiEvent::error("provider", e.to_string()))?;
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
                    for ev in parse_line(&v, &req.model, &mut st) {
                        if let AiEvent::Error { .. } = ev {
                            let _ = child.kill().await;
                            return Err(ev);
                        }
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
        let msg = st.last_error.unwrap_or(if tail.is_empty() { "Codex stopped unexpectedly".to_string() } else { tail });
        return Err(AiEvent::error(classify(&msg), msg));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use super::*;

    #[test]
    fn codex_json_lines_become_ui_events() {
        let mut st = StreamState::default();
        let lines = [
            json!({"type":"thread.started","thread_id":"t"}),
            json!({"type":"turn.started"}),
            json!({"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"Hello"}}),
            json!({"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Again"}}),
            json!({"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3,"reasoning_output_tokens":2}}),
        ];
        let evs: Vec<AiEvent> = lines.iter().flat_map(|l| parse_line(l, "", &mut st)).collect();
        assert_eq!(
            evs,
            vec![
                AiEvent::Started { model: "codex".into() },
                AiEvent::TextDelta { text: "Hello".into() },
                AiEvent::TextDelta { text: "\n\nAgain".into() },
                AiEvent::Usage { input_tokens: 10, output_tokens: 5, cost_usd: None },
                AiEvent::Done { stop_reason: "end_turn".into() },
            ]
        );
        assert!(st.finished);

        let mut st = StreamState::default();
        let failed = json!({"type":"turn.failed","error":{"message":"You've hit your usage limit."}});
        assert_eq!(parse_line(&failed, "", &mut st), vec![AiEvent::error("rate_limit", "You've hit your usage limit.")]);
        assert!(parse_login("Logged in using ChatGPT", None).logged_in);
        assert_eq!(parse_login("Logged in using ChatGPT", None).auth_method.as_deref(), Some("chatgpt"));
        assert!(!parse_login("Not logged in", None).logged_in);
        assert!(!valid_model("gpt-5\"; rm"));
    }

    /// Live: a real Codex turn (uses a little of the ChatGPT plan) that must call MnemoScript's tool.
    /// `cargo test live_codex -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_codex_round_trip() {
        use crate::ai::engine::{resolve_tool, Sink};
        use crate::ai::types::{ToolOutcome, ToolSpec};
        use std::sync::{Arc, Mutex};
        let events = Arc::new(Mutex::new(Vec::<AiEvent>::new()));
        let turn_id = format!("live-codex-{}", uuid::Uuid::new_v4());
        let (ev2, tid) = (events.clone(), turn_id.clone());
        let sink: Sink = Arc::new(move |e: AiEvent| {
            if let AiEvent::ToolCall { call_id, .. } = &e {
                let (tid, call_id) = (tid.clone(), call_id.clone());
                std::thread::spawn(move || {
                    let docs = r#"[{"id":"ch3","title":"Chapter 3 - The Ember Crown","docType":"text"}]"#;
                    resolve_tool(&tid, &call_id, ToolOutcome { content: docs.into(), is_error: false }).unwrap();
                });
            }
            ev2.lock().unwrap().push(e);
        });
        let turn = Turn::register(&turn_id, sink).unwrap();
        let req: TurnRequest = serde_json::from_value(json!({
            "turnId": turn_id, "provider": "codex", "model": "",
            "system": "You are the writing assistant in MnemoScript. Use the tools to see the project.",
            "messages": [{"role":"user","content":"Call list_documents, then tell me the title of the only document."}],
            "tools": [serde_json::to_value(ToolSpec { name: "list_documents".into(), description: "List the project's documents".into(), input_schema: json!({"type":"object","properties":{}}) }).unwrap()],
        }))
        .unwrap();
        let result = run(&turn, &req).await;
        turn.finish();
        let events = events.lock().unwrap().clone();
        for e in &events {
            println!("{e:?}");
        }
        assert!(result.is_ok(), "{result:?}");
        assert!(events.iter().any(|e| matches!(e, AiEvent::ToolCall { name, .. } if name == "list_documents")));
        let text: String = events.iter().filter_map(|e| if let AiEvent::TextDelta { text } = e { Some(text.as_str()) } else { None }).collect();
        assert!(text.contains("Ember Crown"), "{text}");
    }
}
