#![no_main]
//! Arbitrary HPKE friend payloads: must never panic or open.
use halqo_core::ffi::{generate_identity, open_friend_payload};
use libfuzzer_sys::fuzz_target;
use std::sync::OnceLock;

fuzz_target!(|data: &[u8]| {
    static IDS: OnceLock<(halqo_core::ffi::IdentityKeys, Vec<u8>)> = OnceLock::new();
    let (bob, alice_pk) = IDS.get_or_init(|| (generate_identity(), generate_identity().x25519_pk));
    assert!(open_friend_payload(bob, alice_pk, &[1; 16], &[2; 16], &[3; 16], data).is_err());
});
