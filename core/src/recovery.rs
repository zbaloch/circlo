//! Recovery methods and recovery authentication (CRYPTO.md sections 6.3 and 6.4).
//!
//! Every method has a 32-byte recovery root that seals a recovery copy of the key backup and derives the Ed25519 key
//! the server checks at recovery login. The kinds use separate labels:
//! - a phrase: 24 words (the root is the BIP39 entropy, as before) or 12 words (root = HKDF of the 16-byte entropy);
//! - a passkey: the root is the passkey's PRF output for [`passkey_prf_salt`]; it never leaves the phone.

use bip39::{Language, Mnemonic};
use ed25519_dalek::SigningKey;
use zeroize::Zeroizing;

use crate::error::{CoreError, Result};
use crate::identity::{sign, verify};
use crate::primitives::{hkdf32, labelled, random_secret, sha256};

/// How a recovery root was obtained; selects the derivation labels and the backup kind byte.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryKind {
    Phrase,
    Passkey,
}

impl RecoveryKind {
    fn auth_label(self) -> &'static str {
        match self {
            RecoveryKind::Phrase => "circlo/v1/recovery-auth",
            RecoveryKind::Passkey => "circlo/v1/passkey-auth",
        }
    }
}

pub fn new_entropy() -> Zeroizing<[u8; 32]> {
    random_secret()
}

/// A new 12-word phrase (128-bit entropy) and its recovery root.
pub fn new_phrase_12() -> (Zeroizing<String>, Zeroizing<[u8; 32]>) {
    let entropy: Zeroizing<[u8; 16]> = random_secret();
    let m = Mnemonic::from_entropy_in(Language::English, &*entropy).expect("16 bytes is valid BIP39 entropy");
    (Zeroizing::new(m.to_string()), root_128(&entropy))
}

fn root_128(entropy: &[u8; 16]) -> Zeroizing<[u8; 32]> {
    hkdf32(entropy, "circlo/v1/recovery-root-128")
}

/// The fixed PRF input for passkey recovery. The PRF output for it (32 bytes) is the passkey method's root.
pub fn passkey_prf_salt() -> [u8; 32] {
    sha256(&[b"circlo/v1/passkey-prf"])
}

/// 24 space-separated English words.
pub fn phrase_from_entropy(entropy: &[u8; 32]) -> Zeroizing<String> {
    let m = Mnemonic::from_entropy_in(Language::English, entropy).expect("32 bytes is valid BIP39 entropy");
    Zeroizing::new(m.to_string())
}

/// The recovery root of a 12- or 24-word phrase. Accepts any case and whitespace; rejects wrong words, other word
/// counts and bad checksums.
pub fn entropy_from_phrase(phrase: &str) -> Result<Zeroizing<[u8; 32]>> {
    let normalized = Zeroizing::new(phrase.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase());
    let m = Mnemonic::parse_in(Language::English, normalized.as_str()).map_err(|_| CoreError::InvalidInput {
        reason: "recovery phrase is not valid".into(),
    })?;
    let (bytes, len) = m.to_entropy_array();
    let bytes = Zeroizing::new(bytes);
    match len {
        32 => Ok(Zeroizing::new(bytes[..32].try_into().expect("32 bytes"))),
        16 => Ok(root_128(&bytes[..16].try_into().expect("16 bytes"))),
        _ => Err(CoreError::InvalidInput {
            reason: "recovery phrase must have 12 or 24 words".into(),
        }),
    }
}

fn signing_key(kind: RecoveryKind, root: &[u8; 32]) -> SigningKey {
    SigningKey::from_bytes(&hkdf32(root, kind.auth_label()))
}

/// The public key the server checks at recovery login for this method.
pub fn method_public_key(kind: RecoveryKind, root: &[u8; 32]) -> [u8; 32] {
    signing_key(kind, root).verifying_key().to_bytes()
}

/// A phrase method's public key.
pub fn recovery_public_key(entropy: &[u8; 32]) -> [u8; 32] {
    method_public_key(RecoveryKind::Phrase, entropy)
}

fn login_msg(user_id: &[u8; 16], challenge_id: &[u8; 16], nonce: &[u8; 32], expires_at: u64) -> Vec<u8> {
    labelled(
        "circlo/v1/recovery-login",
        &[user_id, challenge_id, nonce, &expires_at.to_be_bytes()],
    )
}

pub fn sign_method_login(
    kind: RecoveryKind,
    root: &[u8; 32],
    user_id: &[u8; 16],
    challenge_id: &[u8; 16],
    nonce: &[u8; 32],
    expires_at: u64,
) -> [u8; 64] {
    sign(
        &signing_key(kind, root),
        &login_msg(user_id, challenge_id, nonce, expires_at),
    )
}

pub fn sign_recovery_login(
    entropy: &[u8; 32],
    user_id: &[u8; 16],
    challenge_id: &[u8; 16],
    nonce: &[u8; 32],
    expires_at: u64,
) -> [u8; 64] {
    sign_method_login(RecoveryKind::Phrase, entropy, user_id, challenge_id, nonce, expires_at)
}

/// Server-side check (via JNI). Expiry and single use are enforced by the server.
pub fn verify_recovery_login(
    recovery_pubkey: &[u8; 32],
    user_id: &[u8; 16],
    challenge_id: &[u8; 16],
    nonce: &[u8; 32],
    expires_at: u64,
    sig: &[u8; 64],
) -> Result<()> {
    verify(
        recovery_pubkey,
        &login_msg(user_id, challenge_id, nonce, expires_at),
        sig,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phrase_round_trip_tolerates_case_and_spacing() {
        let e = new_entropy();
        let phrase = phrase_from_entropy(&e);
        assert_eq!(phrase.split(' ').count(), 24);
        let messy = format!("  {}  ", phrase.to_uppercase().replace(' ', "\n  "));
        assert_eq!(*entropy_from_phrase(&messy).unwrap(), *e);
    }

    #[test]
    fn bip39_reference_vector() {
        // Trezor BIP39 vector: entropy 0x00 * 32.
        let phrase = phrase_from_entropy(&[0; 32]);
        assert_eq!(
            phrase.as_str(),
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"
        );
    }

    #[test]
    fn rejects_bad_checksum_and_other_lengths() {
        let phrase = phrase_from_entropy(&[0; 32]);
        assert!(entropy_from_phrase(&phrase.replace(" art", " abandon")).is_err());
        // 15 words (160-bit) is valid BIP39 but not a Circlo phrase.
        let fifteen =
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
                       abandon abandon address";
        assert!(entropy_from_phrase(fifteen).is_err());
        assert!(entropy_from_phrase("not a phrase").is_err());
    }

    #[test]
    fn twelve_word_phrases_round_trip_to_a_root() {
        let (phrase, root) = new_phrase_12();
        assert_eq!(phrase.split(' ').count(), 12);
        assert_eq!(*entropy_from_phrase(&phrase.to_uppercase()).unwrap(), *root);
        // BIP39 vector: 16 zero bytes. The root is derived from the entropy, not the entropy itself.
        let twelve = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        assert_eq!(*entropy_from_phrase(twelve).unwrap(), *root_128(&[0; 16]));
        assert_ne!(*entropy_from_phrase(twelve).unwrap(), [0; 32]);
    }

    #[test]
    fn method_kinds_derive_different_keys_from_the_same_root() {
        let root = [7; 32];
        assert_eq!(
            recovery_public_key(&root),
            method_public_key(RecoveryKind::Phrase, &root)
        );
        assert_ne!(
            method_public_key(RecoveryKind::Phrase, &root),
            method_public_key(RecoveryKind::Passkey, &root)
        );
        let pk = method_public_key(RecoveryKind::Passkey, &root);
        let sig = sign_method_login(RecoveryKind::Passkey, &root, &[1; 16], &[2; 16], &[3; 32], 99);
        assert!(verify_recovery_login(&pk, &[1; 16], &[2; 16], &[3; 32], 99, &sig).is_ok());
        assert!(verify_recovery_login(&recovery_public_key(&root), &[1; 16], &[2; 16], &[3; 32], 99, &sig).is_err());
    }

    #[test]
    fn passkey_prf_salt_is_fixed() {
        assert_eq!(passkey_prf_salt(), sha256(&[b"circlo/v1/passkey-prf"]));
    }

    #[test]
    fn recovery_login_signature() {
        let e = new_entropy();
        let pk = recovery_public_key(&e);
        let sig = sign_recovery_login(&e, &[1; 16], &[2; 16], &[3; 32], 99);
        assert!(verify_recovery_login(&pk, &[1; 16], &[2; 16], &[3; 32], 99, &sig).is_ok());
        assert!(verify_recovery_login(&pk, &[1; 16], &[2; 16], &[3; 32], 100, &sig).is_err());
        assert!(verify_recovery_login(&pk, &[9; 16], &[2; 16], &[3; 32], 99, &sig).is_err());
    }
}
