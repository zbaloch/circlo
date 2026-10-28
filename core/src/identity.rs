//! Identity and device keys, signatures (CRYPTO.md section 7).

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable, Kem, Serializable};
use zeroize::Zeroizing;

use crate::error::{CoreError, Result};
use crate::primitives::labelled;

pub type X25519Sk = <X25519HkdfSha256 as Kem>::PrivateKey;
pub type X25519Pk = <X25519HkdfSha256 as Kem>::PublicKey;

/// A user's identity: one X25519 key (HPKE) and one Ed25519 key (signatures).
pub struct Identity {
    pub x25519_sk: X25519Sk,
    pub x25519_pk: X25519Pk,
    pub ed25519: SigningKey,
}

impl Identity {
    pub fn generate() -> Self {
        let (x25519_sk, x25519_pk) = X25519HkdfSha256::gen_keypair(&mut crate::hpke_rng());
        let ed25519 = SigningKey::generate(&mut rand_core::OsRng);
        Identity {
            x25519_sk,
            x25519_pk,
            ed25519,
        }
    }

    pub fn from_secrets(x25519_sk: &[u8; 32], ed25519_sk: &[u8; 32]) -> Result<Self> {
        let x25519_sk = X25519Sk::from_bytes(x25519_sk).map_err(|_| CoreError::Malformed)?;
        let x25519_pk = X25519HkdfSha256::sk_to_pk(&x25519_sk);
        Ok(Identity {
            x25519_sk,
            x25519_pk,
            ed25519: SigningKey::from_bytes(ed25519_sk),
        })
    }

    pub fn x25519_sk_bytes(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.x25519_sk.to_bytes().into())
    }

    pub fn x25519_pk_bytes(&self) -> [u8; 32] {
        self.x25519_pk.to_bytes().into()
    }

    pub fn ed25519_sk_bytes(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.ed25519.to_bytes())
    }

    pub fn ed25519_pk_bytes(&self) -> [u8; 32] {
        self.ed25519.verifying_key().to_bytes()
    }

    /// Signature binding the X25519 key to the Ed25519 identity.
    pub fn identity_sig(&self, user_id: &[u8; 16], version: u8) -> [u8; 64] {
        sign(&self.ed25519, &identity_msg(user_id, version, &self.x25519_pk_bytes()))
    }

    pub fn device_cert(&self, user_id: &[u8; 16], device_id: &[u8; 16], device_pk: &[u8; 32]) -> [u8; 64] {
        sign(
            &self.ed25519,
            &labelled("circlo/v1/device", &[user_id, device_id, device_pk]),
        )
    }
}

fn identity_msg(user_id: &[u8; 16], version: u8, x25519_pk: &[u8; 32]) -> Vec<u8> {
    labelled("circlo/v1/identity", &[user_id, &[version], x25519_pk])
}

pub fn verify_identity_sig(
    ed25519_pk: &[u8; 32],
    user_id: &[u8; 16],
    version: u8,
    x25519_pk: &[u8; 32],
    sig: &[u8; 64],
) -> Result<()> {
    verify(ed25519_pk, &identity_msg(user_id, version, x25519_pk), sig)
}

pub fn verify_device_cert(
    identity_pk: &[u8; 32],
    user_id: &[u8; 16],
    device_id: &[u8; 16],
    device_pk: &[u8; 32],
    sig: &[u8; 64],
) -> Result<()> {
    verify(
        identity_pk,
        &labelled("circlo/v1/device", &[user_id, device_id, device_pk]),
        sig,
    )
}

pub fn generate_signing_key() -> SigningKey {
    SigningKey::generate(&mut rand_core::OsRng)
}

pub fn sign(key: &SigningKey, msg: &[u8]) -> [u8; 64] {
    key.sign(msg).to_bytes()
}

/// Strict Ed25519 verification (rejects small-order keys and non-canonical signatures).
pub fn verify(pk: &[u8; 32], msg: &[u8], sig: &[u8; 64]) -> Result<()> {
    let vk = VerifyingKey::from_bytes(pk).map_err(|_| CoreError::BadSignature)?;
    vk.verify_strict(msg, &Signature::from_bytes(sig))
        .map_err(|_| CoreError::BadSignature)
}

pub fn x25519_pk_from_bytes(bytes: &[u8; 32]) -> Result<X25519Pk> {
    X25519Pk::from_bytes(bytes).map_err(|_| CoreError::Malformed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_round_trip() {
        let id = Identity::generate();
        let back = Identity::from_secrets(&id.x25519_sk_bytes(), &id.ed25519_sk_bytes()).unwrap();
        assert_eq!(back.x25519_pk_bytes(), id.x25519_pk_bytes());
        assert_eq!(back.ed25519_pk_bytes(), id.ed25519_pk_bytes());
    }

    #[test]
    fn identity_sig_binds_user_version_and_key() {
        let id = Identity::generate();
        let sig = id.identity_sig(&[1; 16], 1);
        let (ed, x) = (id.ed25519_pk_bytes(), id.x25519_pk_bytes());
        assert!(verify_identity_sig(&ed, &[1; 16], 1, &x, &sig).is_ok());
        assert!(verify_identity_sig(&ed, &[2; 16], 1, &x, &sig).is_err());
        assert!(verify_identity_sig(&ed, &[1; 16], 2, &x, &sig).is_err());
        assert!(verify_identity_sig(&ed, &[1; 16], 1, &[9; 32], &sig).is_err());
    }

    #[test]
    fn device_cert_verifies_only_for_that_device() {
        let id = Identity::generate();
        let dev = generate_signing_key().verifying_key().to_bytes();
        let cert = id.device_cert(&[1; 16], &[2; 16], &dev);
        assert!(verify_device_cert(&id.ed25519_pk_bytes(), &[1; 16], &[2; 16], &dev, &cert).is_ok());
        assert!(verify_device_cert(&id.ed25519_pk_bytes(), &[1; 16], &[3; 16], &dev, &cert).is_err());
    }
}
