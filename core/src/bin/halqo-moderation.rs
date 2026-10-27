//! Operator tool for reports (CRYPTO.md 13c). Runs offline, on the operator's machine, never on the server.
//!
//!   halqo-moderation keygen                     -> prints the public key (set HALQO_MODERATION_PUBLIC_KEY) and the
//!                                                  secret key (store offline; never on the server)
//!   halqo-moderation open <secret-b64> <file>   -> decrypts a sealed report exported from the server
//!                         [reporter-ed25519-b64]   and, if given, checks the reporter's signature

use std::process::ExitCode;

fn b64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n =
            (u32::from(c[0]) << 16) | (u32::from(*c.get(1).unwrap_or(&0)) << 8) | u32::from(*c.get(2).unwrap_or(&0));
        for i in 0..4 {
            out.push(if i <= c.len() {
                T[(n >> (18 - 6 * i)) as usize & 63] as char
            } else {
                '='
            });
        }
    }
    out
}

fn unb64(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0);
    for ch in s.trim().bytes().filter(|&b| b != b'=') {
        let v = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

fn key32(s: &str) -> Option<[u8; 32]> {
    unb64(s)?.try_into().ok()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("keygen") => {
            let (sk, pk) = halqo_core::report::generate_moderation_keys();
            println!("HALQO_MODERATION_PUBLIC_KEY={}", b64(&pk));
            println!("moderation secret (keep offline): {}", b64(&*sk));
            ExitCode::SUCCESS
        }
        Some("open") if args.len() >= 4 => {
            let (Some(sk), Ok(sealed)) = (key32(&args[2]), std::fs::read(&args[3])) else {
                eprintln!("bad key or file");
                return ExitCode::FAILURE;
            };
            let sealed = unb64(std::str::from_utf8(&sealed).unwrap_or_default()).unwrap_or(sealed);
            match halqo_core::report::open(&sk, &sealed) {
                Ok(r) => {
                    let id: String = r.reporter_id.iter().map(|b| format!("{b:02x}")).collect();
                    println!("reporter: {id}");
                    if let Some(pk) = args.get(4).and_then(|s| key32(s)) {
                        println!(
                            "reporter signature: {}",
                            if r.verify(&pk).is_ok() { "valid" } else { "INVALID" }
                        );
                    }
                    println!("{}", String::from_utf8_lossy(&r.content));
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("cannot open report: {e}");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!("usage: halqo-moderation keygen | open <secret-b64> <file> [reporter-ed25519-b64]");
            ExitCode::FAILURE
        }
    }
}
