//! BIP39 recovery phrase and recovery authentication (CRYPTO.md section 6.3).

use bip39::{Language, Mnemonic};
use ed25519_dalek::SigningKey;
use zeroize::Zeroizing;

use crate::error::{CoreError, Result};
use crate::identity::{sign, verify};
use crate::primitives::{hkdf32, labelled, random_secret};

pub fn new_entropy() -> Zeroizing<[u8; 32]> {
    random_secret()
}

/// 24 space-separated English words.
pub fn phrase_from_entropy(entropy: &[u8; 32]) -> Zeroizing<String> {
    let m = Mnemonic::from_entropy_in(Language::English, entropy).expect("32 bytes is valid BIP39 entropy");
    Zeroizing::new(m.to_string())
}

/// Accepts any case and whitespace; rejects wrong words, wrong word count and bad checksums.
pub fn entropy_from_phrase(phrase: &str) -> Result<Zeroizing<[u8; 32]>> {
    let normalized = Zeroizing::new(phrase.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase());
    let m = Mnemonic::parse_in(Language::English, normalized.as_str()).map_err(|_| CoreError::InvalidInput {
        reason: "recovery phrase is not valid".into(),
    })?;
    let (bytes, len) = m.to_entropy_array();
    let bytes = Zeroizing::new(bytes);
    if len != 32 {
        return Err(CoreError::InvalidInput {
            reason: "recovery phrase must have 24 words".into(),
        });
    }
    Ok(Zeroizing::new(bytes[..32].try_into().expect("32 bytes")))
}

fn recovery_signing_key(entropy: &[u8; 32]) -> SigningKey {
    SigningKey::from_bytes(&hkdf32(entropy, "circlo/v1/recovery-auth"))
}

/// Stored by the server as `users.recovery_pubkey`.
pub fn recovery_public_key(entropy: &[u8; 32]) -> [u8; 32] {
    recovery_signing_key(entropy).verifying_key().to_bytes()
}

fn login_msg(user_id: &[u8; 16], challenge_id: &[u8; 16], nonce: &[u8; 32], expires_at: u64) -> Vec<u8> {
    labelled(
        "circlo/v1/recovery-login",
        &[user_id, challenge_id, nonce, &expires_at.to_be_bytes()],
    )
}

pub fn sign_recovery_login(
    entropy: &[u8; 32],
    user_id: &[u8; 16],
    challenge_id: &[u8; 16],
    nonce: &[u8; 32],
    expires_at: u64,
) -> [u8; 64] {
    sign(
        &recovery_signing_key(entropy),
        &login_msg(user_id, challenge_id, nonce, expires_at),
    )
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
    fn rejects_bad_checksum_and_short_phrases() {
        let phrase = phrase_from_entropy(&[0; 32]);
        assert!(entropy_from_phrase(&phrase.replace(" art", " abandon")).is_err());
        let twelve = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        assert!(entropy_from_phrase(twelve).is_err());
        assert!(entropy_from_phrase("not a phrase").is_err());
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
