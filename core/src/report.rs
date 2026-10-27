//! Reports to moderators (PLAN.md Phase 11, CRYPTO.md 13c).
//!
//! The reporter's device decrypts what it is reporting (the user chose to share it) and seals the report with HPKE
//! base mode to the operator's moderation public key, signed by the reporter's identity key. The server stores the
//! ciphertext only; the operator opens it offline with the moderation private key (`halqo-moderation` CLI).

use ed25519_dalek::{Signature, Signer as _, Verifier as _, VerifyingKey};
use hpke::aead::ChaCha20Poly1305;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable, Kem, OpModeR, OpModeS, Serializable};
use zeroize::Zeroizing;

use crate::cbor::{self, Fields};
use crate::error::{invalid, CoreError, Result};
use crate::identity::Identity;
use crate::primitives::aad;

const LABEL: &str = "halqo/v1/report";
const INFO: &[u8] = b"halqo/v1/report";
pub const MAX_REPORT: usize = 4 << 20;

type PrivateKey = <X25519HkdfSha256 as Kem>::PrivateKey;
type PublicKey = <X25519HkdfSha256 as Kem>::PublicKey;
type EncappedKey = <X25519HkdfSha256 as Kem>::EncappedKey;

/// The operator's moderation key pair (keep the secret offline).
pub fn generate_moderation_keys() -> (Zeroizing<[u8; 32]>, [u8; 32]) {
    let (sk, pk) = X25519HkdfSha256::gen_keypair(&mut crate::hpke_rng());
    let mut secret = Zeroizing::new([0u8; 32]);
    secret.copy_from_slice(&sk.to_bytes());
    let mut public = [0u8; 32];
    public.copy_from_slice(&pk.to_bytes());
    (secret, public)
}

fn signed_message(reporter_id: &[u8; 16], content: &[u8]) -> Vec<u8> {
    aad(LABEL, &[reporter_id, content])
}

/// Signs and seals `content` (the report body the app assembled) for the moderators.
pub fn seal(moderation_pk: &[u8; 32], reporter: &Identity, reporter_id: &[u8; 16], content: &[u8]) -> Result<Vec<u8>> {
    if content.is_empty() || content.len() > MAX_REPORT {
        return Err(invalid("report size"));
    }
    let sig = reporter.ed25519.sign(&signed_message(reporter_id, content)).to_bytes();
    let plain = Zeroizing::new(cbor::encode(&cbor::map(vec![
        (1, cbor::bytes(content)),
        (2, cbor::bytes(reporter_id)),
        (3, cbor::bytes(&sig)),
    ])));
    let recipient = PublicKey::from_bytes(moderation_pk).map_err(|_| invalid("bad moderation key"))?;
    let (enc, ct) = hpke::single_shot_seal::<ChaCha20Poly1305, HkdfSha256, X25519HkdfSha256, _>(
        &OpModeS::Base,
        &recipient,
        INFO,
        &plain,
        LABEL.as_bytes(),
        &mut crate::hpke_rng(),
    )
    .map_err(|_| CoreError::Malformed)?;
    let mut out = enc.to_bytes().to_vec();
    out.extend_from_slice(&ct);
    Ok(out)
}

pub struct OpenedReport {
    pub content: Vec<u8>,
    pub reporter_id: [u8; 16],
    pub signature: [u8; 64],
}

impl OpenedReport {
    /// Checks the reporter's signature against their identity key (looked up by the operator).
    pub fn verify(&self, reporter_ed25519_pk: &[u8; 32]) -> Result<()> {
        let pk = VerifyingKey::from_bytes(reporter_ed25519_pk).map_err(|_| CoreError::BadSignature)?;
        pk.verify(
            &signed_message(&self.reporter_id, &self.content),
            &Signature::from_bytes(&self.signature),
        )
        .map_err(|_| CoreError::BadSignature)
    }
}

/// Operator side: opens a sealed report with the moderation secret key.
pub fn open(moderation_sk: &[u8; 32], sealed: &[u8]) -> Result<OpenedReport> {
    if sealed.len() < 32 + 16 {
        return Err(CoreError::DecryptionFailed);
    }
    let sk = PrivateKey::from_bytes(moderation_sk).map_err(|_| invalid("bad moderation key"))?;
    let enc = EncappedKey::from_bytes(&sealed[..32]).map_err(|_| CoreError::DecryptionFailed)?;
    let plain = Zeroizing::new(
        hpke::single_shot_open::<ChaCha20Poly1305, HkdfSha256, X25519HkdfSha256>(
            &OpModeR::Base,
            &sk,
            &enc,
            INFO,
            &sealed[32..],
            LABEL.as_bytes(),
        )
        .map_err(|_| CoreError::DecryptionFailed)?,
    );
    let mut f = Fields::parse(cbor::decode(&plain)?, &[1, 2, 3])?;
    let content = match f.take(1)? {
        ciborium::Value::Bytes(b) => b,
        _ => return Err(CoreError::Malformed),
    };
    Ok(OpenedReport {
        content,
        reporter_id: f.fixed(2)?,
        signature: f.fixed(3)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::primitives::random;

    #[test]
    fn sealed_for_moderators_and_signed_by_the_reporter() {
        let (sk, pk) = generate_moderation_keys();
        let reporter = Identity::generate();
        let reporter_id: [u8; 16] = random();
        let content = br#"{"kind":"post","text":"something abusive"}"#;
        let sealed = seal(&pk, &reporter, &reporter_id, content).unwrap();
        assert!(
            !sealed.windows(9).any(|w| w == b"something"),
            "server sees ciphertext only"
        );

        let opened = open(&sk, &sealed).unwrap();
        assert_eq!(opened.content, content);
        assert_eq!(opened.reporter_id, reporter_id);
        opened.verify(&reporter.ed25519_pk_bytes()).unwrap();
        assert!(
            opened.verify(&Identity::generate().ed25519_pk_bytes()).is_err(),
            "wrong reporter key"
        );

        assert!(
            open(&generate_moderation_keys().0, &sealed).is_err(),
            "other moderation key"
        );
        let mut bad = sealed.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(open(&sk, &bad).is_err(), "tampered");
        assert!(seal(&pk, &reporter, &reporter_id, b"").is_err());
    }
}
