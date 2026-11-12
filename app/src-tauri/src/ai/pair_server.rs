//! PC side of phone pairing: lets a paired phone use this PC's Claude Code over the home network.
//!
//! * Off until the writer turns on Settings → AI → Phone pairing (persisted; restarts with the app).
//! * Listens on the LAN (TCP, default port 47815) and answers UDP discovery probes on 47815.
//! * "Pair a phone" opens a 5-minute window with an 8-digit code (SPAKE2, at most 5 tries).
//! * Every other request is sealed with the phone's own device key (`pair_crypto`); unknown
//!   devices, stale timestamps and replayed request ids are refused.
//! * A phone can only run Claude Code turns; tool calls go back to the phone (its documents),
//!   exactly like the desktop UI's own turns. Removing a device revokes it at once.
//!
//! The HTTP here is deliberately minimal (we write both ends): one request per connection,
//! `Content-Length` bodies, and streamed replies delimited by closing the connection, with every
//! line flushed as it is produced.
use super::engine::{self, Turn};
use super::pair_crypto::*;
use super::types::{AiEvent, ToolOutcome, TurnRequest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

const WINDOW: Duration = Duration::from_secs(5 * 60);
const MAX_TRIES: u32 = 5;
const MAX_HEADER: usize = 16 * 1024;
const MAX_BODY: usize = 16 * 1024 * 1024;
const KEEPALIVE: Duration = Duration::from_secs(20);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    /// base64 device key. Stored in the app's data folder, like the projects themselves.
    pub key: String,
    pub created_at: String,
    #[serde(default)]
    pub last_seen: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Stored {
    enabled: bool,
    port: Option<u16>,
    server_id: String,
    devices: Vec<Device>,
}

struct PairWindow {
    code: String,
    until: Instant,
    expires_at_ms: i64,
    tries: u32,
}

/// What the server needs from the rest of the app (swapped for fakes in tests).
#[derive(Clone)]
pub struct Hooks {
    pub run_turn: Arc<dyn Fn(Turn, TurnRequest) + Send + Sync>,
    pub cli_status: Arc<dyn Fn() -> Value + Send + Sync>,
    pub usage: Arc<dyn Fn() -> Result<String, String> + Send + Sync>,
}

pub struct Server {
    path: PathBuf,
    stored: Mutex<Stored>,
    pending: Mutex<HashMap<String, Device>>,
    window: Mutex<Option<PairWindow>>,
    seen: Mutex<HashMap<String, i64>>,
    listening: Mutex<Option<(u16, Arc<AtomicBool>)>>,
    last_error: Mutex<Option<String>>,
    hooks: Hooks,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

pub fn pc_name() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "This PC".into())
}

/// The address the phone should use: the interface that would carry traffic to the internet.
/// (Connecting a UDP socket sends nothing; it only picks the route.)
pub fn local_ip() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    let ip = s.local_addr().ok()?.ip();
    (!ip.is_loopback()).then(|| ip.to_string())
}

impl Server {
    pub fn new(path: PathBuf, hooks: Hooks) -> Arc<Server> {
        let mut stored: Stored = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        if stored.server_id.is_empty() {
            stored.server_id = random_id();
        }
        Arc::new(Server {
            path,
            stored: Mutex::new(stored),
            pending: Mutex::new(HashMap::new()),
            window: Mutex::new(None),
            seen: Mutex::new(HashMap::new()),
            listening: Mutex::new(None),
            last_error: Mutex::new(None),
            hooks,
        })
    }

    fn save(&self) {
        let text = serde_json::to_string_pretty(&*lock(&self.stored)).unwrap_or_default();
        if let Err(e) = crate::project::write_atomic(&self.path, &text) {
            log::warn!("Could not save pairing settings: {e}");
        }
    }

    pub fn is_enabled(&self) -> bool {
        lock(&self.stored).enabled
    }

    /// Start listening on `ip` (0.0.0.0 in the app). `discovery_port` answers UDP probes.
    pub fn start(self: &Arc<Self>, ip: &str, discovery_port: Option<u16>) -> Result<u16, String> {
        if let Some((port, _)) = &*lock(&self.listening) {
            return Ok(*port);
        }
        let preferred = lock(&self.stored).port.unwrap_or(DEFAULT_PORT);
        let listener = TcpListener::bind((ip, preferred))
            .or_else(|_| TcpListener::bind((ip, 0)))
            .map_err(|e| format!("Could not open a network port for phone pairing: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        if lock(&self.stored).port != Some(port) {
            lock(&self.stored).port = Some(port);
            self.save();
        }
        let stop = Arc::new(AtomicBool::new(false));
        let (me, flag) = (self.clone(), stop.clone());
        std::thread::Builder::new()
            .name("mnemo-pair".into())
            .spawn(move || {
                while !flag.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((stream, _)) => {
                            let me = me.clone();
                            std::thread::spawn(move || me.handle(stream));
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(120)),
                        Err(_) => std::thread::sleep(Duration::from_millis(250)),
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        if let Some(dport) = discovery_port {
            match UdpSocket::bind((ip, dport)) {
                Ok(sock) => {
                    let (me, flag) = (self.clone(), stop.clone());
                    let _ = sock.set_read_timeout(Some(Duration::from_millis(400)));
                    std::thread::spawn(move || me.answer_probes(sock, port, flag));
                }
                // The phone can still connect with the address typed in.
                Err(e) => log::warn!("Phone discovery unavailable: {e}"),
            }
        }
        *lock(&self.listening) = Some((port, stop));
        *lock(&self.last_error) = None;
        Ok(port)
    }

    pub fn stop(&self) {
        if let Some((_, stop)) = lock(&self.listening).take() {
            stop.store(true, Ordering::Relaxed);
        }
        *lock(&self.window) = None;
        lock(&self.pending).clear();
    }

    pub fn set_enabled(self: &Arc<Self>, enabled: bool) -> Result<(), String> {
        lock(&self.stored).enabled = enabled;
        self.save();
        if enabled {
            self.start("0.0.0.0", Some(DEFAULT_PORT)).map(|_| ()).inspect_err(|e| *lock(&self.last_error) = Some(e.clone()))
        } else {
            self.stop();
            Ok(())
        }
    }

    /// Open the pairing window: returns the code to show and when it expires (epoch ms).
    pub fn open_window(&self) -> (String, i64) {
        let code = pairing_code();
        let expires_at_ms = now_ms() + WINDOW.as_millis() as i64;
        *lock(&self.window) = Some(PairWindow { code: code.clone(), until: Instant::now() + WINDOW, expires_at_ms, tries: 0 });
        lock(&self.pending).clear();
        (code, expires_at_ms)
    }

    pub fn close_window(&self) {
        *lock(&self.window) = None;
        lock(&self.pending).clear();
    }

    pub fn remove_device(&self, id: &str) {
        lock(&self.stored).devices.retain(|d| d.id != id);
        self.save();
    }

    /// Everything Settings → AI → Phone pairing shows (never the keys).
    pub fn state(&self) -> Value {
        let stored = lock(&self.stored);
        let listening = lock(&self.listening).as_ref().map(|(p, _)| *p);
        let window = lock(&self.window)
            .as_ref()
            .filter(|w| w.until > Instant::now() && w.tries < MAX_TRIES)
            .map(|w| json!({ "code": w.code, "expiresAt": w.expires_at_ms }));
        let devices: Vec<Value> = stored
            .devices
            .iter()
            .map(|d| json!({ "id": d.id, "name": d.name, "createdAt": d.created_at, "lastSeen": d.last_seen }))
            .collect();
        json!({
            "enabled": stored.enabled,
            "listening": listening.is_some(),
            "port": listening.or(stored.port),
            "address": local_ip(),
            "pcName": pc_name(),
            "devices": devices,
            "window": window,
            "error": *lock(&self.last_error),
        })
    }

    fn answer_probes(&self, sock: UdpSocket, port: u16, stop: Arc<AtomicBool>) {
        let mut buf = [0u8; 256];
        while !stop.load(Ordering::Relaxed) {
            let Ok((n, from)) = sock.recv_from(&mut buf) else { continue };
            if &buf[..n] != DISCOVER_PROBE {
                continue;
            }
            let reply = json!({ "app": "MnemoScript", "protocol": PROTOCOL, "name": pc_name(), "port": port, "id": lock(&self.stored).server_id });
            let _ = sock.send_to(reply.to_string().as_bytes(), from);
        }
    }

    // ── HTTP ────────────────────────────────────────────────────────────────

    fn handle(self: Arc<Self>, mut stream: TcpStream) {
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
        let req = match read_request(&mut stream) {
            Ok(r) => r,
            Err(e) => return respond(&mut stream, 400, &e),
        };
        if req.method != "POST" {
            return respond(&mut stream, 405, "");
        }
        if req.path == "/v1/pair" {
            return self.pair(&mut stream, &req.body);
        }
        if !req.path.starts_with("/v1/") {
            return respond(&mut stream, 404, "");
        }
        self.authed(stream, &req)
    }

    fn pair(&self, stream: &mut TcpStream, body: &[u8]) {
        #[derive(Deserialize)]
        struct PairReq {
            name: String,
            msg: String,
        }
        let Ok(p) = serde_json::from_slice::<PairReq>(body) else { return respond(stream, 400, "Bad pairing request") };
        let code = {
            let mut w = lock(&self.window);
            let Some(win) = w.as_mut().filter(|w| w.until > Instant::now()) else {
                return respond(stream, 403, "Pairing isn't open on the PC. Choose “Pair a phone” there first.");
            };
            if win.tries >= MAX_TRIES {
                *w = None;
                return respond(stream, 403, "Too many tries. Start pairing again on the PC.");
            }
            win.tries += 1;
            win.code.clone()
        };
        let Ok(inbound) = unb64(&p.msg) else { return respond(stream, 400, "Bad pairing request") };
        let (state, outbound) = spake_start(&code);
        let Ok(shared) = spake_finish(state, &inbound) else { return respond(stream, 400, "Bad pairing request") };
        let name: String = p.name.chars().filter(|c| !c.is_control()).take(60).collect();
        let device = Device {
            id: random_id(),
            name: if name.trim().is_empty() { "Phone".into() } else { name.trim().to_string() },
            key: b64(&random_key()),
            created_at: chrono::Utc::now().to_rfc3339(),
            last_seen: None,
        };
        let grant = json!({
            "deviceId": device.id,
            "deviceKey": device.key,
            "pcName": pc_name(),
            "serverId": lock(&self.stored).server_id,
        });
        // A wrong code gives the phone a different key, so it can't open the grant; the device
        // only becomes real when the phone proves it holds the key (`/v1/hello`).
        lock(&self.pending).insert(device.id.clone(), device);
        let sealed = Sealer::new(&shared).seal(PAIR_AAD, grant.to_string().as_bytes());
        respond(stream, 200, &json!({ "msg": b64(&outbound), "grant": sealed }).to_string());
    }

    fn authed(self: Arc<Self>, mut stream: TcpStream, req: &Request) {
        let device_id = req.headers.get("x-mnemo-device").cloned().unwrap_or_default();
        let (device, pending) = {
            let confirmed = lock(&self.stored).devices.iter().find(|d| d.id == device_id).cloned();
            match confirmed {
                Some(d) => (d, false),
                None => match lock(&self.pending).get(&device_id).cloned() {
                    Some(d) if req.path == "/v1/hello" => (d, true),
                    _ => return respond(&mut stream, 401, "This phone isn't paired with this PC."),
                },
            }
        };
        let Ok(key) = unb64(&device.key).and_then(|k| <[u8; 32]>::try_from(k.as_slice()).map_err(|_| "bad key".to_string())) else {
            return respond(&mut stream, 401, "This phone isn't paired with this PC.");
        };
        let sealer = Sealer::new(&key);
        let text = String::from_utf8_lossy(&req.body).to_string();
        let Ok(plain) = sealer.open(&request_aad(&req.path, &device_id), &text) else {
            return respond(&mut stream, 401, "This phone isn't paired with this PC.");
        };
        let Ok(env) = serde_json::from_slice::<Envelope<Value>>(&plain) else { return respond(&mut stream, 400, "Bad request") };
        if let Err(e) = self.fresh(&env) {
            return respond(&mut stream, 409, &e);
        }

        if pending {
            // The phone opened the grant: the code was right. Keep the device, close pairing.
            let mut confirmed = device.clone();
            confirmed.last_seen = Some(chrono::Utc::now().to_rfc3339());
            lock(&self.pending).clear();
            *lock(&self.window) = None;
            lock(&self.stored).devices.push(confirmed);
            self.save();
        } else {
            self.touch(&device_id);
        }

        let reply = |stream: &mut TcpStream, v: Value| {
            respond(stream, 200, &sealer.seal(&response_aad(&env.rid, 0), v.to_string().as_bytes()));
        };
        let remote_turn = |client_turn: &str| format!("remote-{device_id}-{client_turn}");
        match req.path.as_str() {
            "/v1/hello" => reply(&mut stream, json!({ "pcName": pc_name(), "serverId": lock(&self.stored).server_id, "cli": (self.hooks.cli_status)() })),
            "/v1/usage" => reply(
                &mut stream,
                match (self.hooks.usage)() {
                    Ok(text) => json!({ "text": text }),
                    Err(e) => json!({ "error": e }),
                },
            ),
            "/v1/tool" => {
                let b = &env.body;
                let turn = remote_turn(b["turnId"].as_str().unwrap_or_default());
                let outcome = ToolOutcome { content: b["content"].as_str().unwrap_or_default().to_string(), is_error: b["isError"].as_bool().unwrap_or(false) };
                let r = engine::resolve_tool(&turn, b["callId"].as_str().unwrap_or_default(), outcome);
                reply(&mut stream, json!({ "ok": r.is_ok() }));
            }
            "/v1/cancel" => {
                let ok = engine::cancel(&remote_turn(env.body["turnId"].as_str().unwrap_or_default()));
                reply(&mut stream, json!({ "ok": ok }));
            }
            "/v1/turn" => self.stream_turn(stream, sealer, &env, &remote_turn),
            _ => respond(&mut stream, 404, ""),
        }
    }

    /// Refuse stale or repeated requests.
    fn fresh(&self, env: &Envelope<Value>) -> Result<(), String> {
        let now = now_ms();
        if (now - env.ts).abs() > MAX_SKEW_MS {
            return Err("The phone's clock and the PC's clock disagree. Check the date and time on both.".into());
        }
        let mut seen = lock(&self.seen);
        seen.retain(|_, ts| now - *ts < 2 * MAX_SKEW_MS);
        if seen.insert(env.rid.clone(), now).is_some() {
            return Err("Repeated request".into());
        }
        Ok(())
    }

    fn touch(&self, device_id: &str) {
        let mut stored = lock(&self.stored);
        if let Some(d) = stored.devices.iter_mut().find(|d| d.id == device_id) {
            d.last_seen = Some(chrono::Utc::now().to_rfc3339());
        }
        drop(stored);
        self.save();
    }

    fn stream_turn(&self, mut stream: TcpStream, sealer: Sealer, env: &Envelope<Value>, remote_turn: &dyn Fn(&str) -> String) {
        let Ok(mut req) = serde_json::from_value::<TurnRequest>(env.body.clone()) else { return respond(&mut stream, 400, "Bad turn") };
        // A paired phone may only use this PC's Claude Code.
        req.provider = "claude-code".into();
        #[cfg(desktop)]
        if !super::claude_code::valid_model(&req.model) {
            req.model = String::new();
        }
        req.turn_id = remote_turn(&req.turn_id);
        let turn_id = req.turn_id.clone();

        let head = "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        if stream.write_all(head.as_bytes()).and_then(|_| stream.flush()).is_err() {
            return;
        }
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let rid = env.rid.clone();
        let seq = AtomicU64::new(1);
        let sink: engine::Sink = Arc::new(move |e: AiEvent| {
            let n = seq.fetch_add(1, Ordering::SeqCst);
            let line = sealer.seal(&response_aad(&rid, n), &serde_json::to_vec(&e).unwrap_or_default());
            let _ = tx.send(line);
        });
        match Turn::register(&turn_id, sink.clone()) {
            Ok(turn) => (self.hooks.run_turn)(turn, req),
            Err(e) => sink(AiEvent::error("provider", e)),
        }
        drop(sink);
        // Forward events as they come; a blank line every 20 s keeps the connection honest, so a
        // phone that vanished (Wi-Fi off, app killed) cancels the turn instead of leaving it waiting.
        loop {
            let out = match rx.recv_timeout(KEEPALIVE) {
                Ok(line) => line + "\n",
                Err(RecvTimeoutError::Timeout) => "\n".to_string(),
                Err(RecvTimeoutError::Disconnected) => break,
            };
            if stream.write_all(out.as_bytes()).and_then(|_| stream.flush()).is_err() {
                engine::cancel(&turn_id);
                break;
            }
        }
    }
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    let header_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEADER {
            return Err("Request too large".into());
        }
        let n = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Connection closed".into());
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or_default().split(' ');
    let method = first.next().unwrap_or_default().to_string();
    let path = first.next().unwrap_or_default().split('?').next().unwrap_or_default().to_string();
    let headers: HashMap<String, String> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if len > MAX_BODY {
        return Err("Request too large".into());
    }
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < len {
        let n = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Connection closed".into());
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    Ok(Request { method, path, headers, body })
}

fn respond(stream: &mut TcpStream, code: u16, body: &str) {
    let reason = match code {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        _ => "Error",
    };
    let msg = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(msg.as_bytes());
    let _ = stream.flush();
}

// ── The app's server ─────────────────────────────────────────────────────────

/// The one server of this app (desktop). Turns run on the normal engine with this PC's Claude Code.
#[cfg(desktop)]
pub fn global() -> &'static Arc<Server> {
    static S: OnceLock<Arc<Server>> = OnceLock::new();
    S.get_or_init(|| {
        let hooks = Hooks {
            run_turn: Arc::new(|turn, req| {
                tauri::async_runtime::spawn(engine::run_turn(turn, req));
            }),
            cli_status: Arc::new(|| serde_json::to_value(tauri::async_runtime::block_on(super::claude_code::status())).unwrap_or(Value::Null)),
            usage: Arc::new(|| tauri::async_runtime::block_on(super::claude_code::usage())),
        };
        Server::new(crate::project::data_dir().join("pairing").join("server.json"), hooks)
    })
}

/// Start listening at launch if the writer turned pairing on earlier.
#[cfg(desktop)]
pub fn autostart() {
    let s = global();
    if s.is_enabled() {
        if let Err(e) = s.start("0.0.0.0", Some(DEFAULT_PORT)) {
            log::warn!("Phone pairing could not start: {e}");
            *lock(&s.last_error) = Some(e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::pair_client;
    use crate::ai::types::ChatMessage;

    fn fake_server() -> Arc<Server> {
        let hooks = Hooks {
            // A fake "Claude Code": says hello, reads a document through the phone, finishes.
            run_turn: Arc::new(|turn, _req| {
                tauri::async_runtime::spawn(async move {
                    turn.emit(AiEvent::Started { model: "claude-sonnet-5".into() });
                    let out = turn.call_tool("read_document", json!({ "id": "c1" })).await;
                    turn.emit(AiEvent::TextDelta { text: format!("read: {}", out.content) });
                    turn.emit(AiEvent::Done { stop_reason: "end_turn".into() });
                    turn.finish();
                });
            }),
            cli_status: Arc::new(|| json!({ "installed": true, "loggedIn": true })),
            usage: Arc::new(|| Ok("Current session: 7% used".into())),
        };
        let path = std::env::temp_dir().join(format!("mnemo-pair-{}", random_id())).join("server.json");
        Server::new(path, hooks)
    }

    #[test]
    fn phone_pairs_runs_a_turn_with_a_tool_call_and_can_be_revoked() {
        tauri::async_runtime::block_on(async {
            let server = fake_server();
            let port = server.start("127.0.0.1", None).unwrap();
            let host = format!("127.0.0.1:{port}");

            // No window open → refused; wrong code → refused.
            assert!(pair_client::pair(&host, "1234 5678", "Pixel").await.unwrap_err().contains("isn't open"));
            let (code, _) = server.open_window();
            let wrong = if code.starts_with('9') { "1111 1111" } else { "9999 9999" };
            assert!(pair_client::pair(&host, wrong, "Pixel").await.unwrap_err().contains("didn't match"));
            assert!(server.state()["devices"].as_array().unwrap().is_empty());

            let pc = pair_client::pair(&host, &code, "Pixel").await.unwrap();
            assert_eq!(server.state()["devices"][0]["name"], "Pixel");
            assert!(server.state()["window"].is_null(), "pairing closes once a phone pairs");

            // A turn: events stream back, and the tool call is answered on the "phone".
            let events = Arc::new(Mutex::new(Vec::<AiEvent>::new()));
            let ev2 = events.clone();
            let turn = Turn::register("phone-turn-1", Arc::new(move |e| ev2.lock().unwrap().push(e))).unwrap();
            let req = TurnRequest {
                turn_id: "phone-turn-1".into(),
                provider: "paired".into(),
                model: "sonnet".into(),
                system: String::new(),
                messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }],
                tools: vec![],
                effort: None,
            };
            let answer = {
                let events = events.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        let call = events.lock().unwrap().iter().find_map(|e| match e {
                            AiEvent::ToolCall { call_id, .. } => Some(call_id.clone()),
                            _ => None,
                        });
                        if let Some(id) = call {
                            engine::resolve_tool("phone-turn-1", &id, ToolOutcome { content: "Chapter text".into(), is_error: false }).unwrap();
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                })
            };
            pair_client::run_with(&turn, &req, &pc).await.unwrap();
            turn.finish();
            answer.await.unwrap();
            let got = events.lock().unwrap().clone();
            assert!(got.contains(&AiEvent::Started { model: "claude-sonnet-5".into() }));
            assert!(got.contains(&AiEvent::TextDelta { text: "read: Chapter text".into() }));
            assert!(matches!(got.last(), Some(AiEvent::Done { .. })));

            // Removing the phone on the PC revokes it immediately.
            server.remove_device(&pc.device_id);
            let t2 = Turn::register("phone-turn-2", Arc::new(|_| {})).unwrap();
            let err = pair_client::run_with(&t2, &TurnRequest { turn_id: "phone-turn-2".into(), ..req }, &pc).await.unwrap_err();
            t2.finish();
            assert!(matches!(err, AiEvent::Error { ref kind, .. } if kind == "auth"));
            server.stop();
        });
    }

    #[test]
    fn stale_or_replayed_requests_are_refused() {
        let server = fake_server();
        let env = Envelope { ts: now_ms(), rid: "r1".into(), body: json!({}) };
        assert!(server.fresh(&env).is_ok());
        assert!(server.fresh(&env).is_err(), "same request id twice");
        let old = Envelope { ts: now_ms() - MAX_SKEW_MS - 1000, rid: "r2".into(), body: json!({}) };
        assert!(server.fresh(&old).is_err());
    }
}
