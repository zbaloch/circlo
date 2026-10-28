#![no_main]
//! Backup plaintext decoding, padding removal and sealed backups: must never panic.
use circlo_core::backup::{open_password_backup, BackupPayload};
use circlo_core::padding::unpad;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = BackupPayload::decode(data);
    let _ = unpad(data);
    assert!(open_password_backup(&[6; 64], &[1; 16], data).is_err());
});
