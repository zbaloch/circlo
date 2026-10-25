//! Handles, invites, fingerprints and safety numbers (CRYPTO.md sections 5.1 and 12).

use unicode_normalization::UnicodeNormalization;

use crate::error::{invalid, Result};
use crate::primitives::{hmac_sha256, labelled, sha256};

/// `NFKC(lowercase(trim(handle)))`, then 3–30 chars of `[a-z0-9_]`.
pub fn normalize_handle(handle: &str) -> Result<String> {
    let n: String = handle.trim().to_lowercase().nfkc().collect();
    let ok_len = (3..=30).contains(&n.chars().count());
    if !ok_len
        || !n
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(invalid("handle must be 3-30 characters: letters, digits or _"));
    }
    Ok(n)
}

/// Server-side: `HMAC(HANDLE_KEY, "halqo/v1/handle" || 0x00 || normalize(handle))`.
pub fn handle_lookup(handle_key: &[u8; 32], handle: &str) -> Result<[u8; 32]> {
    let n = normalize_handle(handle)?;
    Ok(hmac_sha256(
        handle_key,
        &[&labelled("halqo/v1/handle", &[n.as_bytes()])],
    ))
}

/// Public-key fingerprint carried in invite links (URL fragment, never sent to the server).
pub fn fingerprint(ed25519_pk: &[u8; 32], x25519_pk: &[u8; 32]) -> [u8; 16] {
    sha256(&[&labelled("halqo/v1/fingerprint", &[ed25519_pk, x25519_pk])])[..16]
        .try_into()
        .expect("16 bytes")
}

/// What the server stores for an invite token.
pub fn invite_token_hash(token: &[u8; 32]) -> [u8; 32] {
    sha256(&[&labelled("halqo/v1/invite", &[token])])
}

const ITERATIONS: usize = 5200;

fn safety_hash(user_id: &[u8; 16], ed25519_pk: &[u8; 32], x25519_pk: &[u8; 32]) -> [u8; 32] {
    let mut h = sha256(&[&labelled("halqo/v1/safety-number", &[user_id]), ed25519_pk, x25519_pk]);
    for _ in 1..ITERATIONS {
        h = sha256(&[&h, ed25519_pk, x25519_pk]);
    }
    h
}

fn digits(h: &[u8; 32]) -> String {
    (0..6)
        .map(|i| {
            let mut v = 0u64;
            for b in &h[5 * i..5 * i + 5] {
                v = (v << 8) | u64::from(*b);
            }
            format!("{:05}", v % 100_000)
        })
        .collect()
}

pub struct SafetyNumber {
    /// 60 digits.
    pub digits: String,
    /// QR payload: `0x01 || first 30 bytes of each hash`, same order as the digits.
    pub qr: Vec<u8>,
}

/// Same result on both sides, regardless of who is "A".
pub fn safety_number(a: (&[u8; 16], &[u8; 32], &[u8; 32]), b: (&[u8; 16], &[u8; 32], &[u8; 32])) -> SafetyNumber {
    let ha = safety_hash(a.0, a.1, a.2);
    let hb = safety_hash(b.0, b.1, b.2);
    let (da, db) = (digits(&ha), digits(&hb));
    let ((d1, h1), (d2, h2)) = if da <= db {
        ((da, ha), (db, hb))
    } else {
        ((db, hb), (da, ha))
    };
    let mut qr = vec![0x01];
    qr.extend_from_slice(&h1[..30]);
    qr.extend_from_slice(&h2[..30]);
    SafetyNumber { digits: d1 + &d2, qr }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handle_normalization() {
        assert_eq!(normalize_handle("  Zaheer_01 ").unwrap(), "zaheer_01");
        assert_eq!(normalize_handle("ＡＢＣ").unwrap(), "abc"); // full-width → ASCII via NFKC
        for bad in ["ab", "a b c", "zaheer!", "émile", &"x".repeat(31)] {
            assert!(normalize_handle(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn handle_lookup_is_keyed_and_case_insensitive() {
        let a = handle_lookup(&[1; 32], "Alice").unwrap();
        assert_eq!(a, handle_lookup(&[1; 32], "alice").unwrap());
        assert_ne!(a, handle_lookup(&[2; 32], "alice").unwrap());
    }

    #[test]
    fn safety_number_is_symmetric_and_key_sensitive() {
        let a = ([1u8; 16], [2u8; 32], [3u8; 32]);
        let b = ([4u8; 16], [5u8; 32], [6u8; 32]);
        let ab = safety_number((&a.0, &a.1, &a.2), (&b.0, &b.1, &b.2));
        let ba = safety_number((&b.0, &b.1, &b.2), (&a.0, &a.1, &a.2));
        assert_eq!(ab.digits, ba.digits);
        assert_eq!(ab.qr, ba.qr);
        assert_eq!(ab.digits.len(), 60);
        assert!(ab.digits.chars().all(|c| c.is_ascii_digit()));
        assert_eq!(ab.qr.len(), 61);
        let changed = safety_number((&a.0, &[9; 32], &a.2), (&b.0, &b.1, &b.2));
        assert_ne!(ab.digits, changed.digits);
    }
}
