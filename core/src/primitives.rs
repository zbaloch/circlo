//! Thin wrappers over the audited crates: randomness, HKDF, HMAC, SHA-256, AAD (CRYPTO.md sections 2–3).

use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

/// Format version used in every envelope and AAD (CRYPTO.md section 3).
pub const VERSION: u8 = 0x01;

pub fn random<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    OsRng.fill_bytes(&mut out);
    out
}

pub fn random_secret<const N: usize>() -> Zeroizing<[u8; N]> {
    let mut out = Zeroizing::new([0u8; N]);
    OsRng.fill_bytes(&mut *out);
    out
}

/// HKDF-SHA256, empty salt, 32-byte output.
pub fn hkdf32(ikm: &[u8], info: &str) -> Zeroizing<[u8; 32]> {
    let mut out = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(None, ikm)
        .expand(info.as_bytes(), &mut *out)
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    out
}

pub fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC accepts any key length");
    for p in parts {
        mac.update(p);
    }
    mac.finalize().into_bytes().into()
}

pub fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

/// `label || 0x00 || fields... || version`. All fields are fixed-length by construction.
pub fn aad(label: &str, fields: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(label.len() + 2 + fields.iter().map(|f| f.len()).sum::<usize>());
    out.extend_from_slice(label.as_bytes());
    out.push(0x00);
    for f in fields {
        out.extend_from_slice(f);
    }
    out.push(VERSION);
    out
}

/// `label || 0x00 || parts...`: the message format for signatures and MAC inputs.
pub fn labelled(label: &str, parts: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(label.as_bytes());
    out.push(0x00);
    for p in parts {
        out.extend_from_slice(p);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aad_layout() {
        assert_eq!(
            aad("halqo/v1/x", &[&[1, 2], &[3]]),
            b"halqo/v1/x\x00\x01\x02\x03\x01".to_vec()
        );
    }

    #[test]
    fn hkdf_matches_rfc5869_with_empty_salt() {
        // RFC 5869 test case 3 (empty salt, empty info) truncated to 32 bytes.
        let ikm = [0x0b; 22];
        let okm = hkdf32(&ikm, "");
        assert_eq!(
            hex::encode(*okm),
            "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d"
        );
    }
}
