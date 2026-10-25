//! Key backups: password copy (OPAQUE export key) and recovery copy (BIP39 entropy) (CRYPTO.md section 6).
//!
//! Plaintext is a fixed binary layout (not CBOR) so every byte is zeroizable and no parser touches secrets:
//! `version || x25519_sk:32 || ed25519_sk:32 || data_key:32 || local_root:32 || u16(count) || count × (epoch_id:16 || C1:32 || profile_key:32)`

use zeroize::Zeroizing;

use crate::chain::CircleKey;
use crate::envelope;
use crate::error::{invalid, CoreError, Result};
use crate::padding::{pad, unpad};
use crate::primitives::{hkdf32, VERSION};

const FIXED: usize = 1 + 4 * 32 + 2;
const EPOCH_LEN: usize = 16 + 32 + 32;
pub const MAX_EPOCHS: usize = 10_000;
pub const KIND_PASSWORD: u8 = 0x01;
pub const KIND_RECOVERY: u8 = 0x02;

pub struct EpochSecrets {
    pub epoch_id: [u8; 16],
    pub root: CircleKey,
    pub profile_key: Zeroizing<[u8; 32]>,
}

pub struct BackupPayload {
    pub x25519_sk: Zeroizing<[u8; 32]>,
    pub ed25519_sk: Zeroizing<[u8; 32]>,
    pub data_key: Zeroizing<[u8; 32]>,
    pub local_root: Zeroizing<[u8; 32]>,
    pub epochs: Vec<EpochSecrets>,
}

impl BackupPayload {
    pub fn encode(&self) -> Result<Zeroizing<Vec<u8>>> {
        if self.epochs.len() > MAX_EPOCHS {
            return Err(invalid("too many epochs"));
        }
        let mut out = Zeroizing::new(Vec::with_capacity(FIXED + self.epochs.len() * EPOCH_LEN));
        out.push(VERSION);
        for k in [&self.x25519_sk, &self.ed25519_sk, &self.data_key, &self.local_root] {
            out.extend_from_slice(&**k);
        }
        out.extend_from_slice(&(self.epochs.len() as u16).to_be_bytes());
        for e in &self.epochs {
            out.extend_from_slice(&e.epoch_id);
            out.extend_from_slice(e.root.as_bytes());
            out.extend_from_slice(&*e.profile_key);
        }
        Ok(out)
    }

    pub fn decode(b: &[u8]) -> Result<Self> {
        if b.len() < FIXED {
            return Err(CoreError::Malformed);
        }
        if b[0] != VERSION {
            return Err(CoreError::UnsupportedVersion);
        }
        let key = |i: usize| -> Zeroizing<[u8; 32]> {
            Zeroizing::new(b[1 + 32 * i..33 + 32 * i].try_into().expect("32 bytes"))
        };
        let count = u16::from_be_bytes([b[FIXED - 2], b[FIXED - 1]]) as usize;
        if count > MAX_EPOCHS || b.len() != FIXED + count * EPOCH_LEN {
            return Err(CoreError::Malformed);
        }
        let epochs = b[FIXED..]
            .chunks_exact(EPOCH_LEN)
            .map(|c| EpochSecrets {
                epoch_id: c[..16].try_into().expect("16 bytes"),
                root: CircleKey::from_bytes(c[16..48].try_into().expect("32 bytes")),
                profile_key: Zeroizing::new(c[48..80].try_into().expect("32 bytes")),
            })
            .collect();
        Ok(BackupPayload {
            x25519_sk: key(0),
            ed25519_sk: key(1),
            data_key: key(2),
            local_root: key(3),
            epochs,
        })
    }
}

fn seal_with(key: &[u8; 32], user_id: &[u8; 16], kind: u8, payload: &BackupPayload) -> Result<Vec<u8>> {
    let padded = Zeroizing::new(pad(&payload.encode()?)?);
    Ok(envelope::seal(key, &padded, "halqo/v1/backup", &[user_id, &[kind]]))
}

fn open_with(key: &[u8; 32], user_id: &[u8; 16], kind: u8, ct: &[u8]) -> Result<BackupPayload> {
    let padded = Zeroizing::new(envelope::open(key, ct, "halqo/v1/backup", &[user_id, &[kind]])?);
    let plain = Zeroizing::new(unpad(&padded)?);
    BackupPayload::decode(&plain)
}

/// `export_key` is the 64-byte OPAQUE export key; it never leaves the device.
pub fn seal_password_backup(export_key: &[u8; 64], user_id: &[u8; 16], p: &BackupPayload) -> Result<Vec<u8>> {
    seal_with(
        &hkdf32(export_key, "halqo/v1/backup-password"),
        user_id,
        KIND_PASSWORD,
        p,
    )
}

pub fn open_password_backup(export_key: &[u8; 64], user_id: &[u8; 16], ct: &[u8]) -> Result<BackupPayload> {
    open_with(
        &hkdf32(export_key, "halqo/v1/backup-password"),
        user_id,
        KIND_PASSWORD,
        ct,
    )
}

pub fn seal_recovery_backup(entropy: &[u8; 32], user_id: &[u8; 16], p: &BackupPayload) -> Result<Vec<u8>> {
    seal_with(&hkdf32(entropy, "halqo/v1/backup-recovery"), user_id, KIND_RECOVERY, p)
}

pub fn open_recovery_backup(entropy: &[u8; 32], user_id: &[u8; 16], ct: &[u8]) -> Result<BackupPayload> {
    open_with(&hkdf32(entropy, "halqo/v1/backup-recovery"), user_id, KIND_RECOVERY, ct)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(epochs: usize) -> BackupPayload {
        BackupPayload {
            x25519_sk: Zeroizing::new([1; 32]),
            ed25519_sk: Zeroizing::new([2; 32]),
            data_key: Zeroizing::new([3; 32]),
            local_root: Zeroizing::new([4; 32]),
            epochs: (0..epochs)
                .map(|i| EpochSecrets {
                    epoch_id: [i as u8; 16],
                    root: CircleKey::from_bytes([5; 32]),
                    profile_key: Zeroizing::new([6; 32]),
                })
                .collect(),
        }
    }

    #[test]
    fn password_and_recovery_copies_round_trip_and_are_not_interchangeable() {
        let p = payload(3);
        let ek = [9u8; 64];
        let ent = [8u8; 32];
        let pw = seal_password_backup(&ek, &[1; 16], &p).unwrap();
        let rc = seal_recovery_backup(&ent, &[1; 16], &p).unwrap();
        let back = open_password_backup(&ek, &[1; 16], &pw).unwrap();
        assert_eq!(*back.ed25519_sk, [2; 32]);
        assert_eq!(back.epochs.len(), 3);
        assert!(open_recovery_backup(&ent, &[1; 16], &rc).is_ok());
        // Wrong key, wrong user, or a copy presented as the other kind.
        assert!(open_password_backup(&[0; 64], &[1; 16], &pw).is_err());
        assert!(open_password_backup(&ek, &[2; 16], &pw).is_err());
        let ent_as_ek: [u8; 64] = [ent, ent].concat().try_into().unwrap();
        assert!(open_password_backup(&ent_as_ek, &[1; 16], &rc).is_err());
    }

    #[test]
    fn decode_rejects_bad_lengths() {
        let enc = payload(2).encode().unwrap();
        assert!(BackupPayload::decode(&enc[..enc.len() - 1]).is_err());
        let mut longer = enc.to_vec();
        longer.push(0);
        assert!(BackupPayload::decode(&longer).is_err());
    }
}
