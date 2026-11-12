//! AI assistant backend. Provider-neutral turn engine (`engine`), provider adapters
//! (`anthropic`, `openai`, `gemini` over API keys; `claude_code` over the writer's own CLI
//! sign-in; `pair_client` on a phone = the paired PC's Claude Code), per-project session storage
//! (`sessions`), API-key storage (`secrets`) and phone ↔ PC pairing (`pair_*`).
//! Architecture notes: `docs/ARCHITECTURE.md` → "AI assistant".
pub mod anthropic;
#[cfg(desktop)]
pub mod claude_code;
#[cfg(desktop)]
pub mod codex;
pub mod commands;
pub mod engine;
pub mod gemini;
#[cfg(desktop)]
pub mod mcp_http;
pub mod openai;
pub mod pair_client;
pub mod pair_crypto;
#[cfg(desktop)]
pub mod pair_server;
pub mod secrets;
pub mod sessions;
pub mod sse;
pub mod types;
