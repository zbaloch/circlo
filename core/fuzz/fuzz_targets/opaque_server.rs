#![no_main]
//! Attacker-controlled OPAQUE messages reaching the server: must never panic or authenticate.
use halqo_core::opaque::*;
use libfuzzer_sys::fuzz_target;
use std::sync::OnceLock;

fuzz_target!(|data: &[u8]| {
    static SETUP: OnceLock<Vec<u8>> = OnceLock::new();
    let setup = SETUP.get_or_init(|| server_setup_new().to_vec());
    let _ = server_registration_start(setup, b"cred", data);
    let _ = server_registration_finish(data);
    let _ = server_login_start(setup, None, b"cred", "fuzz_user", data);
    let _ = server_login_start(setup, Some(data), b"cred", "fuzz_user", data);
    if data.len() > 64 {
        let (state, fin) = data.split_at(data.len() / 2);
        assert!(server_login_finish(state, "fuzz_user", fin).is_err());
    }
});
