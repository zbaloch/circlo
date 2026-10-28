//! Circle key chain, per-circle sub-keys and per-post key refs (CRYPTO.md section 8).

use subtle::ConstantTimeEq;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::error::{invalid, Result};
use crate::primitives::{hkdf32, hmac_sha256, random};

pub const CIRCLES: u8 = 100;
const STEP: &str = "circlo/v1/circle-step";
const WRAP: &str = "circlo/v1/post-wrap";
const REF: &str = "circlo/v1/post-ref";

/// One chain key `Cn`. Never used directly as an encryption key.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct CircleKey([u8; 32]);

impl CircleKey {
    /// A fresh epoch root `C1`.
    pub fn random_root() -> Self {
        CircleKey(random())
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        CircleKey(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// `C(n+1) = HKDF(Cn, "circlo/v1/circle-step")`.
    pub fn next(&self) -> CircleKey {
        CircleKey(*hkdf32(&self.0, STEP))
    }

    pub fn wrap_key(&self) -> Zeroizing<[u8; 32]> {
        hkdf32(&self.0, WRAP)
    }

    pub fn ref_key(&self) -> Zeroizing<[u8; 32]> {
        hkdf32(&self.0, REF)
    }

    /// Per-post tag: `HMAC(ref_key, "circlo/v1/post-ref" || 0x00 || author_id || post_id)`.
    pub fn key_ref(&self, author_id: &[u8; 16], post_id: &[u8; 16]) -> [u8; 32] {
        let rk = self.ref_key();
        hmac_sha256(&*rk, &[REF.as_bytes(), &[0x00], author_id, post_id])
    }

    pub fn matches_ref(&self, author_id: &[u8; 16], post_id: &[u8; 16], key_ref: &[u8; 32]) -> bool {
        self.key_ref(author_id, post_id).ct_eq(key_ref).into()
    }
}

/// Derives `Cn` (n in 1..=100) from the epoch root `C1`. Owner-side only.
pub fn circle_key(root: &CircleKey, n: u8) -> Result<CircleKey> {
    if !(1..=CIRCLES).contains(&n) {
        return Err(invalid("circle must be 1..=100"));
    }
    let mut k = root.clone();
    for _ in 1..n {
        k = k.next();
    }
    Ok(k)
}

/// Exclusive circles supported in this version (1 = "Close Friends"). A payload carries one `X` (CRYPTO.md 8.3).
pub const EXCLUSIVE_CIRCLES: u8 = 1;

/// `X_i = HKDF(C1, "circlo/v1/exclusive-circle/<i>")` (CRYPTO.md section 8.5). Owner-side only: off the chain, so no
/// `Ck` (k >= 2) leads to it. Used exactly like a chain key (wrap and ref sub-keys).
pub fn exclusive_key(root: &CircleKey, i: u8) -> Result<CircleKey> {
    if !(1..=EXCLUSIVE_CIRCLES).contains(&i) {
        return Err(invalid("unknown exclusive circle"));
    }
    Ok(CircleKey(*hkdf32(&root.0, &format!("circlo/v1/exclusive-circle/{i}"))))
}

/// The keys a friend holding `Ck` can derive: `Ck, C(k+1), ...`, 100 steps (they don't know k).
pub fn forward_keys(ck: &CircleKey) -> Vec<CircleKey> {
    let mut out = Vec::with_capacity(CIRCLES as usize);
    let mut k = ck.clone();
    for _ in 0..CIRCLES {
        let next = k.next();
        out.push(k);
        k = next;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holding_ck_derives_wider_but_never_narrower() {
        let root = CircleKey::random_root();
        let all: Vec<CircleKey> = (1..=100).map(|n| circle_key(&root, n).unwrap()).collect();
        for k in 1..=100usize {
            let derived = forward_keys(&all[k - 1]);
            // Every wider circle k..=100 is derivable.
            for n in k..=100 {
                assert_eq!(
                    derived[n - k].as_bytes(),
                    all[n - 1].as_bytes(),
                    "C{k} must derive C{n}"
                );
            }
            // No narrower circle appears anywhere in what C(k) can derive.
            for narrower in 1..k {
                assert!(
                    derived.iter().all(|d| d.as_bytes() != all[narrower - 1].as_bytes()),
                    "C{k} must not derive C{narrower}"
                );
            }
        }
    }

    /// Close Friends is off the chain: nothing any friend can derive from `Ck` (k >= 2) is `X_1`, nor its post tags.
    #[test]
    fn exclusive_key_is_unreachable_from_the_chain_and_fresh_per_epoch() {
        let root = CircleKey::random_root();
        let x = exclusive_key(&root, 1).unwrap();
        for k in 2..=100u8 {
            let derived = forward_keys(&circle_key(&root, k).unwrap());
            assert!(
                derived.iter().all(|d| d.as_bytes() != x.as_bytes()),
                "C{k} must not lead to X1"
            );
            let (a, p) = ([1; 16], [2; 16]);
            assert!(derived.iter().all(|d| !d.matches_ref(&a, &p, &x.key_ref(&a, &p))));
        }
        assert_ne!(x.as_bytes(), root.as_bytes());
        assert_ne!(
            x.as_bytes(),
            exclusive_key(&CircleKey::random_root(), 1).unwrap().as_bytes()
        );
        assert!(exclusive_key(&root, 0).is_err());
        assert!(exclusive_key(&root, 2).is_err());
    }

    #[test]
    fn circle_bounds() {
        let root = CircleKey::random_root();
        assert!(circle_key(&root, 0).is_err());
        assert!(circle_key(&root, 101).is_err());
        assert_eq!(circle_key(&root, 1).unwrap().as_bytes(), root.as_bytes());
    }

    #[test]
    fn key_refs_differ_per_post_and_per_circle() {
        let root = CircleKey::random_root();
        let c7 = circle_key(&root, 7).unwrap();
        let c9 = circle_key(&root, 9).unwrap();
        let a = [1; 16];
        assert_ne!(c7.key_ref(&a, &[1; 16]), c7.key_ref(&a, &[2; 16]));
        assert_ne!(c7.key_ref(&a, &[1; 16]), c9.key_ref(&a, &[1; 16]));
        assert!(c7.matches_ref(&a, &[1; 16], &c7.key_ref(&a, &[1; 16])));
    }

    #[test]
    fn sub_keys_are_distinct_from_chain_key() {
        let k = CircleKey::random_root();
        assert_ne!(*k.wrap_key(), *k.as_bytes());
        assert_ne!(*k.ref_key(), *k.as_bytes());
        assert_ne!(*k.wrap_key(), *k.ref_key());
        assert_ne!(*k.wrap_key(), *k.next().as_bytes());
    }
}
