#![no_main]
//! Arbitrary post header ciphertext and key ref: must never panic, and never open without the real key.
use circlo_core::chain::{forward_keys, CircleKey};
use circlo_core::post::open_post;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if data.len() < 32 {
        return;
    }
    let key_ref: [u8; 32] = data[..32].try_into().unwrap();
    let keys = forward_keys(&CircleKey::from_bytes([5; 32]));
    let opened = open_post(&keys, &[9; 32], &[1; 16], &[2; 16], &[3; 16], &key_ref, &data[32..]);
    assert!(opened.is_err(), "random bytes must not open as a post");
});
