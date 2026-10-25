#![no_main]
//! Arbitrary media objects, content lengths and chunk indices: must never panic.
use halqo_core::stream::{decrypt, ChunkCipher};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if data.len() < 4 {
        return;
    }
    let content_len = u64::from(u16::from_le_bytes([data[0], data[1]])) * 37;
    let body = &data[4..];
    let mut sink = Vec::new();
    assert!(decrypt(&mut &body[..], &mut sink, &[3; 32], &[4; 16], content_len).is_err());
    if body.len() >= 20 {
        if let Ok(c) = ChunkCipher::from_header(&[3; 32], &[4; 16], &body[..20]) {
            let _ = c.decrypt_chunk(u64::from(data[2]), data[3] & 1 == 1, &body[20..]);
        }
    }
});
