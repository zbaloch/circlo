//! Encrypted blobs: profile, address book, settings, local cache, push tokens (CRYPTO.md sections 10, 13).
//! Callers pass opaque plaintext bytes (the app chooses the inner format); this layer pads and seals.

use zeroize::Zeroizing;

use crate::envelope;
use crate::error::Result;
use crate::padding::{pad, unpad};
use crate::primitives::hkdf32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum BlobKind {
    AddressBook,
    Settings,
}

impl BlobKind {
    fn label(self) -> &'static str {
        match self {
            BlobKind::AddressBook => "circlo/v1/address-book",
            BlobKind::Settings => "circlo/v1/settings",
        }
    }
}

pub fn seal_profile(profile_key: &[u8; 32], user_id: &[u8; 16], epoch_id: &[u8; 16], plain: &[u8]) -> Result<Vec<u8>> {
    let padded = Zeroizing::new(pad(plain)?);
    Ok(envelope::seal(
        &hkdf32(profile_key, "circlo/v1/profile"),
        &padded,
        "circlo/v1/profile",
        &[user_id, epoch_id],
    ))
}

pub fn open_profile(profile_key: &[u8; 32], user_id: &[u8; 16], epoch_id: &[u8; 16], ct: &[u8]) -> Result<Vec<u8>> {
    let padded = Zeroizing::new(envelope::open(
        &hkdf32(profile_key, "circlo/v1/profile"),
        ct,
        "circlo/v1/profile",
        &[user_id, epoch_id],
    )?);
    unpad(&padded)
}

pub fn seal_user_blob(data_key: &[u8; 32], kind: BlobKind, user_id: &[u8; 16], plain: &[u8]) -> Result<Vec<u8>> {
    let padded = Zeroizing::new(pad(plain)?);
    Ok(envelope::seal(
        &hkdf32(data_key, kind.label()),
        &padded,
        kind.label(),
        &[user_id],
    ))
}

pub fn open_user_blob(data_key: &[u8; 32], kind: BlobKind, user_id: &[u8; 16], ct: &[u8]) -> Result<Vec<u8>> {
    let padded = Zeroizing::new(envelope::open(
        &hkdf32(data_key, kind.label()),
        ct,
        kind.label(),
        &[user_id],
    )?);
    unpad(&padded)
}

/// Device-local cache files (decrypted thumbnails etc.); `local_cache_key` lives in Keychain/Keystore.
pub fn seal_local(local_cache_key: &[u8; 32], file_id: &[u8; 16], plain: &[u8]) -> Vec<u8> {
    envelope::seal(local_cache_key, plain, "circlo/v1/local-cache", &[file_id])
}

pub fn open_local(local_cache_key: &[u8; 32], file_id: &[u8; 16], ct: &[u8]) -> Result<Vec<u8>> {
    envelope::open(local_cache_key, ct, "circlo/v1/local-cache", &[file_id])
}

/// Server-side: push tokens at rest, sealed with `CIRCLO_PUSH_TOKEN_KEY` (kept outside the DB).
pub fn seal_push_token(push_key: &[u8; 32], device_id: &[u8; 16], token: &[u8]) -> Result<Vec<u8>> {
    let padded = Zeroizing::new(pad(token)?);
    Ok(envelope::seal(push_key, &padded, "circlo/v1/push-token", &[device_id]))
}

pub fn open_push_token(push_key: &[u8; 32], device_id: &[u8; 16], ct: &[u8]) -> Result<Vec<u8>> {
    let padded = Zeroizing::new(envelope::open(push_key, ct, "circlo/v1/push-token", &[device_id])?);
    unpad(&padded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_is_bound_to_user_and_epoch() {
        let ct = seal_profile(&[1; 32], &[2; 16], &[3; 16], b"{\"name\":\"Test\"}").unwrap();
        assert_eq!(
            open_profile(&[1; 32], &[2; 16], &[3; 16], &ct).unwrap(),
            b"{\"name\":\"Test\"}"
        );
        assert!(open_profile(&[1; 32], &[2; 16], &[4; 16], &ct).is_err());
        assert!(open_profile(&[9; 32], &[2; 16], &[3; 16], &ct).is_err());
    }

    #[test]
    fn blob_kinds_are_not_interchangeable() {
        let ct = seal_user_blob(&[1; 32], BlobKind::AddressBook, &[2; 16], b"ab").unwrap();
        assert_eq!(
            open_user_blob(&[1; 32], BlobKind::AddressBook, &[2; 16], &ct).unwrap(),
            b"ab"
        );
        assert!(open_user_blob(&[1; 32], BlobKind::Settings, &[2; 16], &ct).is_err());
    }

    #[test]
    fn push_tokens_and_local_cache() {
        let ct = seal_push_token(&[1; 32], &[2; 16], b"fcm-token-test-only").unwrap();
        assert_eq!(
            open_push_token(&[1; 32], &[2; 16], &ct).unwrap(),
            b"fcm-token-test-only"
        );
        assert!(open_push_token(&[1; 32], &[3; 16], &ct).is_err());
        let lc = seal_local(&[5; 32], &[6; 16], b"thumb");
        assert_eq!(open_local(&[5; 32], &[6; 16], &lc).unwrap(), b"thumb");
    }
}
