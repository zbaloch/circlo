# core/ — halqo-core (Rust crypto core)

- Crate `halqo-core`, lib `halqo_core`, uniffi namespace `halqo_core`. Exposed to React Native as `@halqo/core`
  via `uniffi-bindgen-react-native`.
- This is the ONLY place crypto is implemented. Follow `docs/CRYPTO.md` byte-for-byte; never improvise.
  Any change to algorithms, formats, labels or AAD needs a CRYPTO.md change approved by the owner first.
- Use only the audited crates listed in PLAN.md section 0 (chacha20poly1305, x25519-dalek, ed25519-dalek,
  hpke, argon2, hkdf, blake3/sha2, openmls, bip39) plus `zeroize`, `rand_core`/`getrandom`, `subtle`.
- Every HKDF info / AAD label starts with `halqo/v1/`. Every ciphertext is AEAD with AAD binding
  (object type, id, version).
- Secrets are zeroized on drop; compare MACs/tags in constant time; no `unwrap()` on untrusted input.
- Errors returned across FFI never contain key material or plaintext.
- Tests: unit tests next to code, committed vectors in `test_vectors/` (public by design, `*_TEST_ONLY` names),
  `cargo fuzz` targets for every decrypt/parse path. `cargo test`, `cargo clippy -- -D warnings`, `cargo fmt --check`.
