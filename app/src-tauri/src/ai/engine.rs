//! Turn engine: runs one chat turn on the chosen provider, streams `AiEvent`s to a sink, and
//! routes tool calls to the frontend (which owns the documents) and back.
//!
//! Tool execution always happens in the frontend, for every provider:
//!   provider wants a tool → `ToolCall` event → frontend runs it (enforcing plan/ask/auto) →
//!   `ai_tool_result` command → `resolve_tool` → the provider loop continues.
use super::types::{AiEvent, ToolOutcome, TurnRequest};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::{oneshot, watch};

pub type Sink = Arc<dyn Fn(AiEvent) + Send + Sync>;

struct TurnSlot {
    cancel: watch::Sender<bool>,
    pending: HashMap<String, oneshot::Sender<ToolOutcome>>,
}

fn registry() -> &'static Mutex<HashMap<String, TurnSlot>> {
    static R: OnceLock<Mutex<HashMap<String, TurnSlot>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock() -> std::sync::MutexGuard<'static, HashMap<String, TurnSlot>> {
    registry().lock().unwrap_or_else(|p| p.into_inner())
}

/// Handle a provider uses while a turn runs.
#[derive(Clone)]
pub struct Turn {
    pub id: String,
    sink: Sink,
    cancel: watch::Receiver<bool>,
}

impl Turn {
    /// Register a turn. Fails if a turn with the same id is already running.
    pub fn register(id: &str, sink: Sink) -> Result<Turn, String> {
        let mut reg = lock();
        if reg.contains_key(id) {
            return Err("This turn is already running".into());
        }
        let (tx, rx) = watch::channel(false);
        reg.insert(id.to_string(), TurnSlot { cancel: tx, pending: HashMap::new() });
        Ok(Turn { id: id.to_string(), sink, cancel: rx })
    }

    pub fn emit(&self, event: AiEvent) {
        (self.sink)(event);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.cancel.borrow()
    }

    /// Resolves when the turn is cancelled (never, otherwise).
    pub async fn cancelled(&self) {
        let mut rx = self.cancel.clone();
        while !*rx.borrow() {
            if rx.changed().await.is_err() {
                // Sender gone (turn finished): park forever; callers `select!` on this.
                std::future::pending::<()>().await;
            }
        }
    }

    /// Ask the frontend to run a tool and wait for its answer (or for cancellation).
    pub async fn call_tool(&self, name: &str, input: serde_json::Value) -> ToolOutcome {
        let call_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        {
            let mut reg = lock();
            match reg.get_mut(&self.id) {
                Some(slot) => {
                    slot.pending.insert(call_id.clone(), tx);
                }
                None => return ToolOutcome::err("The turn has ended"),
            }
        }
        self.emit(AiEvent::ToolCall { call_id: call_id.clone(), name: name.to_string(), input });
        tokio::select! {
            r = rx => r.unwrap_or_else(|_| ToolOutcome::err("The tool call was dropped")),
            _ = self.cancelled() => ToolOutcome::err("Cancelled by the writer"),
        }
    }

    /// Forget the turn (always called when it ends).
    pub fn finish(&self) {
        lock().remove(&self.id);
    }
}

/// Deliver a tool result from the frontend.
pub fn resolve_tool(turn_id: &str, call_id: &str, outcome: ToolOutcome) -> Result<(), String> {
    let tx = lock()
        .get_mut(turn_id)
        .and_then(|slot| slot.pending.remove(call_id))
        .ok_or_else(|| "No such pending tool call".to_string())?;
    tx.send(outcome).map_err(|_| "The turn is no longer waiting for this tool".to_string())
}

pub fn cancel(turn_id: &str) -> bool {
    match lock().get(turn_id) {
        Some(slot) => {
            let _ = slot.cancel.send(true);
            true
        }
        None => false,
    }
}

/// Shared HTTP client (connection pooling across turns).
pub fn http() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("HTTP client")
    })
}

fn api_key(provider: &str, label: &str) -> Result<String, AiEvent> {
    match super::secrets::get(provider) {
        Ok(Some(k)) => Ok(k),
        Ok(None) => Err(AiEvent::error("auth", format!("Add your {label} API key in Settings → AI to use this provider."))),
        Err(e) => Err(AiEvent::error("auth", format!("Could not read the saved {label} key: {e}"))),
    }
}

/// Run a whole turn. Every exit path emits exactly one terminal `Done` or `Error` event.
pub async fn run_turn(turn: Turn, req: TurnRequest) {
    let result: Result<(), AiEvent> = async {
        if req.messages.last().map(|m| m.role.as_str()) != Some("user") {
            return Err(AiEvent::error("provider", "A turn must end with a user message"));
        }
        match req.provider.as_str() {
            "anthropic" => super::anthropic::run(&turn, &req, api_key("anthropic", "Anthropic")?).await,
            "openai" => super::openai::run(&turn, &req, api_key("openai", "OpenAI")?).await,
            "gemini" => super::gemini::run(&turn, &req, api_key("gemini", "Google Gemini")?).await,
            #[cfg(desktop)]
            "claude-code" => super::claude_code::run(&turn, &req).await,
            #[cfg(desktop)]
            "codex" => super::codex::run(&turn, &req).await,
            #[cfg(not(desktop))]
            "claude-code" => Err(AiEvent::error(
                "unavailable",
                "Claude Code runs on your computer. On a phone, use an API key instead.",
            )),
            // A phone paired with a PC: the PC's Claude Code answers, tools run here.
            "paired" => super::pair_client::run(&turn, &req).await,
            other => Err(AiEvent::error("unavailable", format!("Unknown AI provider \"{other}\""))),
        }
    }
    .await;
    if let Err(e) = result {
        turn.emit(if turn.is_cancelled() { AiEvent::error("cancelled", "Stopped") } else { e });
    }
    turn.finish();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collecting_sink() -> (Sink, Arc<Mutex<Vec<AiEvent>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let e2 = events.clone();
        (Arc::new(move |e| e2.lock().unwrap().push(e)), events)
    }

    #[tokio::test]
    async fn tool_calls_round_trip_through_the_registry() {
        let (sink, events) = collecting_sink();
        let turn = Turn::register("t-roundtrip", sink).unwrap();
        let t2 = turn.clone();
        let call = tokio::spawn(async move { t2.call_tool("list_documents", serde_json::json!({})).await });
        // Wait for the ToolCall event, then answer it like the frontend would.
        let call_id = loop {
            if let Some(AiEvent::ToolCall { call_id, .. }) = events.lock().unwrap().first().cloned() {
                break call_id;
            }
            tokio::task::yield_now().await;
        };
        resolve_tool("t-roundtrip", &call_id, ToolOutcome { content: "[]".into(), is_error: false }).unwrap();
        assert_eq!(call.await.unwrap(), ToolOutcome { content: "[]".into(), is_error: false });
        assert!(resolve_tool("t-roundtrip", &call_id, ToolOutcome::err("x")).is_err()); // already answered
        turn.finish();
    }

    #[tokio::test]
    async fn cancelling_unblocks_a_waiting_tool_call() {
        let (sink, _) = collecting_sink();
        let turn = Turn::register("t-cancel", sink).unwrap();
        let t2 = turn.clone();
        let call = tokio::spawn(async move { t2.call_tool("read_document", serde_json::json!({})).await });
        tokio::task::yield_now().await;
        assert!(cancel("t-cancel"));
        assert!(call.await.unwrap().is_error);
        turn.finish();
        assert!(!cancel("t-cancel"));
    }

    #[tokio::test]
    async fn duplicate_turn_ids_are_refused_and_turns_must_end_with_a_user_message() {
        let (sink, events) = collecting_sink();
        let turn = Turn::register("t-dup", sink.clone()).unwrap();
        assert!(Turn::register("t-dup", sink.clone()).is_err());
        turn.finish();
        let turn = Turn::register("t-dup", sink).unwrap();
        let req: TurnRequest = serde_json::from_value(serde_json::json!({
            "turnId": "t-dup", "provider": "anthropic",
            "messages": [{"role": "assistant", "content": "hi"}]
        }))
        .unwrap();
        run_turn(turn, req).await;
        assert!(matches!(&events.lock().unwrap()[0], AiEvent::Error { kind, .. } if kind == "provider"));
    }
}
