//! MnemoSync: optional, local-first project sync. See `docs/MNEMOSYNC_ARCHITECTURE.md`.
//!
//! The engine (`engine.rs`) is transport-neutral; Google Drive (`drive/`) is the first
//! transport. Local saves never wait for, or depend on, a transport.
pub mod engine;
pub mod model;
pub mod portable;
pub mod store;

#[cfg(test)]
pub mod memory;
