//! Padmé length padding (CRYPTO.md section 4).

use crate::error::{CoreError, Result};

pub const MIN_PADDED: usize = 256;

/// Padmé: rounds `len` up so that at most O(log log len) bits of the length leak.
pub fn padme(len: u64) -> u64 {
    if len < 2 {
        return len;
    }
    let e = 63 - u64::from(len.leading_zeros()); // floor(log2 len)
    let s = 64 - u64::from(e.leading_zeros()); // floor(log2 e) + 1
    let z = e - s;
    let mask = (1u64 << z) - 1;
    (len + mask) & !mask
}

/// `u32(len) || plain || zeros`, total `max(256, padme(4 + len))`.
pub fn pad(plain: &[u8]) -> Result<Vec<u8>> {
    let len = u32::try_from(plain.len()).map_err(|_| crate::error::invalid("plaintext too large"))?;
    let total = (padme(4 + u64::from(len)) as usize).max(MIN_PADDED);
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(plain);
    out.resize(total, 0);
    Ok(out)
}

pub fn unpad(padded: &[u8]) -> Result<Vec<u8>> {
    if padded.len() < 4 {
        return Err(CoreError::Malformed);
    }
    let len = u32::from_be_bytes(padded[..4].try_into().expect("4 bytes")) as usize;
    let rest = &padded[4..];
    if len > rest.len() || rest[len..].iter().any(|&b| b != 0) {
        return Err(CoreError::Malformed);
    }
    Ok(rest[..len].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn padme_known_values() {
        // Values from the Padmé paper's definition.
        let cases = [
            (0, 0),
            (1, 1),
            (2, 2),
            (3, 3),
            (9, 10),
            (100, 104),
            (1000, 1024),
            (1025, 1088),
            (65_537, 67_584),
        ];
        for (input, want) in cases {
            assert_eq!(padme(input), want, "padme({input})");
        }
    }

    #[test]
    fn minimum_size_and_round_trip() {
        let p = pad(b"hi").unwrap();
        assert_eq!(p.len(), MIN_PADDED);
        assert_eq!(unpad(&p).unwrap(), b"hi");
    }

    #[test]
    fn rejects_bad_length_or_nonzero_padding() {
        let mut p = pad(b"hi").unwrap();
        p[3] = 255;
        assert!(unpad(&p).is_err());
        let mut p = pad(b"hi").unwrap();
        *p.last_mut().unwrap() = 1;
        assert!(unpad(&p).is_err());
    }

    proptest! {
        #[test]
        fn padme_never_shrinks_and_overhead_is_bounded(len in 2u64..1u64 << 40) {
            let p = padme(len);
            prop_assert!(p >= len);
            // Padmé overhead is at most ~12% (1/2^(S-1) relative), well under 1/8 for len >= 2^9.
            if len >= 512 { prop_assert!((p - len) * 8 <= len); }
        }

        #[test]
        fn pad_round_trips(data in proptest::collection::vec(any::<u8>(), 0..5000)) {
            prop_assert_eq!(unpad(&pad(&data).unwrap()).unwrap(), data);
        }
    }
}
