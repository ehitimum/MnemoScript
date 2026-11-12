//! In-app MCP endpoint for agent CLIs (Claude Code today; Gemini CLI / Codex later).
//!
//! The CLI is started with *no* built-in tools and pointed at
//! `http://127.0.0.1:<port>/mcp/<per-turn token>`. Each `tools/call` is forwarded to the running
//! turn, which asks the frontend to execute it, so CLI and API-key providers share one tool path.
//! Bound to loopback only; a random token per turn means another local process can't guess a
//! live endpoint, and it stops working the moment the turn ends.
use super::engine::Turn;
use super::types::{ToolOutcome, ToolSpec};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Mutex, OnceLock};

struct Endpoint {
    turn: Turn,
    tools: Vec<ToolSpec>,
    rt: tokio::runtime::Handle,
}

fn endpoints() -> &'static Mutex<HashMap<String, Endpoint>> {
    static E: OnceLock<Mutex<HashMap<String, Endpoint>>> = OnceLock::new();
    E.get_or_init(|| Mutex::new(HashMap::new()))
}

fn port() -> Result<u16, String> {
    static PORT: OnceLock<Result<u16, String>> = OnceLock::new();
    PORT.get_or_init(|| {
        let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| format!("Could not start the local tool server: {e}"))?;
        let port = server.server_addr().to_ip().map(|a| a.port()).ok_or("No local port")?;
        std::thread::Builder::new()
            .name("mnemo-mcp".into())
            .spawn(move || {
                for request in server.incoming_requests() {
                    // A tool call can wait on the UI; never block the accept loop.
                    std::thread::spawn(move || handle_http(request));
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(port)
    })
    .clone()
}

/// Removes the endpoint when the turn ends (dropped).
pub struct Registration {
    token: String,
    pub url: String,
}

impl Drop for Registration {
    fn drop(&mut self) {
        endpoints().lock().unwrap_or_else(|p| p.into_inner()).remove(&self.token);
    }
}

/// Expose `tools` for this turn. Must be called from inside the async runtime.
pub fn register(turn: &Turn, tools: Vec<ToolSpec>) -> Result<Registration, String> {
    let port = port()?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    endpoints().lock().unwrap_or_else(|p| p.into_inner()).insert(
        token.clone(),
        Endpoint { turn: turn.clone(), tools, rt: tokio::runtime::Handle::current() },
    );
    Ok(Registration { url: format!("http://127.0.0.1:{port}/mcp/{token}"), token })
}

fn handle_http(mut request: tiny_http::Request) {
    let token = request.url().strip_prefix("/mcp/").map(|t| t.split(['?', '/']).next().unwrap_or("").to_string());
    let respond = |req: tiny_http::Request, code: u16, body: String| {
        let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).expect("static header");
        let _ = req.respond(tiny_http::Response::from_string(body).with_status_code(code).with_header(header));
    };
    if *request.method() != tiny_http::Method::Post {
        // Streamable HTTP: we offer no server-initiated SSE stream.
        return respond(request, 405, String::new());
    }
    let Some(token) = token else { return respond(request, 404, String::new()) };
    let (turn, tools, rt) = {
        let map = endpoints().lock().unwrap_or_else(|p| p.into_inner());
        match map.get(&token) {
            Some(e) => (e.turn.clone(), e.tools.clone(), e.rt.clone()),
            None => {
                drop(map);
                return respond(request, 404, String::new());
            }
        }
    };
    let mut body = String::new();
    if request.as_reader().take(8 * 1024 * 1024).read_to_string(&mut body).is_err() {
        return respond(request, 400, String::new());
    }
    let Ok(msg) = serde_json::from_str::<Value>(&body) else {
        return respond(request, 400, json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}).to_string());
    };
    let call = |name: &str, args: Value| rt.block_on(turn.call_tool(name, args));
    let reply = match &msg {
        Value::Array(batch) => {
            let out: Vec<Value> = batch.iter().filter_map(|m| handle_rpc(m, &tools, &call)).collect();
            if out.is_empty() { None } else { Some(Value::Array(out)) }
        }
        single => handle_rpc(single, &tools, &call),
    };
    match reply {
        Some(v) => respond(request, 200, v.to_string()),
        None => respond(request, 202, String::new()),
    }
}

/// JSON-RPC handling for one MCP message. `None` for notifications (no reply).
pub fn handle_rpc(msg: &Value, tools: &[ToolSpec], call: &dyn Fn(&str, Value) -> ToolOutcome) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg["method"].as_str().unwrap_or_default();
    let ok = |result: Value| Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    match method {
        "initialize" => ok(json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "mnemoscript", "version": env!("CARGO_PKG_VERSION") },
        })),
        "ping" => ok(json!({})),
        "tools/list" => ok(json!({
            "tools": tools.iter().map(|t| json!({ "name": t.name, "description": t.description, "inputSchema": t.input_schema })).collect::<Vec<_>>()
        })),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or_default();
            // Only tools offered for this turn (e.g. no write tools in plan mode) can run.
            let outcome = if tools.iter().any(|t| t.name == name) {
                call(name, msg["params"].get("arguments").cloned().unwrap_or_else(|| json!({})))
            } else {
                ToolOutcome::err(format!("Tool {name} is not available in this session."))
            };
            ok(json!({ "content": [{ "type": "text", "text": outcome.content }], "isError": outcome.is_error }))
        }
        _ => Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("Unknown method {method}") } })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools() -> Vec<ToolSpec> {
        vec![ToolSpec { name: "list_documents".into(), description: "List".into(), input_schema: json!({"type":"object"}) }]
    }

    #[test]
    fn answers_the_mcp_handshake_and_lists_only_offered_tools() {
        let never = |_: &str, _: Value| -> ToolOutcome { panic!("not called") };
        let init = handle_rpc(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}), &tools(), &never).unwrap();
        assert_eq!(init["result"]["capabilities"], json!({"tools":{}}));
        assert!(handle_rpc(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}), &tools(), &never).is_none());
        let list = handle_rpc(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}), &tools(), &never).unwrap();
        assert_eq!(list["result"]["tools"][0]["name"], "list_documents");
        assert!(list["result"]["tools"][0].get("inputSchema").is_some());
    }

    #[test]
    fn tool_calls_are_forwarded_and_unknown_tools_refused() {
        let call = |name: &str, args: Value| ToolOutcome { content: format!("{name}:{args}"), is_error: false };
        let r = handle_rpc(&json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_documents","arguments":{"a":1}}}), &tools(), &call).unwrap();
        assert_eq!(r["result"]["content"][0]["text"], "list_documents:{\"a\":1}");
        assert_eq!(r["result"]["isError"], false);
        let denied = handle_rpc(&json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"edit_text"}}), &tools(), &call).unwrap();
        assert_eq!(denied["result"]["isError"], true);
    }
}
