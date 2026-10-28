#![no_main]
//! Request heads reaching the loopback video server: parsing must never panic.
use circlo_core::playback::{parse_request, Parsed};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Parsed::Complete(r) = parse_request(data) {
        if let Some(range) = r.range {
            let _ = circlo_core::playback::parse_range(&range, u64::from(data.len() as u32) * 1000);
        }
    }
});
