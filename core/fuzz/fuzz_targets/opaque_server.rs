#![no_main]
//! Attacker-controlled OPAQUE messages reaching the server: must never panic or authenticate.
//! The server's login state is never attacker-controlled (it stays server-side), so it is generated here
//! genuinely and only the client's messages are fuzzed.
use circlo_core::opaque::*;
use libfuzzer_sys::fuzz_target;
use std::sync::OnceLock;

struct Fixture {
    setup: Vec<u8>,
    record: Vec<u8>,
    state: Vec<u8>,
}

fn fixture() -> &'static Fixture {
    static F: OnceLock<Fixture> = OnceLock::new();
    F.get_or_init(|| {
        let setup = server_setup_new().to_vec();
        let (req, st) = client_registration_start(b"fuzz password").unwrap();
        let resp = server_registration_start(&setup, b"cred", &req).unwrap();
        let (upload, _) = client_registration_finish(st, b"fuzz password", "fuzz_user", &resp).unwrap();
        let record = server_registration_finish(&upload).unwrap();
        let (login_req, _client_state) = client_login_start(b"fuzz password").unwrap();
        let (_resp, state) = server_login_start(&setup, Some(&record), b"cred", "fuzz_user", &login_req).unwrap();
        Fixture { setup, record, state: state.to_vec() }
    })
}

fuzz_target!(|data: &[u8]| {
    let f = fixture();
    let _ = server_registration_start(&f.setup, b"cred", data);
    let _ = server_registration_finish(data);
    let _ = server_login_start(&f.setup, None, b"cred", "fuzz_user", data);
    let _ = server_login_start(&f.setup, Some(&f.record), b"cred", "fuzz_user", data);
    // A forged client finalization must never complete a login against a genuine server state.
    assert!(server_login_finish(&f.state, "fuzz_user", data).is_err());
});
