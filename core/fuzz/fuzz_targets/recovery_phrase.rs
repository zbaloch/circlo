#![no_main]
//! Arbitrary recovery phrase input: must never panic.
use halqo_core::recovery::entropy_from_phrase;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        let _ = entropy_from_phrase(s);
    }
});
