//! Linking a new device by QR code (CRYPTO.md 13b).
//!
//! The new device shows a QR code with a random `link_id` and a fresh X25519 public key. The signed-in device seals
//! the account secrets (the same payload as the key backup, plus the handle) to that key with HPKE (base mode),
//! binding `link_id` and `user_id` as associated data, and the server relays the ciphertext once. Both screens show a
//! 6-digit code derived from the new device's key, so the user can confirm they scanned their own new phone.

use hpke::aead::ChaCha20Poly1305;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable, Kem, OpModeR, OpModeS, Serializable};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::backup::BackupPayload;
use crate::cbor::{self, Fields};
use crate::error::{invalid, CoreError, Result};
use crate::primitives::aad;

const LABEL: &str = "halqo/v1/device-link";
const SAS_LABEL: &str = "halqo/v1/device-link-code";
const INFO: &[u8] = b"halqo/v1/device-link";
const MAX_HANDLE: usize = 64;

type PrivateKey = <X25519HkdfSha256 as Kem>::PrivateKey;
type PublicKey = <X25519HkdfSha256 as Kem>::PublicKey;
type EncappedKey = <X25519HkdfSha256 as Kem>::EncappedKey;

/// The new device's one-time key pair for receiving the hand-off.
pub struct LinkKeys {
    pub secret: Zeroizing<[u8; 32]>,
    pub public: [u8; 32],
}

pub fn generate() -> LinkKeys {
    let (sk, pk) = X25519HkdfSha256::gen_keypair(&mut crate::hpke_rng());
    let mut secret = Zeroizing::new([0u8; 32]);
    secret.copy_from_slice(&sk.to_bytes());
    let mut public = [0u8; 32];
    public.copy_from_slice(&pk.to_bytes());
    LinkKeys { secret, public }
}

/// Six digits both screens show, derived from the new device's link key.
pub fn confirmation_code(link_pk: &[u8; 32]) -> String {
    let mut h = Sha256::new();
    h.update(aad(SAS_LABEL, &[link_pk]));
    let d = h.finalize();
    format!("{:06}", u32::from_be_bytes([d[0], d[1], d[2], d[3]]) % 1_000_000)
}

pub struct LinkPayload {
    pub backup: BackupPayload,
    pub handle: String,
}

pub fn seal(link_pk: &[u8; 32], link_id: &[u8; 32], user_id: &[u8; 16], p: &LinkPayload) -> Result<Vec<u8>> {
    if p.handle.is_empty() || p.handle.len() > MAX_HANDLE {
        return Err(invalid("bad handle"));
    }
    let recipient = PublicKey::from_bytes(link_pk).map_err(|_| invalid("bad link key"))?;
    let backup = p.backup.encode()?;
    let plain = Zeroizing::new(cbor::encode(&cbor::map(vec![
        (1, cbor::bytes(&backup)),
        (2, ciborium::Value::Text(p.handle.clone())),
    ])));
    let (enc, ct) = hpke::single_shot_seal::<ChaCha20Poly1305, HkdfSha256, X25519HkdfSha256, _>(
        &OpModeS::Base,
        &recipient,
        INFO,
        &plain,
        &aad(LABEL, &[link_id, user_id]),
        &mut crate::hpke_rng(),
    )
    .map_err(|_| CoreError::Malformed)?;
    let mut out = enc.to_bytes().to_vec();
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn open(link_sk: &[u8; 32], link_id: &[u8; 32], user_id: &[u8; 16], sealed: &[u8]) -> Result<LinkPayload> {
    if sealed.len() < 32 + 16 {
        return Err(CoreError::DecryptionFailed);
    }
    let sk = PrivateKey::from_bytes(link_sk).map_err(|_| invalid("bad link key"))?;
    let enc = EncappedKey::from_bytes(&sealed[..32]).map_err(|_| CoreError::DecryptionFailed)?;
    let plain = Zeroizing::new(
        hpke::single_shot_open::<ChaCha20Poly1305, HkdfSha256, X25519HkdfSha256>(
            &OpModeR::Base,
            &sk,
            &enc,
            INFO,
            &sealed[32..],
            &aad(LABEL, &[link_id, user_id]),
        )
        .map_err(|_| CoreError::DecryptionFailed)?,
    );
    let mut f = Fields::parse(cbor::decode(&plain)?, &[1, 2])?;
    let backup_bytes = match f.take(1)? {
        ciborium::Value::Bytes(b) => Zeroizing::new(b),
        _ => return Err(CoreError::Malformed),
    };
    Ok(LinkPayload {
        backup: BackupPayload::decode(&backup_bytes)?,
        handle: f.text(2, MAX_HANDLE)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::primitives::random;

    fn payload() -> LinkPayload {
        LinkPayload {
            backup: BackupPayload {
                x25519_sk: Zeroizing::new(random()),
                ed25519_sk: Zeroizing::new(random()),
                data_key: Zeroizing::new(random()),
                local_root: Zeroizing::new(random()),
                epochs: vec![],
            },
            handle: "alice".into(),
        }
    }

    #[test]
    fn hand_off_round_trips_and_is_bound_to_link_and_user() {
        let keys = generate();
        let (link_id, user_id): ([u8; 32], [u8; 16]) = (random(), random());
        let p = payload();
        let sealed = seal(&keys.public, &link_id, &user_id, &p).unwrap();
        let back = open(&keys.secret, &link_id, &user_id, &sealed).unwrap();
        assert_eq!(back.handle, "alice");
        assert_eq!(*back.backup.ed25519_sk, *p.backup.ed25519_sk);
        assert_eq!(*back.backup.data_key, *p.backup.data_key);

        assert!(
            open(&keys.secret, &random(), &user_id, &sealed).is_err(),
            "other link id"
        );
        assert!(open(&keys.secret, &link_id, &random(), &sealed).is_err(), "other user");
        assert!(
            open(&generate().secret, &link_id, &user_id, &sealed).is_err(),
            "someone else's QR key"
        );
        let mut bad = sealed.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(open(&keys.secret, &link_id, &user_id, &bad).is_err(), "tampered");
    }

    #[test]
    fn confirmation_code_is_six_digits_and_key_specific() {
        let a = generate();
        let code = confirmation_code(&a.public);
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
        assert_eq!(code, confirmation_code(&a.public));
        assert_ne!(code, confirmation_code(&generate().public));
    }
}
