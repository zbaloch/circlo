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
use crate::primitives::{hkdf32, labelled, random_secret, sha256};

pub const MAX_TEXT_CHARS: usize = 500;
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
    fn to_value(&self) -> Value {
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

    fn from_value(v: Value) -> Result<Self> {
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
        "halqo/v1/post-sig",
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

pub fn seal_post(
    author: &SigningKey,
    author_id: &[u8; 16],
    post_id: &[u8; 16],
    epoch_id: &[u8; 16],
    circle: &CircleKey,
    header: &PostHeader,
) -> Result<SealedPost> {
    header.validate()?;
    let post_key = random_secret::<32>();
    let sig = sign(author, &post_sig_msg(author_id, post_id, epoch_id, header));
    let body_plain = Zeroizing::new(pad(&header.signed_cbor(&sig))?);
    let wrapped = envelope::seal(
        &circle.wrap_key(),
        &*post_key,
        "halqo/v1/post-key",
        &[author_id, post_id, epoch_id],
    );
    let body = envelope::seal(
        &hkdf32(&*post_key, "halqo/v1/post-header"),
        &body_plain,
        "halqo/v1/post-header",
        &[author_id, post_id],
    );
    let mut header_ct = Vec::with_capacity(4 + wrapped.len() + body.len());
    header_ct.extend_from_slice(&(wrapped.len() as u32).to_be_bytes());
    header_ct.extend_from_slice(&wrapped);
    header_ct.extend_from_slice(&body);
    Ok(SealedPost {
        key_ref: circle.key_ref(author_id, post_id),
        header_ct,
        post_key,
    })
}

/// Tries each candidate chain key (a reader's forward keys for this epoch). Any failure → error.
pub fn open_post(
    candidates: &[CircleKey],
    author_ed25519_pk: &[u8; 32],
    author_id: &[u8; 16],
    post_id: &[u8; 16],
    epoch_id: &[u8; 16],
    key_ref: &[u8; 32],
    header_ct: &[u8],
) -> Result<OpenedPost> {
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
    let pk = Zeroizing::new(envelope::open(
        &circle.wrap_key(),
        wrapped,
        "halqo/v1/post-key",
        &[author_id, post_id, epoch_id],
    )?);
    let post_key: Zeroizing<[u8; 32]> =
        Zeroizing::new(pk.as_slice().try_into().map_err(|_| CoreError::DecryptionFailed)?);
    let padded = Zeroizing::new(envelope::open(
        &hkdf32(&*post_key, "halqo/v1/post-header"),
        body,
        "halqo/v1/post-header",
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
        "halqo/v1/reply-sig",
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
        &hkdf32(post_key, "halqo/v1/reply"),
        &padded,
        "halqo/v1/reply",
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
        &hkdf32(post_key, "halqo/v1/reply"),
        ciphertext,
        "halqo/v1/reply",
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
                &circle_key(&root, circle).unwrap(),
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
        let sealed = seal_post(&mallory, &AUTHOR, &[1; 16], &EPOCH, &root, &header()).unwrap();
        let err = open_as(&root, &author.verifying_key().to_bytes(), [1; 16], &sealed).err();
        assert_eq!(err, Some(CoreError::BadSignature));
    }

    #[test]
    fn moved_post_or_tampered_header_fails() {
        let author = generate_signing_key();
        let pk = author.verifying_key().to_bytes();
        let root = CircleKey::random_root();
        let sealed = seal_post(&author, &AUTHOR, &[1; 16], &EPOCH, &root, &header()).unwrap();
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
        for i in 0..sealed.header_ct.len() {
            let mut t = sealed.header_ct.clone();
            t[i] ^= 0x80;
            assert!(
                open_post(
                    &forward_keys(&root),
                    &pk,
                    &AUTHOR,
                    &[1; 16],
                    &EPOCH,
                    &sealed.key_ref,
                    &t
                )
                .is_err(),
                "byte {i}"
            );
        }
    }

    #[test]
    fn rejects_long_text() {
        let author = generate_signing_key();
        let mut h = header();
        h.text = "x".repeat(501);
        assert!(seal_post(&author, &AUTHOR, &[1; 16], &EPOCH, &CircleKey::random_root(), &h).is_err());
    }

    #[test]
    fn replies_round_trip_only_with_post_key_and_signature() {
        let author = generate_signing_key();
        let replier = generate_signing_key();
        let root = CircleKey::random_root();
        let sealed = seal_post(&author, &AUTHOR, &[1; 16], &EPOCH, &root, &header()).unwrap();
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
}
