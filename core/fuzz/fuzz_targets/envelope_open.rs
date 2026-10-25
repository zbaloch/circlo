#![no_main]
//! Arbitrary bytes as a sealed envelope (profiles, blobs, replies, push tokens all use it): must never panic.
use halqo_core::envelope;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = envelope::open(&[7; 32], data, "halqo/v1/profile", &[&[1; 16], &[2; 16]]);
    let _ = halqo_core::ffi::open_reply(&[7; 32], &[0; 32], &[1; 16], &[2; 16], &[3; 16], data);
});
