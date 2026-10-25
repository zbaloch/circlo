/// Errors crossing the FFI boundary. Messages never contain key material or plaintext.
#[derive(Debug, thiserror::Error, uniffi::Error, PartialEq, Eq)]
pub enum CoreError {
    #[error("invalid input: {reason}")]
    InvalidInput { reason: String },
    /// Wrong key, tampered data, wrong AAD: deliberately indistinguishable.
    #[error("decryption failed")]
    DecryptionFailed,
    #[error("signature verification failed")]
    BadSignature,
    #[error("malformed data")]
    Malformed,
    #[error("unsupported format version")]
    UnsupportedVersion,
    #[error("authentication protocol failed")]
    AuthFailed,
    #[error("i/o error: {reason}")]
    Io { reason: String },
}

pub type Result<T> = core::result::Result<T, CoreError>;

pub(crate) fn invalid(reason: &str) -> CoreError {
    CoreError::InvalidInput {
        reason: reason.to_owned(),
    }
}

/// Converts a byte slice to a fixed-size array, naming the field on error.
pub(crate) fn fixed<const N: usize>(bytes: &[u8], field: &str) -> Result<[u8; N]> {
    bytes
        .try_into()
        .map_err(|_| invalid(&format!("{field} must be {N} bytes")))
}

impl From<std::io::Error> for CoreError {
    fn from(e: std::io::Error) -> Self {
        CoreError::Io {
            reason: e.kind().to_string(),
        }
    }
}
