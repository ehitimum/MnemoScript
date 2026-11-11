//! Wire types shared by every AI provider. The frontend mirrors these in `src/lib/ai/types.ts`.
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One chat turn, provider-neutral. The frontend builds it from the stored session
/// (`lib/ai/context.ts`), so switching providers or models never needs a provider's own history.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TurnRequest {
    pub turn_id: String,
    /// `claude-code` | `anthropic` | `openai` | `gemini`
    pub provider: String,
    /// Provider model id or CLI alias (`opus`, `sonnet`, …). Empty = the provider's default.
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub system: String,
    /// Oldest first; the last entry is the new user message.
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub tools: Vec<ToolSpec>,
    /// Optional reasoning effort hint (`low` … `max`) where the provider supports it.
    #[serde(default)]
    pub effort: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct ChatMessage {
    /// `user` | `assistant`
    pub role: String,
    pub content: String,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Streamed to the frontend over a Tauri `Channel` while a turn runs.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AiEvent {
    /// The model that actually answers (resolved alias, or a server-side fallback model).
    Started { model: String },
    TextDelta { text: String },
    /// The model wants a tool run. The frontend executes it and answers with `ai_tool_result`.
    ToolCall { call_id: String, name: String, input: Value },
    Usage { input_tokens: u64, output_tokens: u64, cost_usd: Option<f64> },
    /// Subscription limit window (Claude Code). `utilization` is 0–1 and only present near a limit.
    #[cfg_attr(not(desktop), allow(dead_code))]
    RateLimit { window: String, status: String, resets_at: Option<i64>, utilization: Option<f64> },
    Done { stop_reason: String },
    /// `auth` (not signed in / bad key), `rate_limit`, `refusal`, `unavailable`, `cancelled`,
    /// `network`, `provider`.
    Error { kind: String, message: String },
}

impl AiEvent {
    pub fn error(kind: &str, message: impl Into<String>) -> Self {
        AiEvent::Error { kind: kind.to_string(), message: message.into() }
    }
}

/// What the frontend returns for one tool call.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolOutcome {
    pub content: String,
    pub is_error: bool,
}

impl ToolOutcome {
    pub fn err(message: impl Into<String>) -> Self {
        ToolOutcome { content: message.into(), is_error: true }
    }
}

/// Map an HTTP status from a provider API to an error event.
pub fn http_error(provider: &str, status: u16, body: &str) -> AiEvent {
    // Providers wrap the human-readable message differently; dig it out when we can.
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .or_else(|| v.pointer("/message"))
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(300).collect());
    let kind = match status {
        401 | 403 => "auth",
        429 => "rate_limit",
        _ => "provider",
    };
    AiEvent::error(kind, format!("{provider} returned {status}: {detail}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_serialise_in_camel_case_with_a_type_tag() {
        let v = serde_json::to_value(AiEvent::ToolCall {
            call_id: "c1".into(),
            name: "read_document".into(),
            input: serde_json::json!({"id": "a"}),
        })
        .unwrap();
        assert_eq!(v["type"], "toolCall");
        assert_eq!(v["callId"], "c1");
        let u = serde_json::to_value(AiEvent::Usage { input_tokens: 1, output_tokens: 2, cost_usd: None }).unwrap();
        assert_eq!(u["inputTokens"], 1);
    }

    #[test]
    fn http_errors_are_classified_and_keep_the_provider_message() {
        let e = http_error("Anthropic", 401, r#"{"error":{"message":"invalid x-api-key"}}"#);
        assert_eq!(e, AiEvent::error("auth", "Anthropic returned 401: invalid x-api-key"));
        assert!(matches!(http_error("OpenAI", 429, "slow down"), AiEvent::Error { kind, .. } if kind == "rate_limit"));
        assert!(matches!(http_error("Gemini", 500, "{}"), AiEvent::Error { kind, .. } if kind == "provider"));
    }
}
