//! Google Gemini API (API-key path). Streams text and runs the function-calling loop. Model
//! parts are passed back unchanged (they can carry `thoughtSignature`s the API expects back).
use super::engine::{http, Turn};
use super::sse::SseParser;
use super::types::{http_error, AiEvent, ToolOutcome, TurnRequest};
use futures_util::StreamExt;
use serde_json::{json, Value};

pub const DEFAULT_MODEL: &str = "gemini-2.5-pro";
const MAX_TOOL_ROUNDS: usize = 25;

#[derive(Default)]
pub struct Accumulator {
    /// Model parts in order; consecutive text parts are merged.
    pub parts: Vec<Value>,
    pub finish_reason: Option<String>,
    pub model: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

impl Accumulator {
    pub fn feed(&mut self, chunk: &Value) -> Vec<AiEvent> {
        let mut out = Vec::new();
        if self.model.is_none() {
            if let Some(m) = chunk["modelVersion"].as_str() {
                self.model = Some(m.to_string());
                out.push(AiEvent::Started { model: m.to_string() });
            }
        }
        if let Some(u) = chunk.get("usageMetadata") {
            self.input_tokens = u["promptTokenCount"].as_u64().unwrap_or(self.input_tokens);
            self.output_tokens = u["candidatesTokenCount"].as_u64().unwrap_or(self.output_tokens);
        }
        let cand = &chunk["candidates"][0];
        if let Some(parts) = cand["content"]["parts"].as_array() {
            for p in parts {
                let is_thought = p["thought"].as_bool().unwrap_or(false);
                match (p["text"].as_str(), self.parts.last_mut()) {
                    (Some(t), Some(last))
                        if !is_thought && last.get("text").is_some() && last.get("thought").is_none() && p.get("thoughtSignature").is_none() =>
                    {
                        let merged = format!("{}{t}", last["text"].as_str().unwrap_or_default());
                        last["text"] = json!(merged);
                    }
                    _ => self.parts.push(p.clone()),
                }
                if let (Some(t), false) = (p["text"].as_str(), is_thought) {
                    if !t.is_empty() {
                        out.push(AiEvent::TextDelta { text: t.to_string() });
                    }
                }
            }
        }
        if let Some(r) = cand["finishReason"].as_str() {
            self.finish_reason = Some(r.to_string());
        }
        out
    }

    pub fn function_calls(&self) -> Vec<&Value> {
        self.parts.iter().filter_map(|p| p.get("functionCall")).collect()
    }
}

pub fn build_body(req: &TurnRequest, contents: &[Value]) -> Value {
    let mut body = json!({ "contents": contents });
    if !req.system.is_empty() {
        body["systemInstruction"] = json!({ "parts": [{ "text": req.system }] });
    }
    if !req.tools.is_empty() {
        let decls: Vec<Value> = req
            .tools
            .iter()
            .map(|t| json!({ "name": t.name, "description": t.description, "parameters": t.input_schema }))
            .collect();
        body["tools"] = json!([{ "functionDeclarations": decls }]);
    }
    body
}

fn to_contents(req: &TurnRequest) -> Vec<Value> {
    req.messages
        .iter()
        .map(|m| json!({ "role": if m.role == "assistant" { "model" } else { "user" }, "parts": [{ "text": m.content }] }))
        .collect()
}

pub async fn run(turn: &Turn, req: &TurnRequest, key: String) -> Result<(), AiEvent> {
    let model = if req.model.is_empty() { DEFAULT_MODEL } else { req.model.as_str() };
    if !model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_')) {
        return Err(AiEvent::error("provider", "Invalid Gemini model name"));
    }
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse");
    let mut contents = to_contents(req);
    let (mut total_in, mut total_out) = (0u64, 0u64);

    for _ in 0..MAX_TOOL_ROUNDS {
        let resp = tokio::select! {
            r = http().post(&url).header("x-goog-api-key", &key).json(&build_body(req, &contents)).send() =>
                r.map_err(|e| AiEvent::error("network", format!("Could not reach Gemini: {e}")))?,
            _ = turn.cancelled() => return Err(AiEvent::error("cancelled", "Stopped")),
        };
        let status = resp.status().as_u16();
        if status >= 400 {
            return Err(http_error("Gemini", status, &resp.text().await.unwrap_or_default()));
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
            let chunk = chunk.map_err(|e| AiEvent::error("network", format!("Connection to Gemini dropped: {e}")))?;
            for ev in parser.push(&chunk) {
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

        let calls: Vec<Value> = acc.function_calls().into_iter().cloned().collect();
        if calls.is_empty() {
            let reason = acc.finish_reason.unwrap_or_else(|| "STOP".into());
            if matches!(reason.as_str(), "SAFETY" | "PROHIBITED_CONTENT" | "BLOCKLIST" | "RECITATION") {
                return Err(AiEvent::error("refusal", "The model declined this request."));
            }
            turn.emit(AiEvent::Done { stop_reason: reason });
            return Ok(());
        }
        contents.push(json!({ "role": "model", "parts": acc.parts }));
        let mut responses = Vec::new();
        for call in calls {
            let name = call["name"].as_str().unwrap_or_default().to_string();
            let args = call.get("args").cloned().filter(Value::is_object).unwrap_or_else(|| json!({}));
            let ToolOutcome { content, is_error } = turn.call_tool(&name, args).await;
            let mut fr = json!({ "name": name, "response": if is_error { json!({ "error": content }) } else { json!({ "result": content }) } });
            if let Some(id) = call.get("id") {
                fr["id"] = id.clone();
            }
            responses.push(json!({ "functionResponse": fr }));
        }
        contents.push(json!({ "role": "user", "parts": responses }));
    }
    Err(AiEvent::error("provider", "Stopped after too many tool steps in one turn."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_text_keeps_function_calls_and_signatures() {
        let mut acc = Accumulator::default();
        let chunks = [
            json!({"modelVersion":"gemini-2.5-pro","candidates":[{"content":{"role":"model","parts":[{"text":"Let "}]}}]}),
            json!({"candidates":[{"content":{"parts":[{"text":"me check."}]}}]}),
            json!({"candidates":[{"content":{"parts":[{"functionCall":{"name":"read_document","args":{"id":"ch3"}},"thoughtSignature":"abc"}]},"finishReason":"STOP"}],
                   "usageMetadata":{"promptTokenCount":50,"candidatesTokenCount":9}}),
        ];
        let events: Vec<AiEvent> = chunks.iter().flat_map(|c| acc.feed(c)).collect();
        assert_eq!(events[0], AiEvent::Started { model: "gemini-2.5-pro".into() });
        assert_eq!(acc.parts.len(), 2);
        assert_eq!(acc.parts[0]["text"], "Let me check.");
        assert_eq!(acc.parts[1]["thoughtSignature"], "abc");
        assert_eq!(acc.function_calls()[0]["args"]["id"], "ch3");
        assert_eq!((acc.input_tokens, acc.output_tokens), (50, 9));
    }

    #[test]
    fn body_maps_roles_and_tools() {
        let req: TurnRequest = serde_json::from_value(json!({
            "turnId": "t", "provider": "gemini", "system": "S",
            "messages": [{"role":"user","content":"a"},{"role":"assistant","content":"b"},{"role":"user","content":"c"}],
            "tools": [{"name":"list_documents","description":"d","inputSchema":{"type":"object","properties":{}}}],
        }))
        .unwrap();
        let body = build_body(&req, &to_contents(&req));
        assert_eq!(body["contents"][1]["role"], "model");
        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "S");
        assert_eq!(body["tools"][0]["functionDeclarations"][0]["name"], "list_documents");
    }
}
