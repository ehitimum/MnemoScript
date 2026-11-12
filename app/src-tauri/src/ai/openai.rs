//! OpenAI Chat Completions API (API-key path). Streams text and runs the function-calling loop.
use super::engine::{http, Turn};
use super::sse::SseParser;
use super::types::{http_error, AiEvent, TurnRequest};
use futures_util::StreamExt;
use serde_json::{json, Value};

const URL: &str = "https://api.openai.com/v1/chat/completions";
pub const DEFAULT_MODEL: &str = "gpt-5";
const MAX_TOOL_ROUNDS: usize = 25;

#[derive(Default, Clone, Debug, PartialEq)]
pub struct ToolCallAcc {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Default)]
pub struct Accumulator {
    pub text: String,
    pub tool_calls: Vec<ToolCallAcc>,
    pub finish_reason: Option<String>,
    pub model: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

impl Accumulator {
    pub fn feed(&mut self, chunk: &Value) -> Vec<AiEvent> {
        let mut out = Vec::new();
        if self.model.is_none() {
            if let Some(m) = chunk["model"].as_str() {
                self.model = Some(m.to_string());
                out.push(AiEvent::Started { model: m.to_string() });
            }
        }
        if let Some(u) = chunk.get("usage").filter(|u| u.is_object()) {
            self.input_tokens = u["prompt_tokens"].as_u64().unwrap_or(0);
            self.output_tokens = u["completion_tokens"].as_u64().unwrap_or(0);
        }
        let Some(choice) = chunk["choices"].get(0) else { return out };
        let delta = &choice["delta"];
        if let Some(t) = delta["content"].as_str().filter(|t| !t.is_empty()) {
            self.text.push_str(t);
            out.push(AiEvent::TextDelta { text: t.to_string() });
        }
        if let Some(calls) = delta["tool_calls"].as_array() {
            for c in calls {
                let idx = c["index"].as_u64().unwrap_or(0) as usize;
                while self.tool_calls.len() <= idx {
                    self.tool_calls.push(ToolCallAcc::default());
                }
                let acc = &mut self.tool_calls[idx];
                if let Some(id) = c["id"].as_str() {
                    acc.id = id.to_string();
                }
                if let Some(n) = c["function"]["name"].as_str() {
                    acc.name.push_str(n);
                }
                if let Some(a) = c["function"]["arguments"].as_str() {
                    acc.arguments.push_str(a);
                }
            }
        }
        if let Some(r) = choice["finish_reason"].as_str() {
            self.finish_reason = Some(r.to_string());
        }
        out
    }
}

pub fn build_body(req: &TurnRequest, conversation: &[Value]) -> Value {
    let model = if req.model.is_empty() { DEFAULT_MODEL } else { req.model.as_str() };
    let mut messages = Vec::new();
    if !req.system.is_empty() {
        messages.push(json!({ "role": "system", "content": req.system }));
    }
    messages.extend_from_slice(conversation);
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    if !req.tools.is_empty() {
        body["tools"] = req
            .tools
            .iter()
            .map(|t| json!({ "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.input_schema } }))
            .collect();
    }
    body
}

pub async fn run(turn: &Turn, req: &TurnRequest, key: String) -> Result<(), AiEvent> {
    let mut conversation: Vec<Value> =
        req.messages.iter().map(|m| json!({ "role": m.role, "content": m.content })).collect();
    let (mut total_in, mut total_out) = (0u64, 0u64);

    for _ in 0..MAX_TOOL_ROUNDS {
        let resp = tokio::select! {
            r = http().post(URL).bearer_auth(&key).json(&build_body(req, &conversation)).send() =>
                r.map_err(|e| AiEvent::error("network", format!("Could not reach OpenAI: {e}")))?,
            _ = turn.cancelled() => return Err(AiEvent::error("cancelled", "Stopped")),
        };
        let status = resp.status().as_u16();
        if status >= 400 {
            return Err(http_error("OpenAI", status, &resp.text().await.unwrap_or_default()));
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
            let chunk = chunk.map_err(|e| AiEvent::error("network", format!("Connection to OpenAI dropped: {e}")))?;
            for ev in parser.push(&chunk) {
                if ev.data == "[DONE]" {
                    continue;
                }
                if let Ok(data) = serde_json::from_str::<Value>(&ev.data) {
                    for out in acc.feed(&data) {
                        turn.emit(out);
                    }
                }
            }
        }
        total_in += acc.input_tokens;
        total_out += acc.output_tokens;
        turn.emit(AiEvent::Usage { input_tokens: total_in, output_tokens: total_out, cost_usd: None });

        if acc.tool_calls.is_empty() {
            let reason = acc.finish_reason.unwrap_or_else(|| "stop".into());
            if reason == "content_filter" {
                return Err(AiEvent::error("refusal", "The model declined this request."));
            }
            turn.emit(AiEvent::Done { stop_reason: reason });
            return Ok(());
        }
        conversation.push(json!({
            "role": "assistant",
            "content": if acc.text.is_empty() { Value::Null } else { json!(acc.text) },
            "tool_calls": acc.tool_calls.iter().map(|c| json!({
                "id": c.id, "type": "function", "function": { "name": c.name, "arguments": c.arguments }
            })).collect::<Vec<_>>(),
        }));
        for c in &acc.tool_calls {
            let outcome = match serde_json::from_str::<Value>(if c.arguments.is_empty() { "{}" } else { &c.arguments }) {
                Ok(input) if input.is_object() => turn.call_tool(&c.name, input).await,
                _ => super::types::ToolOutcome::err("INVALID_JSON: the arguments were not a JSON object. Call the tool again."),
            };
            let content = if outcome.is_error { format!("Error: {}", outcome.content) } else { outcome.content };
            conversation.push(json!({ "role": "tool", "tool_call_id": c.id, "content": content }));
        }
    }
    Err(AiEvent::error("provider", "Stopped after too many tool steps in one turn."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accumulates_streamed_text_tool_calls_and_usage() {
        let mut acc = Accumulator::default();
        let chunks = [
            json!({"model":"gpt-5","choices":[{"index":0,"delta":{"role":"assistant","content":"Sure"}}]}),
            json!({"model":"gpt-5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_document","arguments":"{\"id\""}}]}}]}),
            json!({"model":"gpt-5","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"ch3\"}"}}]}}]}),
            json!({"model":"gpt-5","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}),
            json!({"model":"gpt-5","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20}}),
        ];
        let events: Vec<AiEvent> = chunks.iter().flat_map(|c| acc.feed(c)).collect();
        assert_eq!(events, [AiEvent::Started { model: "gpt-5".into() }, AiEvent::TextDelta { text: "Sure".into() }]);
        assert_eq!(acc.tool_calls, [ToolCallAcc { id: "call_1".into(), name: "read_document".into(), arguments: "{\"id\":\"ch3\"}".into() }]);
        assert_eq!(acc.finish_reason.as_deref(), Some("tool_calls"));
        assert_eq!((acc.input_tokens, acc.output_tokens), (100, 20));
    }

    #[test]
    fn body_puts_the_system_prompt_first_and_maps_tools_to_functions() {
        let req: TurnRequest = serde_json::from_value(json!({
            "turnId": "t", "provider": "openai", "system": "S",
            "messages": [{"role":"user","content":"hi"}],
            "tools": [{"name":"list_documents","description":"d","inputSchema":{"type":"object"}}],
        }))
        .unwrap();
        let body = build_body(&req, &[json!({"role":"user","content":"hi"})]);
        assert_eq!(body["model"], DEFAULT_MODEL);
        assert_eq!(body["messages"][0], json!({"role":"system","content":"S"}));
        assert_eq!(body["tools"][0]["function"]["name"], "list_documents");
        assert_eq!(body["stream_options"]["include_usage"], true);
    }
}
