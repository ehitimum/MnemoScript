//! Crypto for phone ↔ PC pairing (shared by the PC server and the phone client).
//!
//! * Pairing: the PC shows an 8-digit code; both sides run SPAKE2 with it, which yields a strong
//!   32-byte key without ever sending the code. A wrong code just fails; watching the traffic
//!   does not let anyone guess the code offline.
//! * Every later message is sealed with XChaCha20-Poly1305 under the phone's own device key
//!   (random 24-byte nonce per message). The associated data binds a message to its direction,
//!   path, device and request, so nothing can be replayed elsewhere or spliced between streams.
//! * Requests carry a timestamp and a random request id; the server refuses old or repeated ones.
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use serde::{Deserialize, Serialize};
use spake2::{Ed25519Group, Identity, Password, Spake2};

pub const PROTOCOL: &str = "mnemoscript-pair-v1";
/// UDP discovery + TCP API port (the PC falls back to a random TCP port if this one is taken).
pub const DEFAULT_PORT: u16 = 47815;
pub const DISCOVER_PROBE: &[u8] = b"MNEMOSCRIPT-DISCOVER v1";
/// Accept requests whose clock is within this window (phones and PCs sync time, loosely).
pub const MAX_SKEW_MS: i64 = 10 * 60 * 1000;

pub fn b64(bytes: &[u8]) -> String {
    B64.encode(bytes)
}

pub fn unb64(s: &str) -> Result<Vec<u8>, String> {
    B64.decode(s.trim()).map_err(|_| "Malformed message".to_string())
}

pub fn random_key() -> [u8; 32] {
    let k = XChaCha20Poly1305::generate_key(&mut OsRng);
    let mut out = [0u8; 32];
    out.copy_from_slice(&k);
    out
}

pub fn random_id() -> String {
    let mut b = [0u8; 16];
    OsRng.fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// "4821 7730": 8 random digits, shown with a space for readability.
pub fn pairing_code() -> String {
    let n = OsRng.next_u64() % 100_000_000;
    let s = format!("{n:08}");
    format!("{} {}", &s[..4], &s[4..])
}

/// Digits only, so "4821 7730", "4821-7730" and "48217730" are the same code.
pub fn normalize_code(code: &str) -> String {
    code.chars().filter(char::is_ascii_digit).collect()
}

/// One side of SPAKE2 in symmetric mode: returns the state and the message to send.
pub fn spake_start(code: &str) -> (Spake2<Ed25519Group>, Vec<u8>) {
    Spake2::<Ed25519Group>::start_symmetric(&Password::new(normalize_code(code).as_bytes()), &Identity::new(PROTOCOL.as_bytes()))
}

pub fn spake_finish(state: Spake2<Ed25519Group>, inbound: &[u8]) -> Result<[u8; 32], String> {
    let k = state.finish(inbound).map_err(|_| "Pairing failed".to_string())?;
    let mut out = [0u8; 32];
    out.copy_from_slice(k.get(..32).ok_or("Pairing failed")?);
    Ok(out)
}

/// Seals / opens messages under one 32-byte key.
#[derive(Clone)]
pub struct Sealer(XChaCha20Poly1305);

impl Sealer {
    pub fn new(key: &[u8; 32]) -> Self {
        Sealer(XChaCha20Poly1305::new(Key::from_slice(key)))
    }

    /// `nonce ‖ ciphertext`, base64url — one line on the wire.
    pub fn seal(&self, aad: &str, plaintext: &[u8]) -> String {
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        let ct = self.0.encrypt(&nonce, Payload { msg: plaintext, aad: aad.as_bytes() }).expect("encryption cannot fail");
        let mut out = nonce.to_vec();
        out.extend_from_slice(&ct);
        b64(&out)
    }

    pub fn open(&self, aad: &str, line: &str) -> Result<Vec<u8>, String> {
        let raw = unb64(line)?;
        if raw.len() < 24 + 16 {
            return Err("Malformed message".into());
        }
        let (nonce, ct) = raw.split_at(24);
        self.0
            .decrypt(XNonce::from_slice(nonce), Payload { msg: ct, aad: aad.as_bytes() })
            .map_err(|_| "This message could not be verified".to_string())
    }
}

/// What every authenticated request carries inside the seal.
#[derive(Serialize, Deserialize)]
pub struct Envelope<T> {
    pub ts: i64,
    pub rid: String,
    pub body: T,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn request_aad(path: &str, device_id: &str) -> String {
    format!("req|{path}|{device_id}")
}

/// Response lines are numbered, so a stream can't be reordered or spliced.
pub fn response_aad(rid: &str, seq: u64) -> String {
    format!("res|{rid}|{seq}")
}

pub const PAIR_AAD: &str = "pair|grant";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spake_agrees_only_on_the_same_code() {
        let (a, ma) = spake_start("4821 7730");
        let (b, mb) = spake_start("48217730");
        assert_eq!(spake_finish(a, &mb).unwrap(), spake_finish(b, &ma).unwrap());

        let (c, mc) = spake_start("4821 7730");
        let (d, md) = spake_start("4821 7731");
        assert_ne!(spake_finish(c, &md).unwrap(), spake_finish(d, &mc).unwrap());
    }

    #[test]
    fn sealed_messages_only_open_with_the_same_key_and_context() {
        let k = random_key();
        let s = Sealer::new(&k);
        let line = s.seal("req|/v1/turn|dev", b"hello");
        assert_eq!(s.open("req|/v1/turn|dev", &line).unwrap(), b"hello");
        assert!(s.open("req|/v1/tool|dev", &line).is_err(), "bound to its path");
        assert!(Sealer::new(&random_key()).open("req|/v1/turn|dev", &line).is_err(), "bound to its key");
        assert_ne!(s.seal("x", b"hello"), s.seal("x", b"hello"), "fresh nonce each time");
        let mut tampered = unb64(&line).unwrap();
        *tampered.last_mut().unwrap() ^= 1;
        assert!(s.open("req|/v1/turn|dev", &b64(&tampered)).is_err());
    }

    #[test]
    fn codes_are_eight_digits() {
        let c = pairing_code();
        assert_eq!(normalize_code(&c).len(), 8);
        assert_eq!(normalize_code("12-34 56 78"), "12345678");
    }
}
