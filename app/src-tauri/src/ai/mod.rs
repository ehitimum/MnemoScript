//! AI assistant backend. Provider-neutral turn engine (`engine`), provider adapters
//! (`anthropic`, `openai`, `gemini` over API keys; `claude_code` over the writer's own CLI
//! sign-in), per-project session storage (`sessions`) and API-key storage (`secrets`).
//! Architecture notes: `docs/ARCHITECTURE.md` → "AI assistant".
pub mod anthropic;
#[cfg(desktop)]
pub mod claude_code;
pub mod commands;
pub mod engine;
pub mod gemini;
#[cfg(desktop)]
pub mod mcp_http;
pub mod openai;
pub mod secrets;
pub mod sessions;
pub mod sse;
pub mod types;
