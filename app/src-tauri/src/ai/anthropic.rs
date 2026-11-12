//! Anthropic Messages API (API-key path; works on desktop and Android). Raw HTTP + SSE — there
//! is no official Rust SDK. Streams text, runs the tool loop, and passes every content block
//! (including thinking blocks) back unchanged within the turn, as the API requires.
use super::engine::{http, Turn};
use super::sse::SseParser;
use super::types::{http_error, AiEvent, ToolOutcome, TurnRequest};
use futures_util::StreamExt;
use serde_json::{json, Map, Value};

const URL: &str = "https://api.anthropic.com/v1/messages";
pub const DEFAULT_MODEL: &str = "claude-opus-5-5";
/// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS: [&str; 5] = ["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"];
const MAX_TOOL_ROUNDS: usize = 25;

/// Accumulates one streamed response.
#[derive(Default)]
pub struct Accumulator {
    pub blocks: Vec<Value>,
    partial_json: Vec<String>,
    pub stop_reason: Option<String>,
    pub model: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub error: Option<String>,
}

impl Accumulator {
    /// Apply one SSE `data` payload; returns events to forward to the UI.
    pub fn feed(&mut self, data: &Value) -> Vec<AiEvent> {
        let mut out = Vec::new();
        match data["type"].as_str().unwrap_or_default() {
            "message_start" => {
                let msg = &data["message"];
                if let Some(m) = msg["model"].as_str() {
                    self.model = Some(m.to_string());
                    out.push(AiEvent::Started { model: m.to_string() });
                }
                let u = &msg["usage"];
                self.input_tokens += u["input_tokens"].as_u64().unwrap_or(0)
                    + u["cache_read_input_tokens"].as_u64().unwrap_or(0)
                    + u["cache_creation_input_tokens"].as_u64().unwrap_or(0);
            }
            "content_block_start" => {
                let idx = data["index"].as_u64().unwrap_or(0) as usize;
                while self.blocks.len() <= idx {
                    self.blocks.push(Value::Null);
                    self.partial_json.push(String::new());
                }
                self.blocks[idx] = data["content_block"].clone();
                if let Some(t) = self.blocks[idx]["text"].as_str().filter(|t| !t.is_empty()) {
                    out.push(AiEvent::TextDelta { text: t.to_string() });
                }
            }
            "content_block_delta" => {
                let idx = data["index"].as_u64().unwrap_or(0) as usize;
                let d = &data["delta"];
                if let Some(block) = self.blocks.get_mut(idx) {
                    match d["type"].as_str().unwrap_or_default() {
                        "text_delta" => {
                            let t = d["text"].as_str().unwrap_or_default();
                            append(block, "text", t);
                            out.push(AiEvent::TextDelta { text: t.to_string() });
                        }
                        "thinking_delta" => append(block, "thinking", d["thinking"].as_str().unwrap_or_default()),
                        "signature_delta" => append(block, "signature", d["signature"].as_str().unwrap_or_default()),
                        "input_json_delta" => self.partial_json[idx].push_str(d["partial_json"].as_str().unwrap_or_default()),
                        _ => {}
                    }
                }
            }
            "content_block_stop" => {
                let idx = data["index"].as_u64().unwrap_or(0) as usize;
                if let Some(block) = self.blocks.get_mut(idx) {
                    if block["type"] == "tool_use" {
                        let raw = std::mem::take(&mut self.partial_json[idx]);
                        // Eager input streaming means the server no longer validates the input:
                        // keep invalid JSON visible so the tool loop can answer with an error.
                        block["input"] = if raw.trim().is_empty() {
                            json!({})
                        } else {
                            serde_json::from_str::<Value>(&raw)
                                .ok()
                                .filter(Value::is_object)
                                .unwrap_or_else(|| json!({ "__invalid_json": raw }))
                        };
                    }
                }
            }
            "message_delta" => {
                if let Some(r) = data["delta"]["stop_reason"].as_str() {
                    self.stop_reason = Some(r.to_string());
                }
                self.output_tokens = data["usage"]["output_tokens"].as_u64().unwrap_or(self.output_tokens);
            }
            "error" => {
                self.error = Some(data["error"]["message"].as_str().unwrap_or("Stream error").to_string());
            }
            _ => {}
        }
        out
    }

    pub fn tool_uses(&self) -> Vec<&Value> {
        self.blocks.iter().filter(|b| b["type"] == "tool_use").collect()
    }
}

fn append(block: &mut Value, key: &str, s: &str) {
    let cur = block[key].as_str().unwrap_or_default().to_string();
    block[key] = Value::String(cur + s);
}

pub fn build_body(req: &TurnRequest, conversation: &[Value]) -> Value {
    let model = if req.model.is_empty() { DEFAULT_MODEL } else { req.model.as_str() };
    let tools: Vec<Value> = req
        .tools
        .iter()
        .map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.input_schema, "eager_input_streaming": true }))
        .collect();
    let mut body = Map::new();
    body.insert("model".into(), json!(model));
    body.insert("max_tokens".into(), json!(64000));
    body.insert("stream".into(), json!(true));
    if !req.system.is_empty() {
        body.insert("system".into(), json!(req.system));
    }
    body.insert("messages".into(), Value::Array(conversation.to_vec()));
    if !tools.is_empty() {
        body.insert("tools".into(), Value::Array(tools));
    }
    // Opus 5.5 defaults to medium effort; state it explicitly (the writer can raise it later).
    body.insert("output_config".into(), json!({ "effort": req.effort.clone().unwrap_or_else(|| "medium".into()) }));
    if FALLBACK_MODELS.contains(&model) {
        body.insert("fallbacks".into(), json!("default"));
    }
    Value::Object(body)
}

pub async fn run(turn: &Turn, req: &TurnRequest, key: String) -> Result<(), AiEvent> {
    let mut conversation: Vec<Value> =
        req.messages.iter().map(|m| json!({ "role": m.role, "content": m.content })).collect();
    let (mut total_in, mut total_out) = (0u64, 0u64);

    for _ in 0..MAX_TOOL_ROUNDS {
        let body = build_body(req, &conversation);
        let resp = tokio::select! {
            r = http().post(URL)
                .header("x-api-key", &key)
                .header("anthropic-version", "2026-10-21")
                .header("anthropic-beta", "server-side-fallback-2026-07-01")
                .json(&body)
                .send() => r.map_err(|e| AiEvent::error("network", format!("Could not reach Anthropic: {e}")))?,
            _ = turn.cancelled() => return Err(AiEvent::error("cancelled", "Stopped")),
        };
        let status = resp.status().as_u16();
        if status >= 400 {
            let text = resp.text().await.unwrap_or_default();
            return Err(http_error("Anthropic", status, &text));
        }

        let mut acc = Accumulator::default();
        let mut parser = SseParser::default();
        let mut stream = resp.bytes_stream();
        loop {
            let chunk = tokio::select! {
                c = stream.next() => c,
                _ = turn.cancelled() => return Err(AiEvent::error("cancelled", "Stopped")),
            };
            let Some(chunk) = chunk else { break };
            let chunk = chunk.map_err(|e| AiEvent::error("network", format!("Connection to Anthropic dropped: {e}")))?;
            for ev in parser.push(&chunk) {
                if let Ok(data) = serde_json::from_str::<Value>(&ev.data) {
                    for out in acc.feed(&data) {
                        turn.emit(out);
                    }
                }
            }
        }
        if let Some(e) = acc.error.take() {
            return Err(AiEvent::error("provider", format!("Anthropic: {e}")));
        }
        total_in += acc.input_tokens;
        total_out += acc.output_tokens;
        turn.emit(AiEvent::Usage { input_tokens: total_in, output_tokens: total_out, cost_usd: None });

        let stop = acc.stop_reason.clone().unwrap_or_else(|| "end_turn".into());
        match stop.as_str() {
            "refusal" => return Err(AiEvent::error("refusal", "The model declined this request.")),
            "tool_use" => {}
            _ => {
                turn.emit(AiEvent::Done { stop_reason: stop });
                return Ok(());
            }
        }

        // Run every requested tool, then return all results in ONE user message.
        let mut results = Vec::new();
        for block in acc.tool_uses() {
            let id = block["id"].as_str().unwrap_or_default();
            let name = block["name"].as_str().unwrap_or_default();
            let outcome = if block["input"].get("__invalid_json").is_some() {
                ToolOutcome::err("INVALID_JSON: the tool input was not valid JSON. Call the tool again.")
            } else {
                turn.call_tool(name, block["input"].clone()).await
            };
            results.push(json!({ "type": "tool_result", "tool_use_id": id, "content": outcome.content, "is_error": outcome.is_error }));
        }
        let mut assistant_blocks = acc.blocks.clone();
        for b in assistant_blocks.iter_mut().filter(|b| b["type"] == "tool_use") {
            if b["input"].get("__invalid_json").is_some() {
                b["input"] = json!({});
            }
        }
        conversation.push(json!({ "role": "assistant", "content": assistant_blocks }));
        conversation.push(json!({ "role": "user", "content": results }));
    }
    Err(AiEvent::error("provider", "Stopped after too many tool steps in one turn."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::ToolSpec;

    fn feed_all(acc: &mut Accumulator, lines: &[Value]) -> Vec<AiEvent> {
        lines.iter().flat_map(|l| acc.feed(l)).collect()
    }

    #[test]
    fn accumulates_text_thinking_and_tool_use_blocks() {
        let mut acc = Accumulator::default();
        let events = feed_all(&mut acc, &[
            json!({"type":"message_start","message":{"model":"claude-opus-5-5","usage":{"input_tokens":10,"cache_read_input_tokens":5}}}),
            json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}),
            json!({"type":"content_block_stop","index":0}),
            json!({"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Let me "}}),
            json!({"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"look."}}),
            json!({"type":"content_block_stop","index":1}),
            json!({"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"tu1","name":"read_document","input":{}}}),
            json!({"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"id\":"}}),
            json!({"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\"ch3\"}"}}),
            json!({"type":"content_block_stop","index":2}),
            json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":42}}),
        ]);
        assert_eq!(events[0], AiEvent::Started { model: "claude-opus-5-5".into() });
        assert_eq!(events[1..], [AiEvent::TextDelta { text: "Let me ".into() }, AiEvent::TextDelta { text: "look.".into() }]);
        assert_eq!(acc.blocks[0]["signature"], "sig"); // thinking block kept intact for the next request
        assert_eq!(acc.blocks[1]["text"], "Let me look.");
        assert_eq!(acc.tool_uses()[0]["input"], json!({"id":"ch3"}));
        assert_eq!(acc.stop_reason.as_deref(), Some("tool_use"));
        assert_eq!((acc.input_tokens, acc.output_tokens), (15, 42));
    }

    #[test]
    fn invalid_tool_json_is_flagged_not_dropped() {
        let mut acc = Accumulator::default();
        feed_all(&mut acc, &[
            json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"x","input":{}}}),
            json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"id\":\"trunc"}}),
            json!({"type":"content_block_stop","index":0}),
        ]);
        assert!(acc.tool_uses()[0]["input"].get("__invalid_json").is_some());
    }

    #[test]
    fn request_body_uses_current_api_shape() {
        let req: TurnRequest = serde_json::from_value(json!({
            "turnId": "t", "provider": "anthropic", "model": "", "system": "Be kind.",
            "messages": [{"role":"user","content":"hi"}],
        }))
        .unwrap();
        let mut req = req;
        req.tools.push(ToolSpec { name: "list_documents".into(), description: "d".into(), input_schema: json!({"type":"object"}) });
        let body = build_body(&req, &[json!({"role":"user","content":"hi"})]);
        assert_eq!(body["model"], DEFAULT_MODEL);
        assert_eq!(body["stream"], true);
        assert_eq!(body["fallbacks"], "default");
        assert_eq!(body["output_config"]["effort"], "medium");
        assert_eq!(body["tools"][0]["eager_input_streaming"], true);
        assert!(body.get("temperature").is_none() && body.get("thinking").is_none());
        req.model = "claude-haiku-5-5".into();
        assert!(build_body(&req, &[]).get("fallbacks").is_none());
    }
}
