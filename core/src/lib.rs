//! Halqo crypto core. Implements docs/CRYPTO.md v1.0; nothing else in Halqo implements crypto.
//!
//! `ffi` is the uniffi surface used by the app (`@halqo/core`) and, later, the server (JNI).

pub mod backup;
pub mod blob;
mod cbor;
pub mod chain;
pub mod envelope;
pub mod error;
pub mod ffi;
pub mod friend;
pub mod identity;
#[cfg(feature = "jni")]
mod jni_bridge;
pub mod opaque;
pub mod padding;
pub mod post;
pub mod primitives;
pub mod recovery;
pub mod social;
pub mod stream;
#[cfg(test)]
mod vectors;

uniffi::setup_scaffolding!("halqo_core");

/// OS CSPRNG behind the rand_core 0.9 traits that `hpke` 0.13 expects.
pub(crate) fn hpke_rng() -> rand_core09::UnwrapErr<rand_core09::OsRng> {
    rand_core09::UnwrapErr(rand_core09::OsRng)
}
