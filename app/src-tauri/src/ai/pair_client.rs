//! Phone side of pairing: find the PC, pair with the 8-digit code, and run chat turns on the
//! PC's Claude Code (provider `paired`). Tool calls the PC forwards are executed here, on the
//! phone's own documents, through the normal engine path — the UI can't tell the difference.
use super::engine::Turn;
use super::pair_crypto::*;
use super::types::{AiEvent, TurnRequest};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// What the phone keeps about its PC. The key lives in the app's private storage.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PairedPc {
    pub device_id: String,
    pub key: String,
    pub pc_name: String,
    pub server_id: String,
    /// `ip:port`
    pub host: String,
    pub paired_at: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FoundPc {
    pub name: String,
    pub host: String,
    pub id: String,
}

fn store_path() -> PathBuf {
    crate::project::data_dir().join("secrets").join("paired-pc.json")
}

pub fn load() -> Option<PairedPc> {
    std::fs::read_to_string(store_path()).ok().and_then(|s| serde_json::from_str(&s).ok())
}

fn save(pc: &PairedPc) -> Result<(), String> {
    crate::project::write_atomic(&store_path(), &serde_json::to_string_pretty(pc).map_err(|e| e.to_string())?)
}

pub fn forget() -> Result<(), String> {
    match std::fs::remove_file(store_path()) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(4))
            .no_proxy()
            .build()
            .expect("LAN HTTP client")
    })
}

fn sealer(pc: &PairedPc) -> Result<Sealer, String> {
    let key = unb64(&pc.key)?;
    let key: [u8; 32] = key.as_slice().try_into().map_err(|_| "Saved pairing is damaged. Pair again.".to_string())?;
    Ok(Sealer::new(&key))
}

fn unreachable(pc_name: &str) -> String {
    format!("Can't reach {pc_name}. Make sure it's on, MnemoScript is open with phone pairing turned on, and both are on the same Wi-Fi.")
}

/// Broadcast a probe on the local network and collect PCs that answer within `wait`.
pub fn discover(wait: Duration, extra_targets: &[SocketAddr]) -> Vec<FoundPc> {
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0") else { return vec![] };
    let _ = sock.set_broadcast(true);
    let _ = sock.set_read_timeout(Some(Duration::from_millis(150)));
    let mut targets: Vec<SocketAddr> = vec![SocketAddr::from((Ipv4Addr::BROADCAST, DEFAULT_PORT))];
    // Many routers drop 255.255.255.255; the subnet's own broadcast address usually gets through.
    if let Some(std::net::IpAddr::V4(ip)) = UdpSocket::bind("0.0.0.0:0").ok().and_then(|s| s.connect("8.8.8.8:80").ok().map(|_| s)).and_then(|s| s.local_addr().ok()).map(|a| a.ip()) {
        let o = ip.octets();
        targets.push(SocketAddr::from((Ipv4Addr::new(o[0], o[1], o[2], 255), DEFAULT_PORT)));
    }
    targets.extend_from_slice(extra_targets);
    for t in &targets {
        let _ = sock.send_to(DISCOVER_PROBE, t);
    }
    let mut found: Vec<FoundPc> = vec![];
    let until = Instant::now() + wait;
    let mut buf = [0u8; 1024];
    while Instant::now() < until {
        let Ok((n, from)) = sock.recv_from(&mut buf) else { continue };
        let Ok(v) = serde_json::from_slice::<Value>(&buf[..n]) else { continue };
        if v["app"] != "MnemoScript" || v["protocol"] != PROTOCOL {
            continue;
        }
        let id = v["id"].as_str().unwrap_or_default().to_string();
        if found.iter().any(|f| f.id == id) {
            continue;
        }
        found.push(FoundPc {
            name: v["name"].as_str().unwrap_or("PC").to_string(),
            host: format!("{}:{}", from.ip(), v["port"].as_u64().unwrap_or(DEFAULT_PORT as u64)),
            id,
        });
    }
    found
}

/// "192.168.1.20" → "192.168.1.20:47815"; keeps an explicit port.
pub fn normalize_host(host: &str) -> String {
    let h = host.trim().trim_start_matches("http://").trim_end_matches('/');
    if h.contains(':') { h.to_string() } else { format!("{h}:{DEFAULT_PORT}") }
}

/// Pair with the PC at `host` using the code it shows. Saves the pairing on success.
pub async fn pair(host: &str, code: &str, device_name: &str) -> Result<PairedPc, String> {
    let host = normalize_host(host);
    if normalize_code(code).len() != 8 {
        return Err("Enter the 8-digit code shown on your PC.".into());
    }
    let (state, msg) = spake_start(code);
    let resp = client()
        .post(format!("http://{host}/v1/pair"))
        .json(&json!({ "name": device_name, "msg": b64(&msg) }))
        .send()
        .await
        .map_err(|_| unreachable("your PC"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(if text.is_empty() { format!("Pairing failed ({status}).") } else { text });
    }
    let v: Value = serde_json::from_str(&text).map_err(|_| "Unexpected answer from the PC.".to_string())?;
    let shared = spake_finish(state, &unb64(v["msg"].as_str().unwrap_or_default())?)?;
    let grant = Sealer::new(&shared)
        .open(PAIR_AAD, v["grant"].as_str().unwrap_or_default())
        .map_err(|_| "That code didn't match. Check it on your PC and try again.".to_string())?;
    let g: Value = serde_json::from_slice(&grant).map_err(|_| "Unexpected answer from the PC.".to_string())?;
    let pc = PairedPc {
        device_id: g["deviceId"].as_str().unwrap_or_default().to_string(),
        key: g["deviceKey"].as_str().unwrap_or_default().to_string(),
        pc_name: g["pcName"].as_str().unwrap_or("Your PC").to_string(),
        server_id: g["serverId"].as_str().unwrap_or_default().to_string(),
        host,
        paired_at: chrono::Utc::now().to_rfc3339(),
    };
    // Proves we hold the key; the PC only keeps the device after this.
    call(&pc, "/v1/hello", json!({})).await?;
    Ok(pc)
}

/// `pair` + save (the command the UI calls).
pub async fn pair_and_save(host: &str, code: &str, device_name: &str) -> Result<PairedPc, String> {
    let pc = pair(host, code, device_name).await?;
    save(&pc)?;
    Ok(pc)
}

enum CallError {
    Unreachable,
    Refused(String),
}

async fn call_raw(pc: &PairedPc, path: &str, body: Value) -> Result<Value, CallError> {
    let sealer = sealer(pc).map_err(CallError::Refused)?;
    let rid = random_id();
    let env = Envelope { ts: now_ms(), rid: rid.clone(), body };
    let line = sealer.seal(&request_aad(path, &pc.device_id), &serde_json::to_vec(&env).unwrap_or_default());
    let resp = client()
        .post(format!("http://{}{path}", pc.host))
        .header("X-Mnemo-Device", &pc.device_id)
        .timeout(Duration::from_secs(60))
        .body(line)
        .send()
        .await
        .map_err(|_| CallError::Unreachable)?;
    let status = resp.status();
    let text = resp.text().await.map_err(|_| CallError::Unreachable)?;
    if status.as_u16() == 401 {
        return Err(CallError::Refused(format!("{} no longer accepts this phone. Pair again.", pc.pc_name)));
    }
    if !status.is_success() {
        return Err(CallError::Refused(if text.is_empty() { format!("{} refused the request ({status}).", pc.pc_name) } else { text }));
    }
    let plain = sealer.open(&response_aad(&rid, 0), text.trim()).map_err(CallError::Refused)?;
    serde_json::from_slice(&plain).map_err(|_| CallError::Refused("Unexpected answer from the PC.".into()))
}

async fn call(pc: &PairedPc, path: &str, body: Value) -> Result<Value, String> {
    call_raw(pc, path, body).await.map_err(|e| match e {
        CallError::Unreachable => unreachable(&pc.pc_name),
        CallError::Refused(m) => m,
    })
}

/// For the UI: paired? reachable? the PC's Claude Code status. If the PC's address changed
/// (DHCP), finds it again on the network by its id and updates the saved address.
pub async fn check() -> Value {
    let Some(mut pc) = load() else { return json!({ "paired": false }) };
    let mut r = call_raw(&pc, "/v1/hello", json!({})).await;
    if matches!(r, Err(CallError::Unreachable)) {
        let id = pc.server_id.clone();
        let found = tokio::task::spawn_blocking(move || discover(Duration::from_millis(1500), &[]))
            .await
            .unwrap_or_default()
            .into_iter()
            .find(|f| f.id == id);
        if let Some(f) = found {
            if f.host != pc.host {
                pc.host = f.host;
                let _ = save(&pc);
                r = call_raw(&pc, "/v1/hello", json!({})).await;
            }
        }
    }
    match r {
        Ok(v) => json!({ "paired": true, "online": true, "pcName": pc.pc_name, "host": pc.host, "cli": v["cli"] }),
        Err(CallError::Unreachable) => json!({ "paired": true, "online": false, "pcName": pc.pc_name, "host": pc.host, "error": unreachable(&pc.pc_name) }),
        Err(CallError::Refused(m)) => json!({ "paired": true, "online": false, "pcName": pc.pc_name, "host": pc.host, "error": m }),
    }
}

pub async fn usage() -> Result<String, String> {
    let pc = load().ok_or("This phone isn't paired with a PC.")?;
    let v = call(&pc, "/v1/usage", json!({})).await?;
    match v["text"].as_str() {
        Some(t) => Ok(t.to_string()),
        None => Err(v["error"].as_str().unwrap_or("The PC couldn't read its usage.").to_string()),
    }
}

/// Provider `paired`: run the turn on the PC and relay everything back.
pub async fn run(turn: &Turn, req: &TurnRequest) -> Result<(), AiEvent> {
    let pc = load().ok_or_else(|| AiEvent::error("auth", "Pair this phone with your PC first: AI → Connect → Your PC."))?;
    run_with(turn, req, &pc).await
}

pub async fn run_with(turn: &Turn, req: &TurnRequest, pc: &PairedPc) -> Result<(), AiEvent> {
    let sealer = sealer(pc).map_err(|e| AiEvent::error("auth", e))?;
    let mut body = req.clone();
    body.provider = "claude-code".into();
    let rid = random_id();
    let env = Envelope { ts: now_ms(), rid: rid.clone(), body };
    let line = sealer.seal(&request_aad("/v1/turn", &pc.device_id), &serde_json::to_vec(&env).unwrap_or_default());
    let resp = client()
        .post(format!("http://{}/v1/turn", pc.host))
        .header("X-Mnemo-Device", &pc.device_id)
        .body(line)
        .send()
        .await
        .map_err(|_| AiEvent::error("unavailable", unreachable(&pc.pc_name)))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let kind = if status.as_u16() == 401 { "auth" } else { "provider" };
        let msg = if status.as_u16() == 401 { format!("{} no longer accepts this phone. Pair again.", pc.pc_name) } else { text };
        return Err(AiEvent::error(kind, msg));
    }

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut seq: u64 = 1;
    let lost = || AiEvent::error("network", format!("Lost the connection to {} mid-reply.", pc.pc_name));
    loop {
        let chunk = tokio::select! {
            c = tokio::time::timeout(Duration::from_secs(70), stream.next()) => c,
            _ = turn.cancelled() => {
                let _ = call(pc, "/v1/cancel", json!({ "turnId": req.turn_id })).await;
                return Err(AiEvent::error("cancelled", "Stopped"));
            }
        };
        let bytes = match chunk {
            Ok(Some(Ok(b))) => b,
            _ => return Err(lost()), // timed out (no keep-alive), errored or closed early
        };
        buf.extend_from_slice(&bytes);
        while let Some(i) = buf.iter().position(|&b| b == b'\n') {
            let raw: Vec<u8> = buf.drain(..=i).collect();
            let text = String::from_utf8_lossy(&raw).trim().to_string();
            if text.is_empty() {
                continue; // keep-alive
            }
            let plain = sealer.open(&response_aad(&rid, seq), &text).map_err(|e| AiEvent::error("network", e))?;
            seq += 1;
            let ev: AiEvent = serde_json::from_slice(&plain).map_err(|_| lost())?;
            match ev {
                AiEvent::ToolCall { call_id, name, input } => {
                    // Run it here (the phone's documents), then hand the answer back to the PC.
                    let (turn, pc, turn_id) = (turn.clone(), pc.clone(), req.turn_id.clone());
                    tokio::spawn(async move {
                        let out = turn.call_tool(&name, input).await;
                        let _ = call(&pc, "/v1/tool", json!({ "turnId": turn_id, "callId": call_id, "content": out.content, "isError": out.is_error })).await;
                    });
                }
                AiEvent::Done { .. } => {
                    turn.emit(ev);
                    return Ok(());
                }
                AiEvent::Error { .. } => return Err(ev),
                other => turn.emit(other),
            }
        }
    }
}
