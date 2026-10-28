//! Sealed envelope: `version || nonce:24 || ciphertext || tag:16` with XChaCha20-Poly1305 (CRYPTO.md section 3).

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

use crate::error::{CoreError, Result};
use crate::primitives::{aad, random, VERSION};

pub const NONCE_LEN: usize = 24;
pub const TAG_LEN: usize = 16;
pub const OVERHEAD: usize = 1 + NONCE_LEN + TAG_LEN;

pub fn seal(key: &[u8; 32], plaintext: &[u8], label: &str, fields: &[&[u8]]) -> Vec<u8> {
    seal_with_nonce(key, &random::<NONCE_LEN>(), plaintext, label, fields)
}

/// Deterministic variant, only for committed test vectors. Never reuse a nonce with the same key.
pub(crate) fn seal_with_nonce(
    key: &[u8; 32],
    nonce: &[u8; NONCE_LEN],
    plaintext: &[u8],
    label: &str,
    fields: &[&[u8]],
) -> Vec<u8> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let ad = aad(label, fields);
    let ct = cipher
        .encrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad: &ad,
            },
        )
        .expect("XChaCha20-Poly1305 encryption only fails for >256 GiB inputs");
    let mut out = Vec::with_capacity(1 + NONCE_LEN + ct.len());
    out.push(VERSION);
    out.extend_from_slice(nonce);
    out.extend_from_slice(&ct);
    out
}

pub fn open(key: &[u8; 32], envelope: &[u8], label: &str, fields: &[&[u8]]) -> Result<Vec<u8>> {
    if envelope.len() < OVERHEAD {
        return Err(CoreError::DecryptionFailed);
    }
    if envelope[0] != VERSION {
        return Err(CoreError::UnsupportedVersion);
    }
    let (nonce, ct) = envelope[1..].split_at(NONCE_LEN);
    let ad = aad(label, fields);
    XChaCha20Poly1305::new(key.into())
        .decrypt(XNonce::from_slice(nonce), Payload { msg: ct, aad: &ad })
        .map_err(|_| CoreError::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; 32] = [7; 32];

    #[test]
    fn round_trip() {
        let env = seal(&KEY, b"hello", "circlo/v1/test", &[&[1; 16]]);
        assert_eq!(env.len(), OVERHEAD + 5);
        assert_eq!(open(&KEY, &env, "circlo/v1/test", &[&[1; 16]]).unwrap(), b"hello");
    }

    #[test]
    fn wrong_key_label_or_field_fails() {
        let env = seal(&KEY, b"hello", "circlo/v1/test", &[&[1; 16]]);
        assert_eq!(
            open(&[8; 32], &env, "circlo/v1/test", &[&[1; 16]]),
            Err(CoreError::DecryptionFailed)
        );
        assert_eq!(
            open(&KEY, &env, "circlo/v1/other", &[&[1; 16]]),
            Err(CoreError::DecryptionFailed)
        );
        assert_eq!(
            open(&KEY, &env, "circlo/v1/test", &[&[2; 16]]),
            Err(CoreError::DecryptionFailed)
        );
    }

    #[test]
    fn every_single_bit_flip_fails() {
        let env = seal(&KEY, b"some plaintext", "circlo/v1/test", &[]);
        for i in 0..env.len() * 8 {
            let mut t = env.clone();
            t[i / 8] ^= 1 << (i % 8);
            assert!(open(&KEY, &t, "circlo/v1/test", &[]).is_err(), "bit {i}");
        }
    }

    #[test]
    fn short_inputs_fail() {
        for n in 0..OVERHEAD {
            assert!(open(&KEY, &vec![VERSION; n], "circlo/v1/test", &[]).is_err());
        }
    }
}
