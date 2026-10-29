//! Posts and replies (CRYPTO.md section 9).

use ciborium::Value;
use ed25519_dalek::SigningKey;
use zeroize::Zeroizing;

use crate::cbor::{self, Fields};
use crate::chain::CircleKey;
use crate::envelope;
use crate::error::{invalid, CoreError, Result};
use crate::identity::{sign, verify};
use crate::padding::{pad, unpad};
use crate::primitives::{hkdf32, labelled, random, random_secret, sha256};

pub const MAX_TEXT_CHARS: usize = 500;

/// Key slots in every post since CRYPTO.md v1.3 (9.1): one per audience key, random filler for the rest.
pub const POST_SLOTS: usize = 8;
const FORMAT_SLOTS: u8 = 0x02;
/// `envelope(postKey)`: version 1 + nonce 24 + key 32 + tag 16.
const WRAPPED_LEN: usize = 73;
const SLOT_LEN: usize = 32 + WRAPPED_LEN;

/// Proof that the holder can open a post (CRYPTO.md 13c): only its audience can derive it from the post key.
pub fn read_token(post_key: &[u8; 32]) -> Zeroizing<[u8; 32]> {
    hkdf32(post_key, "circlo/v1/read-token")
}

/// What the server stores and compares: a hash, so a database copy can't be used to interact with the post.
pub fn read_token_hash(token: &[u8; 32]) -> [u8; 32] {
    sha256(&[labelled("circlo/v1/read-token-hash", &[token]).as_slice()])
}
const MAX_TEXT_BYTES: usize = MAX_TEXT_CHARS * 4;
pub const MAX_MEDIA: usize = 12;
const MAX_MIME_BYTES: usize = 100;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MediaDescriptor {
    pub object_id: [u8; 16],
    /// 0 = full, 1 = thumb, 2 = poster.
    pub kind: u8,
    pub mime: String,
    pub file_key: [u8; 32],
    pub content_len: u64,
    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
}

impl MediaDescriptor {
    pub(crate) fn to_value(&self) -> Value {
        cbor::map(vec![
            (1, cbor::bytes(&self.object_id)),
            (2, cbor::uint(self.kind.into())),
            (3, Value::Text(self.mime.clone())),
            (4, cbor::bytes(&self.file_key)),
            (5, cbor::uint(self.content_len)),
            (6, cbor::uint(self.width.into())),
            (7, cbor::uint(self.height.into())),
            (8, cbor::uint(self.duration_ms)),
        ])
    }

    pub(crate) fn from_value(v: Value) -> Result<Self> {
        let mut f = Fields::parse(v, &[1, 2, 3, 4, 5, 6, 7, 8])?;
        let small = |n: u64| u32::try_from(n).map_err(|_| CoreError::Malformed);
        let d = MediaDescriptor {
            object_id: f.fixed(1)?,
            kind: u8::try_from(f.uint(2)?).map_err(|_| CoreError::Malformed)?,
            mime: f.text(3, MAX_MIME_BYTES)?,
            file_key: f.fixed(4)?,
            content_len: f.uint(5)?,
            width: small(f.uint(6)?)?,
            height: small(f.uint(7)?)?,
            duration_ms: f.uint(8)?,
        };
        if d.kind > 2 {
            return Err(CoreError::Malformed);
        }
        Ok(d)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PostHeader {
    pub text: String,
    pub created_at_ms: u64,
    pub media: Vec<MediaDescriptor>,
}

impl PostHeader {
    fn validate(&self) -> Result<()> {
        if self.text.chars().count() > MAX_TEXT_CHARS {
            return Err(invalid("post text is longer than 500 characters"));
        }
        if self.media.len() > MAX_MEDIA || self.media.iter().any(|m| m.kind > 2 || m.mime.len() > MAX_MIME_BYTES) {
            return Err(invalid("invalid media descriptors"));
        }
        Ok(())
    }

    fn fields(&self) -> Vec<(u64, Value)> {
        vec![
            (1, Value::Text(self.text.clone())),
            (2, cbor::uint(self.created_at_ms)),
            (
                3,
                Value::Array(self.media.iter().map(MediaDescriptor::to_value).collect()),
            ),
        ]
    }

    /// Canonical CBOR of the header without the signature (the signed content).
    fn unsigned_cbor(&self) -> Vec<u8> {
        cbor::encode(&cbor::map(self.fields()))
    }

    fn signed_cbor(&self, sig: &[u8; 64]) -> Vec<u8> {
        let mut f = self.fields();
        f.push((4, cbor::bytes(sig)));
        cbor::encode(&cbor::map(f))
    }

    fn parse_signed(bytes: &[u8]) -> Result<(Self, [u8; 64])> {
        let mut f = Fields::parse(cbor::decode(bytes)?, &[1, 2, 3, 4])?;
        let header = PostHeader {
            text: f.text(1, MAX_TEXT_BYTES)?,
            created_at_ms: f.uint(2)?,
            media: f
                .array(3, MAX_MEDIA)?
                .into_iter()
                .map(MediaDescriptor::from_value)
                .collect::<Result<_>>()?,
        };
        let sig = f.fixed(4)?;
        // Exactly one valid encoding: re-encoding must reproduce the input.
        if header.signed_cbor(&sig) != bytes {
            return Err(CoreError::Malformed);
        }
        header.validate().map_err(|_| CoreError::Malformed)?;
        Ok((header, sig))
    }
}

fn post_sig_msg(author_id: &[u8; 16], post_id: &[u8; 16], epoch_id: &[u8; 16], header: &PostHeader) -> Vec<u8> {
    labelled(
        "circlo/v1/post-sig",
        &[author_id, post_id, epoch_id, &sha256(&[&header.unsigned_cbor()])],
    )
}

pub struct SealedPost {
    pub key_ref: [u8; 32],
    pub header_ct: Vec<u8>,
    pub post_key: Zeroizing<[u8; 32]>,
}

pub struct OpenedPost {
    pub header: PostHeader,
    pub post_key: Zeroizing<[u8; 32]>,
}

/// Seals a post for its audience (CRYPTO.md 9.1, v1.3): one key per audience (Only me: C1; Everyone: E; or each
/// chosen circle's X_i), wrapped into a fixed number of slots in random order, filler in the rest. The returned
/// `key_ref` is random (the row's tag is unused for these posts), so nothing reveals the audience.
pub fn seal_post(
    author: &SigningKey,
    author_id: &[u8; 16],
    post_id: &[u8; 16],
    epoch_id: &[u8; 16],
    audience: &[CircleKey],
    header: &PostHeader,
) -> Result<SealedPost> {
    if audience.is_empty() || audience.len() > POST_SLOTS {
        return Err(invalid("a post needs 1 to 8 audience keys"));
    }
    header.validate()?;
    let post_key = random_secret::<32>();
    let sig = sign(author, &post_sig_msg(author_id, post_id, epoch_id, header));
    let body_plain = Zeroizing::new(pad(&header.signed_cbor(&sig))?);
    let mut slots: Vec<Vec<u8>> = audience
        .iter()
        .map(|k| {
            let wrapped = envelope::seal(
                &k.wrap_key(),
                &*post_key,
                "circlo/v1/post-key",
                &[author_id, post_id, epoch_id],
            );
            debug_assert_eq!(wrapped.len(), WRAPPED_LEN);
            [k.key_ref(author_id, post_id).as_slice(), &wrapped].concat()
        })
        .collect();
    while slots.len() < POST_SLOTS {
        // Filler that looks like a real slot: a random tag, the envelope version byte, then random bytes.
        let mut filler = random::<SLOT_LEN>().to_vec();
        filler[32] = crate::primitives::VERSION;
        slots.push(filler);
    }
    shuffle(&mut slots);
    let body = envelope::seal(
        &hkdf32(&*post_key, "circlo/v1/post-header"),
        &body_plain,
        "circlo/v1/post-header",
        &[author_id, post_id],
    );
    let mut header_ct = Vec::with_capacity(1 + POST_SLOTS * SLOT_LEN + body.len());
    header_ct.push(FORMAT_SLOTS);
    for slot in &slots {
        header_ct.extend_from_slice(slot);
    }
    header_ct.extend_from_slice(&body);
    Ok(SealedPost {
        key_ref: random(),
        header_ct,
        post_key,
    })
}

/// Fisher–Yates with the OS RNG, so a slot's position says nothing about which key it holds.
fn shuffle<T>(items: &mut [T]) {
    for i in (1..items.len()).rev() {
        let r = u32::from_be_bytes(random::<4>()) as usize % (i + 1);
        items.swap(i, r);
    }
}

/// Tries each candidate key (a reader's keys for this epoch) against the post's slots (v1.3 posts) or the row's
/// `key_ref` (older posts). Any failure → error.
pub fn open_post(
    candidates: &[CircleKey],
    author_ed25519_pk: &[u8; 32],
    author_id: &[u8; 16],
    post_id: &[u8; 16],
    epoch_id: &[u8; 16],
    key_ref: &[u8; 32],
    header_ct: &[u8],
) -> Result<OpenedPost> {
    let (key, wrapped, body) = if header_ct.first() == Some(&FORMAT_SLOTS) {
        let slots_end = 1 + POST_SLOTS * SLOT_LEN;
        if header_ct.len() <= slots_end {
            return Err(CoreError::DecryptionFailed);
        }
        let slots: Vec<&[u8]> = header_ct[1..slots_end].chunks(SLOT_LEN).collect();
        candidates
            .iter()
            .find_map(|c| {
                slots.iter().find_map(|slot| {
                    let r: &[u8; 32] = slot[..32].try_into().expect("32 bytes");
                    c.matches_ref(author_id, post_id, r)
                        .then(|| (c, &slot[32..], &header_ct[slots_end..]))
                })
            })
            .ok_or(CoreError::DecryptionFailed)?
    } else {
        let circle = candidates
            .iter()
            .find(|c| c.matches_ref(author_id, post_id, key_ref))
            .ok_or(CoreError::DecryptionFailed)?;
        if header_ct.len() < 4 {
            return Err(CoreError::DecryptionFailed);
        }
        let wlen = u32::from_be_bytes(header_ct[..4].try_into().expect("4 bytes")) as usize;
        let rest = &header_ct[4..];
        if wlen > rest.len() {
            return Err(CoreError::DecryptionFailed);
        }
        let (wrapped, body) = rest.split_at(wlen);
        (circle, wrapped, body)
    };
    let pk = Zeroizing::new(envelope::open(
        &key.wrap_key(),
        wrapped,
        "circlo/v1/post-key",
        &[author_id, post_id, epoch_id],
    )?);
    let post_key: Zeroizing<[u8; 32]> =
        Zeroizing::new(pk.as_slice().try_into().map_err(|_| CoreError::DecryptionFailed)?);
    let padded = Zeroizing::new(envelope::open(
        &hkdf32(&*post_key, "circlo/v1/post-header"),
        body,
        "circlo/v1/post-header",
        &[author_id, post_id],
    )?);
    let (header, sig) = PostHeader::parse_signed(&unpad(&padded)?)?;
    verify(
        author_ed25519_pk,
        &post_sig_msg(author_id, post_id, epoch_id, &header),
        &sig,
    )?;
    Ok(OpenedPost { header, post_key })
}

// ---- Replies (9.3) ----

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reply {
    pub text: String,
    pub created_at_ms: u64,
}

fn reply_sig_msg(post_id: &[u8; 16], reply_id: &[u8; 16], replier_id: &[u8; 16], text: &str) -> Vec<u8> {
    labelled(
        "circlo/v1/reply-sig",
        &[post_id, reply_id, replier_id, &sha256(&[text.as_bytes()])],
    )
}

fn reply_cbor(r: &Reply, sig: &[u8; 64]) -> Vec<u8> {
    cbor::encode(&cbor::map(vec![
        (1, Value::Text(r.text.clone())),
        (2, cbor::uint(r.created_at_ms)),
        (3, cbor::bytes(sig)),
    ]))
}

pub fn seal_reply(
    post_key: &[u8; 32],
    replier: &SigningKey,
    post_id: &[u8; 16],
    reply_id: &[u8; 16],
    replier_id: &[u8; 16],
    reply: &Reply,
) -> Result<Vec<u8>> {
    if reply.text.chars().count() > MAX_TEXT_CHARS {
        return Err(invalid("reply text is longer than 500 characters"));
    }
    let sig = sign(replier, &reply_sig_msg(post_id, reply_id, replier_id, &reply.text));
    let padded = Zeroizing::new(pad(&reply_cbor(reply, &sig))?);
    Ok(envelope::seal(
        &hkdf32(post_key, "circlo/v1/reply"),
        &padded,
        "circlo/v1/reply",
        &[post_id, reply_id, replier_id],
    ))
}

pub fn open_reply(
    post_key: &[u8; 32],
    replier_ed25519_pk: &[u8; 32],
    post_id: &[u8; 16],
    reply_id: &[u8; 16],
    replier_id: &[u8; 16],
    ciphertext: &[u8],
) -> Result<Reply> {
    let padded = Zeroizing::new(envelope::open(
        &hkdf32(post_key, "circlo/v1/reply"),
        ciphertext,
        "circlo/v1/reply",
        &[post_id, reply_id, replier_id],
    )?);
    let bytes = unpad(&padded)?;
    let mut f = Fields::parse(cbor::decode(&bytes)?, &[1, 2, 3])?;
    let reply = Reply {
        text: f.text(1, MAX_TEXT_BYTES)?,
        created_at_ms: f.uint(2)?,
    };
    let sig: [u8; 64] = f.fixed(3)?;
    if reply_cbor(&reply, &sig) != bytes || reply.text.chars().count() > MAX_TEXT_CHARS {
        return Err(CoreError::Malformed);
    }
    verify(
        replier_ed25519_pk,
        &reply_sig_msg(post_id, reply_id, replier_id, &reply.text),
        &sig,
    )?;
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chain::{circle_key, forward_keys};
    use crate::identity::generate_signing_key;

    const AUTHOR: [u8; 16] = [0xA1; 16];
    const EPOCH: [u8; 16] = [0xE1; 16];

    fn header() -> PostHeader {
        PostHeader {
            text: "Hello circles ✨".into(),
            created_at_ms: 1_761_400_000_000,
            media: vec![MediaDescriptor {
                object_id: [9; 16],
                kind: 0,
                mime: "image/jpeg".into(),
                file_key: [8; 32],
                content_len: 123_456,
                width: 1080,
                height: 720,
                duration_ms: 0,
            }],
        }
    }

    fn open_as(
        reader_ck: &CircleKey,
        author_pk: &[u8; 32],
        post_id: [u8; 16],
        sealed: &SealedPost,
    ) -> Result<OpenedPost> {
        open_post(
            &forward_keys(reader_ck),
            author_pk,
            &AUTHOR,
            &post_id,
            &EPOCH,
            &sealed.key_ref,
            &sealed.header_ct,
        )
    }

    /// Phase 6 criterion at the crypto level: a friend in circle 7 reads 7 and 9, never 5.
    #[test]
    fn circle_7_reads_7_and_9_but_not_5() {
        let author = generate_signing_key();
        let pk = author.verifying_key().to_bytes();
        let root = CircleKey::random_root();
        let friend_c7 = circle_key(&root, 7).unwrap();
        for (circle, readable) in [(5u8, false), (7, true), (9, true), (100, true), (1, false)] {
            let post_id = [circle; 16];
            let sealed = seal_post(
                &author,
                &AUTHOR,
                &post_id,
                &EPOCH,
                &[circle_key(&root, circle).unwrap()],
                &header(),
            )
            .unwrap();
            let got = open_as(&friend_c7, &pk, post_id, &sealed);
            assert_eq!(got.is_ok(), readable, "post to circle {circle}");
            if readable {
                assert_eq!(got.unwrap().header, header());
            }
        }
    }

    #[test]
    fn forged_author_signature_fails() {
        let (author, mallory) = (generate_signing_key(), generate_signing_key());
        let root = CircleKey::random_root();
        // Mallory holds the circle key (she's a friend) and forges a post "from" the author.
        let sealed = seal_post(
            &mallory,
            &AUTHOR,
            &[1; 16],
            &EPOCH,
            std::slice::from_ref(&root),
            &header(),
        )
        .unwrap();
        let err = open_as(&root, &author.verifying_key().to_bytes(), [1; 16], &sealed).err();
        assert_eq!(err, Some(CoreError::BadSignature));
    }

    #[test]
    fn moved_post_or_tampered_header_fails() {
        let author = generate_signing_key();
        let pk = author.verifying_key().to_bytes();
        let root = CircleKey::random_root();
        let sealed = seal_post(
            &author,
            &AUTHOR,
            &[1; 16],
            &EPOCH,
            std::slice::from_ref(&root),
            &header(),
        )
        .unwrap();
        // Same ciphertext presented under a different post id or epoch.
        assert!(open_post(
            &forward_keys(&root),
            &pk,
            &AUTHOR,
            &[2; 16],
            &EPOCH,
            &sealed.key_ref,
            &sealed.header_ct
        )
        .is_err());
        assert!(open_post(
            &forward_keys(&root),
            &pk,
            &AUTHOR,
            &[1; 16],
            &[0; 16],
            &sealed.key_ref,
            &sealed.header_ct
        )
        .is_err());
        // Flipping any byte of the real slot or of the body breaks it; filler slots carry nothing a reader uses
        // (integrity comes from the AEAD body and the author's signature), so flipping them changes nothing.
        let open = |t: &[u8]| open_post(&forward_keys(&root), &pk, &AUTHOR, &[1; 16], &EPOCH, &sealed.key_ref, t);
        let real = (0..POST_SLOTS)
            .find(|i| {
                let at = 1 + i * SLOT_LEN;
                root.matches_ref(&AUTHOR, &[1; 16], sealed.header_ct[at..at + 32].try_into().unwrap())
            })
            .unwrap();
        for i in 0..sealed.header_ct.len() {
            let mut t = sealed.header_ct.clone();
            t[i] ^= 0x80;
            let slot = (1..1 + POST_SLOTS * SLOT_LEN).contains(&i).then(|| (i - 1) / SLOT_LEN);
            if slot.is_some() && slot != Some(real) {
                assert_eq!(open(&t).unwrap().header, header(), "filler byte {i}");
            } else {
                assert!(open(&t).is_err(), "byte {i}");
            }
        }
    }

    /// v1.3 audiences: a post to several circles opens for a member of any of them, for nobody else, and looks the
    /// same size whatever the audience; slot positions are random.
    #[test]
    fn multi_circle_posts_open_only_for_members_and_hide_the_audience() {
        let author = generate_signing_key();
        let pk = author.verifying_key().to_bytes();
        let root = CircleKey::random_root();
        let x = |i| crate::chain::exclusive_key(&root, i).unwrap();
        let everyone = circle_key(&root, 2).unwrap();
        let open_with = |keys: &[CircleKey], sealed: &SealedPost, pid: [u8; 16]| {
            open_post(keys, &pk, &AUTHOR, &pid, &EPOCH, &sealed.key_ref, &sealed.header_ct)
        };

        let to_1_and_3 = seal_post(&author, &AUTHOR, &[7; 16], &EPOCH, &[x(1), x(3)], &header()).unwrap();
        assert!(open_with(&[x(1)], &to_1_and_3, [7; 16]).is_ok());
        assert!(open_with(&[x(3)], &to_1_and_3, [7; 16]).is_ok());
        assert!(
            open_with(&[x(2)], &to_1_and_3, [7; 16]).is_err(),
            "not in either circle"
        );
        assert!(
            open_with(&forward_keys(&everyone), &to_1_and_3, [7; 16]).is_err(),
            "Everyone isn't a member"
        );

        let to_everyone = seal_post(
            &author,
            &AUTHOR,
            &[8; 16],
            &EPOCH,
            std::slice::from_ref(&everyone),
            &header(),
        )
        .unwrap();
        let to_all_8 = seal_post(
            &author,
            &AUTHOR,
            &[9; 16],
            &EPOCH,
            &(1..=8).map(x).collect::<Vec<_>>(),
            &header(),
        )
        .unwrap();
        assert_eq!(to_1_and_3.header_ct.len(), to_everyone.header_ct.len());
        assert_eq!(to_everyone.header_ct.len(), to_all_8.header_ct.len());
        assert!(open_with(&forward_keys(&everyone), &to_everyone, [8; 16]).is_ok());

        // The real slot lands in different positions across posts.
        let positions: std::collections::HashSet<usize> = (0..40u8)
            .map(|n| {
                let s = seal_post(&author, &AUTHOR, &[n; 16], &EPOCH, &[x(1)], &header()).unwrap();
                (0..POST_SLOTS)
                    .find(|i| {
                        x(1).matches_ref(
                            &AUTHOR,
                            &[n; 16],
                            s.header_ct[1 + i * SLOT_LEN..33 + i * SLOT_LEN].try_into().unwrap(),
                        )
                    })
                    .unwrap()
            })
            .collect();
        assert!(positions.len() > 1, "slot order must be random");

        assert!(seal_post(&author, &AUTHOR, &[1; 16], &EPOCH, &[], &header()).is_err());
        assert!(seal_post(
            &author,
            &AUTHOR,
            &[1; 16],
            &EPOCH,
            &vec![everyone.clone(); 9],
            &header()
        )
        .is_err());
    }

    /// Posts sealed before v1.3 (single wrap, real key_ref in the row) still open.
    #[test]
    fn pre_v1_3_posts_still_open() {
        let author = generate_signing_key();
        let pk = author.verifying_key().to_bytes();
        let root = CircleKey::random_root();
        let c7 = circle_key(&root, 7).unwrap();
        let post_key = random_secret::<32>();
        let h = header();
        let sig = sign(&author, &post_sig_msg(&AUTHOR, &[1; 16], &EPOCH, &h));
        let wrapped = envelope::seal(
            &c7.wrap_key(),
            &*post_key,
            "circlo/v1/post-key",
            &[&AUTHOR, &[1; 16], &EPOCH],
        );
        let body = envelope::seal(
            &hkdf32(&*post_key, "circlo/v1/post-header"),
            &pad(&h.signed_cbor(&sig)).unwrap(),
            "circlo/v1/post-header",
            &[&AUTHOR, &[1; 16]],
        );
        let header_ct = [(wrapped.len() as u32).to_be_bytes().as_slice(), &wrapped, &body].concat();
        let key_ref = c7.key_ref(&AUTHOR, &[1; 16]);
        let got = open_post(&forward_keys(&c7), &pk, &AUTHOR, &[1; 16], &EPOCH, &key_ref, &header_ct).unwrap();
        assert_eq!(got.header, h);
    }

    #[test]
    fn rejects_long_text() {
        let author = generate_signing_key();
        let mut h = header();
        h.text = "x".repeat(501);
        assert!(seal_post(&author, &AUTHOR, &[1; 16], &EPOCH, &[CircleKey::random_root()], &h).is_err());
    }

    #[test]
    fn replies_round_trip_only_with_post_key_and_signature() {
        let author = generate_signing_key();
        let replier = generate_signing_key();
        let root = CircleKey::random_root();
        let sealed = seal_post(
            &author,
            &AUTHOR,
            &[1; 16],
            &EPOCH,
            std::slice::from_ref(&root),
            &header(),
        )
        .unwrap();
        let reply = Reply {
            text: "Nice!".into(),
            created_at_ms: 1,
        };
        let ct = seal_reply(&sealed.post_key, &replier, &[1; 16], &[2; 16], &[3; 16], &reply).unwrap();
        let rpk = replier.verifying_key().to_bytes();
        assert_eq!(
            open_reply(&sealed.post_key, &rpk, &[1; 16], &[2; 16], &[3; 16], &ct).unwrap(),
            reply
        );
        assert!(open_reply(&[0; 32], &rpk, &[1; 16], &[2; 16], &[3; 16], &ct).is_err());
        assert!(open_reply(
            &sealed.post_key,
            &author.verifying_key().to_bytes(),
            &[1; 16],
            &[2; 16],
            &[3; 16],
            &ct
        )
        .is_err());
        assert!(open_reply(&sealed.post_key, &rpk, &[1; 16], &[2; 16], &[4; 16], &ct).is_err());
    }

    #[test]
    fn read_token_is_per_post_and_stored_only_as_a_hash() {
        let (a, b) = ([1u8; 32], [2u8; 32]);
        assert_eq!(*read_token(&a), *read_token(&a));
        assert_ne!(*read_token(&a), *read_token(&b));
        assert_ne!(read_token_hash(&read_token(&a)), *read_token(&a));
        assert_ne!(*read_token(&a), a, "not the post key itself");
    }
}
