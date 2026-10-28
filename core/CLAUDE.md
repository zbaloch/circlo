# core/ — circlo-core (Rust crypto core)

- Crate `circlo-core`, lib `circlo_core`, uniffi namespace `circlo_core`. Exposed to React Native as `@circlo/core`
  via `uniffi-bindgen-react-native` (uniffi 0.31 to match ubrn 0.31), and to the server via JNI (Phase 3).
- This is the ONLY place crypto is implemented. Follow `docs/CRYPTO.md` v1.0 byte-for-byte; never improvise.
  Any change to algorithms, formats, labels or AAD needs a CRYPTO.md change first, then regenerate vectors.
- Crates (one RustCrypto generation, digest 0.10 / rand_core 0.6): chacha20poly1305 0.10, hkdf 0.12, hmac 0.12,
  sha2 0.10, ed25519-dalek 2, hpke 0.13 (rand_core 0.9 via `hpke_rng()`), opaque-ke 4 (+ its argon2 0.5), bip39 2,
  zeroize, subtle. Add nothing else crypto-related without updating CRYPTO.md.
- Every HKDF info / AAD label starts with `circlo/v1/`. Every ciphertext is AEAD with AAD binding
  (object type, id, version). Use `envelope::seal/open` and `primitives::aad` — never call the AEAD directly elsewhere.
- Secrets are `Zeroizing`/`ZeroizeOnDrop`; tag/ref comparisons are constant time; no `unwrap()` on untrusted input.
- Errors (`CoreError`) never contain key material or plaintext; decryption failures are indistinguishable.
- Module map: `primitives` (rng/HKDF/HMAC/AAD), `envelope`, `padding` (Padmé), `chain` (circle keys, key refs),
  `identity`, `friend` (HPKE Auth payloads), `post` (posts/replies), `stream` (chunked media), `backup`, `recovery`
  (BIP39), `opaque` (client + server), `blob`, `social` (handles, invites, safety numbers), `ffi` (uniffi surface).
- Tests: unit tests next to code; `tests/flows.rs` (end-to-end via FFI), `tests/tamper.rs` (property tests),
  `src/vectors.rs` + `test_vectors/vectors_TEST_ONLY.json` (regenerate only after a spec change:
  `CIRCLO_WRITE_VECTORS=1 cargo test vectors`), `fuzz/` (cargo-fuzz, nightly, run in CI).
- Checks: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`.
  200 MB streaming: `cargo test --release --test flows -- --ignored large_file`.
- On Windows, cargo lives in `%USERPROFILE%\.cargo\bin` (add it to PATH in Git Bash).
