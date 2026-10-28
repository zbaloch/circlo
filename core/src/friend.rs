//! Friend payload: one fixed-size HPKE (Auth mode) ciphertext per friend (CRYPTO.md section 8.3).
//!
//! Version 3 carries the Everyone key and 8 circle-key slots (section 8.5): the real key for each circle the friend is
//! in, 32 random bytes in every other slot, so membership is invisible. Versions 1 and 2 still open, for older epochs.

use hpke::aead::ChaCha20Poly1305;
use hpke::kdf::HkdfSha256;
use hpke::kem::X25519HkdfSha256;
use hpke::{Deserializable, Kem, OpModeR, OpModeS, Serializable};
use zeroize::Zeroizing;

use crate::chain::{CircleKey, EXCLUSIVE_CIRCLES};
use crate::error::{CoreError, Result};
use crate::identity::{x25519_pk_from_bytes, Identity, X25519Sk};
use crate::primitives::{labelled, random_secret};

pub const VERSION_1: u8 = 0x01;
pub const VERSION_2: u8 = 0x02;
pub const VERSION_3: u8 = 0x03;
/// Circle-key slots in a version 3 payload (one per possible circle).
pub const SLOTS: usize = EXCLUSIVE_CIRCLES as usize;
pub const PLAINTEXT_LEN_V1: usize = 112;
pub const PLAINTEXT_LEN_V2: usize = 144;
pub const PLAINTEXT_LEN: usize = 96 + SLOTS * 32 + 16;
pub const PAYLOAD_LEN_V1: usize = 32 + PLAINTEXT_LEN_V1 + 16;
pub const PAYLOAD_LEN_V2: usize = 32 + PLAINTEXT_LEN_V2 + 16;
pub const PAYLOAD_LEN: usize = 32 + PLAINTEXT_LEN + 16;
const INFO: &[u8] = b"circlo/v1/friend-payload";
const LABEL: &str = "circlo/v1/friend-payload";

type EncappedKey = <X25519HkdfSha256 as Kem>::EncappedKey;

pub struct FriendPayload {
    pub epoch_id: [u8; 16],
    /// The Everyone key `E` (CRYPTO.md 8.6) in version 3; the friend's chain key `Ck` in older versions.
    pub circle_key: CircleKey,
    pub profile_key: Zeroizing<[u8; 32]>,
    /// Sealing: slot `i` is `Some(X_(i+1))` if the friend is in circle `i+1`; missing or `None` slots get random filler.
    /// Opening: every slot received (a friend can't tell keys from filler): 8 for version 3, 1 for version 2, 0 for 1.
    pub circle_keys: Vec<Option<CircleKey>>,
}

/// `AAD(label, from, to, epoch, version)`: the format version is the last field (CRYPTO.md section 3).
fn payload_aad(version: u8, from_user: &[u8; 16], to_user: &[u8; 16], epoch_id: &[u8; 16]) -> Vec<u8> {
    labelled(LABEL, &[from_user, to_user, epoch_id, &[version]])
}

fn encode(p: &FriendPayload) -> Result<Zeroizing<[u8; PLAINTEXT_LEN]>> {
    if p.circle_keys.len() > SLOTS {
        return Err(crate::error::invalid("too many circle slots"));
    }
    let mut out = Zeroizing::new([0u8; PLAINTEXT_LEN]);
    out[0] = VERSION_3;
    out[16..32].copy_from_slice(&p.epoch_id);
    out[32..64].copy_from_slice(p.circle_key.as_bytes());
    out[64..96].copy_from_slice(&*p.profile_key);
    for slot in 0..SLOTS {
        let at = 96 + slot * 32;
        match p.circle_keys.get(slot).and_then(|k| k.as_ref()) {
            Some(x) => out[at..at + 32].copy_from_slice(x.as_bytes()),
            None => out[at..at + 32].copy_from_slice(&*random_secret::<32>()),
        }
    }
    Ok(out)
}

/// Always seals version 3 (every new payload has the same size, whatever the circles).
pub fn seal(
    sender: &Identity,
    recipient_x25519_pk: &[u8; 32],
    from_user: &[u8; 16],
    to_user: &[u8; 16],
    payload: &FriendPayload,
) -> Result<Vec<u8>> {
    let recipient = x25519_pk_from_bytes(recipient_x25519_pk)?;
    let mode = OpModeS::Auth((clone_sk(&sender.x25519_sk)?, sender.x25519_pk.clone()));
    let ad = payload_aad(VERSION_3, from_user, to_user, &payload.epoch_id);
    let pt = encode(payload)?;
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

/// `epoch_id` comes from the server row; it must match the authenticated copy inside. Opens versions 3, 2 and 1.
pub fn open(
    recipient: &Identity,
    sender_x25519_pk: &[u8; 32],
    from_user: &[u8; 16],
    to_user: &[u8; 16],
    epoch_id: &[u8; 16],
    bytes: &[u8],
) -> Result<FriendPayload> {
    let (version, plain_len, slots) = match bytes.len() {
        PAYLOAD_LEN => (VERSION_3, PLAINTEXT_LEN, SLOTS),
        PAYLOAD_LEN_V2 => (VERSION_2, PLAINTEXT_LEN_V2, 1),
        PAYLOAD_LEN_V1 => (VERSION_1, PLAINTEXT_LEN_V1, 0),
        _ => return Err(CoreError::DecryptionFailed),
    };
    let sender = x25519_pk_from_bytes(sender_x25519_pk)?;
    let enc = EncappedKey::from_bytes(&bytes[..32]).map_err(|_| CoreError::DecryptionFailed)?;
    let ad = payload_aad(version, from_user, to_user, epoch_id);
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
    if pt.len() != plain_len || pt[0] != version {
        return Err(CoreError::UnsupportedVersion);
    }
    let tail = 96 + slots * 32;
    if pt[1..16].iter().chain(&pt[tail..]).any(|&b| b != 0) || &pt[16..32] != epoch_id {
        return Err(CoreError::Malformed);
    }
    Ok(FriendPayload {
        epoch_id: *epoch_id,
        circle_key: CircleKey::from_bytes(pt[32..64].try_into().expect("32 bytes")),
        profile_key: Zeroizing::new(pt[64..96].try_into().expect("32 bytes")),
        circle_keys: (0..slots)
            .map(|s| {
                Some(CircleKey::from_bytes(
                    pt[96 + s * 32..128 + s * 32].try_into().expect("32 bytes"),
                ))
            })
            .collect(),
    })
}

fn clone_sk(sk: &X25519Sk) -> Result<X25519Sk> {
    let bytes = Zeroizing::new(sk.to_bytes());
    X25519Sk::from_bytes(&bytes).map_err(|_| CoreError::Malformed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chain::{circle_key, exclusive_key};

    fn payload(epoch: [u8; 16]) -> FriendPayload {
        FriendPayload {
            epoch_id: epoch,
            circle_key: circle_key(&CircleKey::random_root(), 2).unwrap(),
            profile_key: Zeroizing::new([5; 32]),
            circle_keys: vec![],
        }
    }

    /// A payload as sealed before CRYPTO.md v1.3: version 1 (no slots) or version 2 (one slot).
    fn seal_legacy(
        version: u8,
        sender: &Identity,
        to_pk: &[u8; 32],
        from: &[u8; 16],
        to: &[u8; 16],
        p: &FriendPayload,
        x: Option<&CircleKey>,
    ) -> Vec<u8> {
        let len = if version == VERSION_1 {
            PLAINTEXT_LEN_V1
        } else {
            PLAINTEXT_LEN_V2
        };
        let mut pt = vec![0u8; len];
        pt[0] = version;
        pt[16..32].copy_from_slice(&p.epoch_id);
        pt[32..64].copy_from_slice(p.circle_key.as_bytes());
        pt[64..96].copy_from_slice(&*p.profile_key);
        if let Some(x) = x {
            pt[96..128].copy_from_slice(x.as_bytes());
        }
        let mode = OpModeS::Auth((clone_sk(&sender.x25519_sk).unwrap(), sender.x25519_pk.clone()));
        let (enc, ct) = hpke::single_shot_seal::<ChaCha20Poly1305, HkdfSha256, X25519HkdfSha256, _>(
            &mode,
            &x25519_pk_from_bytes(to_pk).unwrap(),
            INFO,
            &pt,
            &payload_aad(version, from, to, &p.epoch_id),
            &mut crate::hpke_rng(),
        )
        .unwrap();
        [enc.to_bytes().to_vec(), ct].concat()
    }

    #[test]
    fn members_get_their_circle_keys_everything_else_is_indistinguishable_filler() {
        let (alice, bob) = (Identity::generate(), Identity::generate());
        let root = CircleKey::random_root();
        let (x2, x5) = (exclusive_key(&root, 2).unwrap(), exclusive_key(&root, 5).unwrap());
        let mut member = payload([3; 16]);
        member.circle_keys = vec![None, Some(x2.clone()), None, None, Some(x5.clone())];
        let ct = seal(&alice, &bob.x25519_pk_bytes(), &[1; 16], &[2; 16], &member).unwrap();
        let none = seal(&alice, &bob.x25519_pk_bytes(), &[1; 16], &[2; 16], &payload([3; 16])).unwrap();
        assert_eq!(ct.len(), PAYLOAD_LEN);
        assert_eq!(none.len(), PAYLOAD_LEN, "circle membership must not change the size");

        let got = open(&bob, &alice.x25519_pk_bytes(), &[1; 16], &[2; 16], &[3; 16], &ct).unwrap();
        assert_eq!(got.circle_keys.len(), SLOTS);
        let slot = |i: usize| got.circle_keys[i].as_ref().unwrap().as_bytes().to_owned();
        assert_eq!(&slot(1), x2.as_bytes());
        assert_eq!(&slot(4), x5.as_bytes());
        // Filler: random, not a constant, and not any of the author's other circle keys.
        for i in [0usize, 2, 3, 5, 6, 7] {
            assert_ne!(slot(i), [0u8; 32]);
            for c in 1..=EXCLUSIVE_CIRCLES {
                assert_ne!(&slot(i), exclusive_key(&root, c).unwrap().as_bytes());
            }
        }
    }

    #[test]
    fn too_many_slots_are_refused() {
        let (alice, bob) = (Identity::generate(), Identity::generate());
        let mut p = payload([3; 16]);
        p.circle_keys = vec![None; SLOTS + 1];
        assert!(seal(&alice, &bob.x25519_pk_bytes(), &[1; 16], &[2; 16], &p).is_err());
    }

    #[test]
    fn version_1_and_2_payloads_still_open() {
        let (alice, bob) = (Identity::generate(), Identity::generate());
        let p = payload([3; 16]);
        let v1 = seal_legacy(VERSION_1, &alice, &bob.x25519_pk_bytes(), &[1; 16], &[2; 16], &p, None);
        assert_eq!(v1.len(), PAYLOAD_LEN_V1);
        let got = open(&bob, &alice.x25519_pk_bytes(), &[1; 16], &[2; 16], &[3; 16], &v1).unwrap();
        assert_eq!(got.circle_key.as_bytes(), p.circle_key.as_bytes());
        assert!(got.circle_keys.is_empty());

        let x = exclusive_key(&CircleKey::random_root(), 1).unwrap();
        let v2 = seal_legacy(
            VERSION_2,
            &alice,
            &bob.x25519_pk_bytes(),
            &[1; 16],
            &[2; 16],
            &p,
            Some(&x),
        );
        assert_eq!(v2.len(), PAYLOAD_LEN_V2);
        let got = open(&bob, &alice.x25519_pk_bytes(), &[1; 16], &[2; 16], &[3; 16], &v2).unwrap();
        assert_eq!(got.circle_keys.len(), 1);
        assert_eq!(got.circle_keys[0].as_ref().unwrap().as_bytes(), x.as_bytes());
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
