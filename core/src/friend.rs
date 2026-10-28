//! Friend payload: one fixed-size HPKE (Auth mode) ciphertext per friend (CRYPTO.md section 8.3).

use hpke::aead::ChaCha20Poly1305;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable, Kem, OpModeR, OpModeS, Serializable};
use zeroize::Zeroizing;

use crate::chain::CircleKey;
use crate::error::{CoreError, Result};
use crate::identity::{x25519_pk_from_bytes, Identity, X25519Sk};
use crate::primitives::{aad, VERSION};

pub const PLAINTEXT_LEN: usize = 112;
pub const PAYLOAD_LEN: usize = 32 + PLAINTEXT_LEN + 16;
const INFO: &[u8] = b"circlo/v1/friend-payload";
const LABEL: &str = "circlo/v1/friend-payload";

type EncappedKey = <X25519HkdfSha256 as Kem>::EncappedKey;

pub struct FriendPayload {
    pub epoch_id: [u8; 16],
    pub circle_key: CircleKey,
    pub profile_key: Zeroizing<[u8; 32]>,
}

fn encode(p: &FriendPayload) -> Zeroizing<[u8; PLAINTEXT_LEN]> {
    let mut out = Zeroizing::new([0u8; PLAINTEXT_LEN]);
    out[0] = VERSION;
    out[16..32].copy_from_slice(&p.epoch_id);
    out[32..64].copy_from_slice(p.circle_key.as_bytes());
    out[64..96].copy_from_slice(&*p.profile_key);
    out
}

pub fn seal(
    sender: &Identity,
    recipient_x25519_pk: &[u8; 32],
    from_user: &[u8; 16],
    to_user: &[u8; 16],
    payload: &FriendPayload,
) -> Result<Vec<u8>> {
    let recipient = x25519_pk_from_bytes(recipient_x25519_pk)?;
    let mode = OpModeS::Auth((clone_sk(&sender.x25519_sk)?, sender.x25519_pk.clone()));
    let ad = aad(LABEL, &[from_user, to_user, &payload.epoch_id]);
    let pt = encode(payload);
    let (enc, ct) = hpke::single_shot_seal::<ChaCha20Poly1305, HkdfSha256, X25519HkdfSha256, _>(
        &mode,
        &recipient,
        INFO,
        &*pt,
        &ad,
        &mut crate::hpke_rng(),
    )
    .map_err(|_| CoreError::Malformed)?;
    let mut out = Vec::with_capacity(PAYLOAD_LEN);
    out.extend_from_slice(&enc.to_bytes());
    out.extend_from_slice(&ct);
    debug_assert_eq!(out.len(), PAYLOAD_LEN);
    Ok(out)
}

/// `epoch_id` comes from the server row; it must match the authenticated copy inside.
pub fn open(
    recipient: &Identity,
    sender_x25519_pk: &[u8; 32],
    from_user: &[u8; 16],
    to_user: &[u8; 16],
    epoch_id: &[u8; 16],
    bytes: &[u8],
) -> Result<FriendPayload> {
    if bytes.len() != PAYLOAD_LEN {
        return Err(CoreError::DecryptionFailed);
    }
    let sender = x25519_pk_from_bytes(sender_x25519_pk)?;
    let enc = EncappedKey::from_bytes(&bytes[..32]).map_err(|_| CoreError::DecryptionFailed)?;
    let ad = aad(LABEL, &[from_user, to_user, epoch_id]);
    let pt = Zeroizing::new(
        hpke::single_shot_open::<ChaCha20Poly1305, HkdfSha256, X25519HkdfSha256>(
            &OpModeR::Auth(sender),
            &recipient.x25519_sk,
            &enc,
            INFO,
            &bytes[32..],
            &ad,
        )
        .map_err(|_| CoreError::DecryptionFailed)?,
    );
    if pt.len() != PLAINTEXT_LEN || pt[0] != VERSION {
        return Err(CoreError::UnsupportedVersion);
    }
    if pt[1..16].iter().chain(&pt[96..]).any(|&b| b != 0) || &pt[16..32] != epoch_id {
        return Err(CoreError::Malformed);
    }
    Ok(FriendPayload {
        epoch_id: *epoch_id,
        circle_key: CircleKey::from_bytes(pt[32..64].try_into().expect("32 bytes")),
        profile_key: Zeroizing::new(pt[64..96].try_into().expect("32 bytes")),
    })
}

fn clone_sk(sk: &X25519Sk) -> Result<X25519Sk> {
    let bytes = Zeroizing::new(sk.to_bytes());
    X25519Sk::from_bytes(&bytes).map_err(|_| CoreError::Malformed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chain::circle_key;

    fn payload(epoch: [u8; 16]) -> FriendPayload {
        FriendPayload {
            epoch_id: epoch,
            circle_key: circle_key(&CircleKey::random_root(), 7).unwrap(),
            profile_key: Zeroizing::new([5; 32]),
        }
    }

    #[test]
    fn round_trip_and_fixed_size() {
        let (alice, bob) = (Identity::generate(), Identity::generate());
        let p = payload([3; 16]);
        let ct = seal(&alice, &bob.x25519_pk_bytes(), &[1; 16], &[2; 16], &p).unwrap();
        assert_eq!(ct.len(), PAYLOAD_LEN);
        let got = open(&bob, &alice.x25519_pk_bytes(), &[1; 16], &[2; 16], &[3; 16], &ct).unwrap();
        assert_eq!(got.circle_key.as_bytes(), p.circle_key.as_bytes());
        assert_eq!(*got.profile_key, [5; 32]);
    }

    #[test]
    fn every_friend_gets_the_same_size_whatever_the_circle() {
        let alice = Identity::generate();
        let root = CircleKey::random_root();
        let sizes: Vec<usize> = [1u8, 2, 7, 50, 100]
            .iter()
            .map(|&n| {
                let p = FriendPayload {
                    epoch_id: [0; 16],
                    circle_key: circle_key(&root, n).unwrap(),
                    profile_key: Zeroizing::new([0; 32]),
                };
                seal(&alice, &Identity::generate().x25519_pk_bytes(), &[1; 16], &[2; 16], &p)
                    .unwrap()
                    .len()
            })
            .collect();
        assert!(sizes.iter().all(|&s| s == PAYLOAD_LEN));
    }

    #[test]
    fn forged_sender_wrong_ids_or_tamper_fail() {
        let (alice, bob, mallory) = (Identity::generate(), Identity::generate(), Identity::generate());
        let ct = seal(&mallory, &bob.x25519_pk_bytes(), &[1; 16], &[2; 16], &payload([3; 16])).unwrap();
        // Auth mode: a payload from Mallory doesn't open as one from Alice.
        assert!(open(&bob, &alice.x25519_pk_bytes(), &[1; 16], &[2; 16], &[3; 16], &ct).is_err());

        let ct = seal(&alice, &bob.x25519_pk_bytes(), &[1; 16], &[2; 16], &payload([3; 16])).unwrap();
        assert!(open(&bob, &alice.x25519_pk_bytes(), &[9; 16], &[2; 16], &[3; 16], &ct).is_err());
        assert!(open(&bob, &alice.x25519_pk_bytes(), &[1; 16], &[2; 16], &[4; 16], &ct).is_err());
        for i in 0..ct.len() {
            let mut t = ct.clone();
            t[i] ^= 0x01;
            assert!(
                open(&bob, &alice.x25519_pk_bytes(), &[1; 16], &[2; 16], &[3; 16], &t).is_err(),
                "byte {i}"
            );
        }
    }
}
