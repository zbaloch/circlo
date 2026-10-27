//! uniffi surface (`@halqo/core` for the app; JNI for the server). Thin: validates lengths and converts types.
//! All logic lives in the modules it calls.
// Flat byte-array parameters are the point of an FFI layer.
#![allow(clippy::too_many_arguments)]

use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::sync::{Arc, Mutex};

use zeroize::Zeroizing;

use crate::backup::{self, BackupPayload, EpochSecrets};
use crate::blob;
pub use crate::blob::BlobKind;
use crate::chain::{circle_key, forward_keys, CircleKey};
use crate::error::{fixed, invalid, CoreError, Result};
use crate::friend::{self, FriendPayload};
use crate::identity::{self, Identity};
use crate::post::{self, MediaDescriptor, PostHeader, Reply};
use crate::primitives::random_secret;
use crate::stream::{self, ChunkCipher, Layout};
use crate::{opaque, recovery, social};

fn id16(b: &[u8], field: &str) -> Result<[u8; 16]> {
    fixed(b, field)
}
fn key32(b: &[u8], field: &str) -> Result<[u8; 32]> {
    fixed(b, field)
}
fn sig64(b: &[u8]) -> Result<[u8; 64]> {
    fixed(b, "signature")
}

// ---------------- records ----------------

#[derive(uniffi::Record)]
pub struct IdentityKeys {
    pub x25519_sk: Vec<u8>,
    pub x25519_pk: Vec<u8>,
    pub ed25519_sk: Vec<u8>,
    pub ed25519_pk: Vec<u8>,
}

impl IdentityKeys {
    fn load(&self) -> Result<Identity> {
        Identity::from_secrets(
            &key32(&self.x25519_sk, "x25519_sk")?,
            &key32(&self.ed25519_sk, "ed25519_sk")?,
        )
    }
}

#[derive(uniffi::Record)]
pub struct SigningKeyPair {
    pub secret_key: Vec<u8>,
    pub public_key: Vec<u8>,
}

#[derive(uniffi::Record, Clone)]
pub struct MediaItem {
    pub object_id: Vec<u8>,
    /// 0 = full, 1 = thumb, 2 = poster.
    pub kind: u8,
    pub mime: String,
    pub file_key: Vec<u8>,
    pub content_len: u64,
    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
}

#[derive(uniffi::Record, Clone)]
pub struct PostContent {
    pub text: String,
    pub created_at_ms: u64,
    pub media: Vec<MediaItem>,
}

impl PostContent {
    fn to_header(&self) -> Result<PostHeader> {
        Ok(PostHeader {
            text: self.text.clone(),
            created_at_ms: self.created_at_ms,
            media: self
                .media
                .iter()
                .map(|m| {
                    Ok(MediaDescriptor {
                        object_id: id16(&m.object_id, "object_id")?,
                        kind: m.kind,
                        mime: m.mime.clone(),
                        file_key: key32(&m.file_key, "file_key")?,
                        content_len: m.content_len,
                        width: m.width,
                        height: m.height,
                        duration_ms: m.duration_ms,
                    })
                })
                .collect::<Result<_>>()?,
        })
    }

    fn from_header(h: PostHeader) -> Self {
        PostContent {
            text: h.text,
            created_at_ms: h.created_at_ms,
            media: h
                .media
                .into_iter()
                .map(|m| MediaItem {
                    object_id: m.object_id.to_vec(),
                    kind: m.kind,
                    mime: m.mime,
                    file_key: m.file_key.to_vec(),
                    content_len: m.content_len,
                    width: m.width,
                    height: m.height,
                    duration_ms: m.duration_ms,
                })
                .collect(),
        }
    }
}

#[derive(uniffi::Record)]
pub struct SealedPost {
    pub key_ref: Vec<u8>,
    pub header_ct: Vec<u8>,
    pub post_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct OpenedPost {
    pub content: PostContent,
    pub post_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct ReplyContent {
    pub text: String,
    pub created_at_ms: u64,
}

#[derive(uniffi::Record)]
pub struct ReceivedFriendKey {
    pub epoch_id: Vec<u8>,
    pub circle_key: Vec<u8>,
    pub profile_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct EpochKeys {
    pub epoch_id: Vec<u8>,
    pub root: Vec<u8>,
    pub profile_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct KeyBackup {
    pub x25519_sk: Vec<u8>,
    pub ed25519_sk: Vec<u8>,
    pub data_key: Vec<u8>,
    pub local_root: Vec<u8>,
    pub epochs: Vec<EpochKeys>,
}

impl KeyBackup {
    fn to_payload(&self) -> Result<BackupPayload> {
        Ok(BackupPayload {
            x25519_sk: Zeroizing::new(key32(&self.x25519_sk, "x25519_sk")?),
            ed25519_sk: Zeroizing::new(key32(&self.ed25519_sk, "ed25519_sk")?),
            data_key: Zeroizing::new(key32(&self.data_key, "data_key")?),
            local_root: Zeroizing::new(key32(&self.local_root, "local_root")?),
            epochs: self
                .epochs
                .iter()
                .map(|e| {
                    Ok(EpochSecrets {
                        epoch_id: id16(&e.epoch_id, "epoch_id")?,
                        root: CircleKey::from_bytes(key32(&e.root, "root")?),
                        profile_key: Zeroizing::new(key32(&e.profile_key, "profile_key")?),
                    })
                })
                .collect::<Result<_>>()?,
        })
    }

    fn from_payload(p: BackupPayload) -> Self {
        KeyBackup {
            x25519_sk: p.x25519_sk.to_vec(),
            ed25519_sk: p.ed25519_sk.to_vec(),
            data_key: p.data_key.to_vec(),
            local_root: p.local_root.to_vec(),
            epochs: p
                .epochs
                .iter()
                .map(|e| EpochKeys {
                    epoch_id: e.epoch_id.to_vec(),
                    root: e.root.as_bytes().to_vec(),
                    profile_key: e.profile_key.to_vec(),
                })
                .collect(),
        }
    }
}

#[derive(uniffi::Record)]
pub struct RecoveryPhrase {
    pub phrase: String,
    pub entropy: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct SafetyNumber {
    pub digits: String,
    pub qr: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct OpaqueClientResult {
    /// Send to the server.
    pub message: Vec<u8>,
    /// Never leaves the device; derives the password backup key.
    pub export_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct OpaqueServerLoginStart {
    pub response: Vec<u8>,
    pub state: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct MediaLayout {
    pub padded_len: u64,
    pub chunks: u64,
    pub encrypted_len: u64,
}

// ---------------- keys and identity ----------------

#[uniffi::export]
pub fn generate_identity() -> IdentityKeys {
    let id = Identity::generate();
    IdentityKeys {
        x25519_sk: id.x25519_sk_bytes().to_vec(),
        x25519_pk: id.x25519_pk_bytes().to_vec(),
        ed25519_sk: id.ed25519_sk_bytes().to_vec(),
        ed25519_pk: id.ed25519_pk_bytes().to_vec(),
    }
}

/// Rebuilds the full identity (public keys included) from the secret keys in a restored backup.
#[uniffi::export]
pub fn identity_from_secrets(x25519_sk: &[u8], ed25519_sk: &[u8]) -> Result<IdentityKeys> {
    let id = Identity::from_secrets(&key32(x25519_sk, "x25519_sk")?, &key32(ed25519_sk, "ed25519_sk")?)?;
    Ok(IdentityKeys {
        x25519_sk: id.x25519_sk_bytes().to_vec(),
        x25519_pk: id.x25519_pk_bytes().to_vec(),
        ed25519_sk: id.ed25519_sk_bytes().to_vec(),
        ed25519_pk: id.ed25519_pk_bytes().to_vec(),
    })
}

#[uniffi::export]
pub fn sign_identity(identity: &IdentityKeys, user_id: &[u8], version: u8) -> Result<Vec<u8>> {
    Ok(identity
        .load()?
        .identity_sig(&id16(user_id, "user_id")?, version)
        .to_vec())
}

#[uniffi::export]
pub fn verify_identity(
    ed25519_pk: &[u8],
    user_id: &[u8],
    version: u8,
    x25519_pk: &[u8],
    signature: &[u8],
) -> Result<()> {
    identity::verify_identity_sig(
        &key32(ed25519_pk, "ed25519_pk")?,
        &id16(user_id, "user_id")?,
        version,
        &key32(x25519_pk, "x25519_pk")?,
        &sig64(signature)?,
    )
}

#[uniffi::export]
pub fn generate_device_keys() -> SigningKeyPair {
    let k = identity::generate_signing_key();
    SigningKeyPair {
        secret_key: k.to_bytes().to_vec(),
        public_key: k.verifying_key().to_bytes().to_vec(),
    }
}

#[uniffi::export]
pub fn sign_device_certificate(
    identity: &IdentityKeys,
    user_id: &[u8],
    device_id: &[u8],
    device_pk: &[u8],
) -> Result<Vec<u8>> {
    Ok(identity
        .load()?
        .device_cert(
            &id16(user_id, "user_id")?,
            &id16(device_id, "device_id")?,
            &key32(device_pk, "device_pk")?,
        )
        .to_vec())
}

#[uniffi::export]
pub fn verify_device_certificate(
    identity_ed25519_pk: &[u8],
    user_id: &[u8],
    device_id: &[u8],
    device_pk: &[u8],
    signature: &[u8],
) -> Result<()> {
    identity::verify_device_cert(
        &key32(identity_ed25519_pk, "identity_ed25519_pk")?,
        &id16(user_id, "user_id")?,
        &id16(device_id, "device_id")?,
        &key32(device_pk, "device_pk")?,
        &sig64(signature)?,
    )
}

/// 32 random bytes: data keys, profile keys, file keys, local cache keys, epoch roots, invite tokens.
#[uniffi::export]
pub fn new_symmetric_key() -> Vec<u8> {
    random_secret::<32>().to_vec()
}

// ---------------- circles, friends, posts ----------------

#[uniffi::export]
pub fn seal_friend_payload(
    sender: &IdentityKeys,
    recipient_x25519_pk: &[u8],
    from_user: &[u8],
    to_user: &[u8],
    epoch_id: &[u8],
    epoch_root: &[u8],
    circle: u8,
    profile_key: &[u8],
) -> Result<Vec<u8>> {
    let payload = FriendPayload {
        epoch_id: id16(epoch_id, "epoch_id")?,
        circle_key: circle_key(&CircleKey::from_bytes(key32(epoch_root, "epoch_root")?), circle)?,
        profile_key: Zeroizing::new(key32(profile_key, "profile_key")?),
    };
    friend::seal(
        &sender.load()?,
        &key32(recipient_x25519_pk, "recipient_x25519_pk")?,
        &id16(from_user, "from_user")?,
        &id16(to_user, "to_user")?,
        &payload,
    )
}

#[uniffi::export]
pub fn open_friend_payload(
    recipient: &IdentityKeys,
    sender_x25519_pk: &[u8],
    from_user: &[u8],
    to_user: &[u8],
    epoch_id: &[u8],
    payload: &[u8],
) -> Result<ReceivedFriendKey> {
    let p = friend::open(
        &recipient.load()?,
        &key32(sender_x25519_pk, "sender_x25519_pk")?,
        &id16(from_user, "from_user")?,
        &id16(to_user, "to_user")?,
        &id16(epoch_id, "epoch_id")?,
        payload,
    )?;
    Ok(ReceivedFriendKey {
        epoch_id: p.epoch_id.to_vec(),
        circle_key: p.circle_key.as_bytes().to_vec(),
        profile_key: p.profile_key.to_vec(),
    })
}

#[uniffi::export]
pub fn seal_post(
    author: &IdentityKeys,
    author_id: &[u8],
    post_id: &[u8],
    epoch_id: &[u8],
    epoch_root: &[u8],
    circle: u8,
    content: &PostContent,
) -> Result<SealedPost> {
    let id = author.load()?;
    let ck = circle_key(&CircleKey::from_bytes(key32(epoch_root, "epoch_root")?), circle)?;
    let s = post::seal_post(
        &id.ed25519,
        &id16(author_id, "author_id")?,
        &id16(post_id, "post_id")?,
        &id16(epoch_id, "epoch_id")?,
        &ck,
        &content.to_header()?,
    )?;
    Ok(SealedPost {
        key_ref: s.key_ref.to_vec(),
        header_ct: s.header_ct,
        post_key: s.post_key.to_vec(),
    })
}

/// Holds the forward keys a reader derives from one author-epoch `Ck`; build once, open many posts.
#[derive(uniffi::Object)]
pub struct ReaderKeyring {
    keys: Vec<CircleKey>,
}

#[uniffi::export]
impl ReaderKeyring {
    #[uniffi::constructor]
    pub fn new(circle_key: &[u8]) -> Result<Arc<Self>> {
        Ok(Arc::new(ReaderKeyring {
            keys: forward_keys(&CircleKey::from_bytes(key32(circle_key, "circle_key")?)),
        }))
    }

    /// Owner's own keyring: from the epoch root (C1), so they can read all their own posts.
    #[uniffi::constructor]
    pub fn for_owner(epoch_root: &[u8]) -> Result<Arc<Self>> {
        Self::new(epoch_root)
    }

    /// The owner's view as a friend in `circle` sees it ("Preview as…"): the same `Cn` that friend was given.
    #[uniffi::constructor]
    pub fn for_circle(epoch_root: &[u8], circle: u8) -> Result<Arc<Self>> {
        let root = CircleKey::from_bytes(key32(epoch_root, "epoch_root")?);
        Ok(Arc::new(ReaderKeyring {
            keys: forward_keys(&circle_key(&root, circle)?),
        }))
    }

    pub fn open_post(
        &self,
        author_ed25519_pk: &[u8],
        author_id: &[u8],
        post_id: &[u8],
        epoch_id: &[u8],
        key_ref: &[u8],
        header_ct: &[u8],
    ) -> Result<OpenedPost> {
        let o = post::open_post(
            &self.keys,
            &key32(author_ed25519_pk, "author_ed25519_pk")?,
            &id16(author_id, "author_id")?,
            &id16(post_id, "post_id")?,
            &id16(epoch_id, "epoch_id")?,
            &key32(key_ref, "key_ref")?,
            header_ct,
        )?;
        Ok(OpenedPost {
            content: PostContent::from_header(o.header),
            post_key: o.post_key.to_vec(),
        })
    }
}

#[uniffi::export]
pub fn seal_reply(
    post_key: &[u8],
    replier: &IdentityKeys,
    post_id: &[u8],
    reply_id: &[u8],
    replier_id: &[u8],
    reply: &ReplyContent,
) -> Result<Vec<u8>> {
    post::seal_reply(
        &key32(post_key, "post_key")?,
        &replier.load()?.ed25519,
        &id16(post_id, "post_id")?,
        &id16(reply_id, "reply_id")?,
        &id16(replier_id, "replier_id")?,
        &Reply {
            text: reply.text.clone(),
            created_at_ms: reply.created_at_ms,
        },
    )
}

#[uniffi::export]
pub fn open_reply(
    post_key: &[u8],
    replier_ed25519_pk: &[u8],
    post_id: &[u8],
    reply_id: &[u8],
    replier_id: &[u8],
    ciphertext: &[u8],
) -> Result<ReplyContent> {
    let r = post::open_reply(
        &key32(post_key, "post_key")?,
        &key32(replier_ed25519_pk, "replier_ed25519_pk")?,
        &id16(post_id, "post_id")?,
        &id16(reply_id, "reply_id")?,
        &id16(replier_id, "replier_id")?,
        ciphertext,
    )?;
    Ok(ReplyContent {
        text: r.text,
        created_at_ms: r.created_at_ms,
    })
}

// ---------------- media ----------------

/// S3 object keys are 64 hex chars (32 random bytes); the AAD object id is the first 16 bytes.
#[uniffi::export]
pub fn object_id_from_object_key(object_key: &str) -> Result<Vec<u8>> {
    if object_key.len() != 64
        || !object_key
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(invalid("object key must be 64 lowercase hex characters"));
    }
    (0..16)
        .map(|i| u8::from_str_radix(&object_key[2 * i..2 * i + 2], 16).map_err(|_| CoreError::Malformed))
        .collect()
}

#[uniffi::export]
pub fn media_layout(content_len: u64) -> Result<MediaLayout> {
    let l = Layout::for_content_len(content_len)?;
    Ok(MediaLayout {
        padded_len: l.padded_len,
        chunks: l.chunks,
        encrypted_len: l.encrypted_len(),
    })
}

#[uniffi::export]
pub fn media_chunk_offset(index: u64) -> u64 {
    Layout::chunk_offset(index)
}

/// Encrypts a file to `output_path` in constant memory. Returns the real content length.
#[uniffi::export]
pub fn encrypt_file(input_path: &str, output_path: &str, file_key: &[u8], object_id: &[u8]) -> Result<u64> {
    let input = File::open(input_path)?;
    let content_len = input.metadata()?.len();
    let mut out = BufWriter::new(File::create(output_path)?);
    stream::encrypt(
        &mut BufReader::new(input),
        &mut out,
        &key32(file_key, "file_key")?,
        &id16(object_id, "object_id")?,
        content_len,
    )?;
    Ok(content_len)
}

/// Decrypts to `output_path`; on any failure the partial output file is removed.
#[uniffi::export]
pub fn decrypt_file(
    input_path: &str,
    output_path: &str,
    file_key: &[u8],
    object_id: &[u8],
    content_len: u64,
) -> Result<()> {
    let key = key32(file_key, "file_key")?;
    let obj = id16(object_id, "object_id")?;
    let result = (|| {
        let mut out = BufWriter::new(File::create(output_path)?);
        stream::decrypt(
            &mut BufReader::new(File::open(input_path)?),
            &mut out,
            &key,
            &obj,
            content_len,
        )
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(output_path);
    }
    result
}

/// Random-access chunk decryption for progressive video playback.
#[derive(uniffi::Object)]
pub struct MediaChunkDecryptor {
    cipher: ChunkCipher,
    layout: Layout,
}

#[uniffi::export]
impl MediaChunkDecryptor {
    /// `header` is the first 20 bytes of the encrypted object.
    #[uniffi::constructor]
    pub fn new(file_key: &[u8], object_id: &[u8], header: &[u8], content_len: u64) -> Result<Arc<Self>> {
        Ok(Arc::new(MediaChunkDecryptor {
            cipher: ChunkCipher::from_header(&key32(file_key, "file_key")?, &id16(object_id, "object_id")?, header)?,
            layout: Layout::for_content_len(content_len)?,
        }))
    }

    pub fn decrypt_chunk(&self, index: u64, ciphertext: &[u8]) -> Result<Vec<u8>> {
        if index >= self.layout.chunks {
            return Err(CoreError::DecryptionFailed);
        }
        self.cipher
            .decrypt_chunk(index, index + 1 == self.layout.chunks, ciphertext)
    }
}

// ---------------- progressive playback ----------------

#[derive(uniffi::Record)]
pub struct ByteRange {
    pub start: u64,
    /// Exclusive.
    pub end: u64,
}

/// Plays one encrypted video through the core's loopback server (see `playback`). The app downloads the ranges from
/// `next_range` and passes them to `supply`; the player opens `url`. Closing (or dropping) ends the session.
#[derive(uniffi::Object)]
pub struct PlaybackSession {
    session: Arc<crate::playback::Session>,
    url: String,
    token: String,
}

#[uniffi::export]
impl PlaybackSession {
    /// `cache_path` receives the ciphertext (never plaintext).
    #[uniffi::constructor]
    pub fn new(
        cache_path: String,
        file_key: &[u8],
        object_id: &[u8],
        content_len: u64,
        mime: String,
    ) -> Result<Arc<Self>> {
        let session = Arc::new(crate::playback::Session::new(
            cache_path.into(),
            key32(file_key, "file_key")?,
            id16(object_id, "object_id")?,
            content_len,
            &mime,
        )?);
        let (url, token) = crate::playback::Server::shared()?.register(session.clone());
        Ok(Arc::new(PlaybackSession { session, url, token }))
    }

    pub fn url(&self) -> String {
        self.url.clone()
    }

    pub fn encrypted_len(&self) -> u64 {
        self.session.encrypted_len()
    }

    pub fn next_range(&self) -> Option<ByteRange> {
        self.session.next_range().map(|(start, end)| ByteRange { start, end })
    }

    pub fn supply(&self, offset: u64, bytes: &[u8]) -> Result<()> {
        self.session.supply(offset, bytes)
    }

    pub fn close(&self) {
        if let Ok(server) = crate::playback::Server::shared() {
            server.unregister(&self.token);
        }
    }
}

impl Drop for PlaybackSession {
    fn drop(&mut self) {
        self.close();
    }
}

// ---------------- backups and recovery ----------------

#[uniffi::export]
pub fn seal_password_backup(export_key: &[u8], user_id: &[u8], backup: &KeyBackup) -> Result<Vec<u8>> {
    let ek: Zeroizing<[u8; 64]> = Zeroizing::new(fixed(export_key, "export_key")?);
    backup::seal_password_backup(&ek, &id16(user_id, "user_id")?, &backup.to_payload()?)
}

#[uniffi::export]
pub fn open_password_backup(export_key: &[u8], user_id: &[u8], ciphertext: &[u8]) -> Result<KeyBackup> {
    let ek: Zeroizing<[u8; 64]> = Zeroizing::new(fixed(export_key, "export_key")?);
    Ok(KeyBackup::from_payload(backup::open_password_backup(
        &ek,
        &id16(user_id, "user_id")?,
        ciphertext,
    )?))
}

#[uniffi::export]
pub fn seal_recovery_backup(entropy: &[u8], user_id: &[u8], backup: &KeyBackup) -> Result<Vec<u8>> {
    let e = Zeroizing::new(key32(entropy, "entropy")?);
    backup::seal_recovery_backup(&e, &id16(user_id, "user_id")?, &backup.to_payload()?)
}

#[uniffi::export]
pub fn open_recovery_backup(entropy: &[u8], user_id: &[u8], ciphertext: &[u8]) -> Result<KeyBackup> {
    let e = Zeroizing::new(key32(entropy, "entropy")?);
    Ok(KeyBackup::from_payload(backup::open_recovery_backup(
        &e,
        &id16(user_id, "user_id")?,
        ciphertext,
    )?))
}

#[uniffi::export]
pub fn new_recovery_phrase() -> RecoveryPhrase {
    let e = recovery::new_entropy();
    RecoveryPhrase {
        phrase: recovery::phrase_from_entropy(&e).to_string(),
        entropy: e.to_vec(),
    }
}

#[uniffi::export]
pub fn recovery_entropy_from_phrase(phrase: &str) -> Result<Vec<u8>> {
    Ok(recovery::entropy_from_phrase(phrase)?.to_vec())
}

#[uniffi::export]
pub fn recovery_public_key(entropy: &[u8]) -> Result<Vec<u8>> {
    Ok(recovery::recovery_public_key(&key32(entropy, "entropy")?).to_vec())
}

#[uniffi::export]
pub fn sign_recovery_login(
    entropy: &[u8],
    user_id: &[u8],
    challenge_id: &[u8],
    nonce: &[u8],
    expires_at: u64,
) -> Result<Vec<u8>> {
    let e = Zeroizing::new(key32(entropy, "entropy")?);
    Ok(recovery::sign_recovery_login(
        &e,
        &id16(user_id, "user_id")?,
        &id16(challenge_id, "challenge_id")?,
        &key32(nonce, "nonce")?,
        expires_at,
    )
    .to_vec())
}

#[uniffi::export]
pub fn verify_recovery_login(
    recovery_pubkey: &[u8],
    user_id: &[u8],
    challenge_id: &[u8],
    nonce: &[u8],
    expires_at: u64,
    signature: &[u8],
) -> Result<()> {
    recovery::verify_recovery_login(
        &key32(recovery_pubkey, "recovery_pubkey")?,
        &id16(user_id, "user_id")?,
        &id16(challenge_id, "challenge_id")?,
        &key32(nonce, "nonce")?,
        expires_at,
        &sig64(signature)?,
    )
}

// ---------------- blobs ----------------

#[uniffi::export]
pub fn seal_profile(profile_key: &[u8], user_id: &[u8], epoch_id: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
    blob::seal_profile(
        &key32(profile_key, "profile_key")?,
        &id16(user_id, "user_id")?,
        &id16(epoch_id, "epoch_id")?,
        plaintext,
    )
}

#[uniffi::export]
pub fn open_profile(profile_key: &[u8], user_id: &[u8], epoch_id: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
    blob::open_profile(
        &key32(profile_key, "profile_key")?,
        &id16(user_id, "user_id")?,
        &id16(epoch_id, "epoch_id")?,
        ciphertext,
    )
}

#[uniffi::export]
pub fn seal_user_blob(data_key: &[u8], kind: BlobKind, user_id: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
    blob::seal_user_blob(
        &key32(data_key, "data_key")?,
        kind,
        &id16(user_id, "user_id")?,
        plaintext,
    )
}

#[uniffi::export]
pub fn open_user_blob(data_key: &[u8], kind: BlobKind, user_id: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
    blob::open_user_blob(
        &key32(data_key, "data_key")?,
        kind,
        &id16(user_id, "user_id")?,
        ciphertext,
    )
}

#[uniffi::export]
pub fn seal_local(local_cache_key: &[u8], file_id: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
    Ok(blob::seal_local(
        &key32(local_cache_key, "local_cache_key")?,
        &id16(file_id, "file_id")?,
        plaintext,
    ))
}

#[uniffi::export]
pub fn open_local(local_cache_key: &[u8], file_id: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
    blob::open_local(
        &key32(local_cache_key, "local_cache_key")?,
        &id16(file_id, "file_id")?,
        ciphertext,
    )
}

#[uniffi::export]
pub fn seal_push_token(push_key: &[u8], device_id: &[u8], token: &[u8]) -> Result<Vec<u8>> {
    blob::seal_push_token(&key32(push_key, "push_key")?, &id16(device_id, "device_id")?, token)
}

#[uniffi::export]
pub fn open_push_token(push_key: &[u8], device_id: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
    blob::open_push_token(
        &key32(push_key, "push_key")?,
        &id16(device_id, "device_id")?,
        ciphertext,
    )
}

// ---------------- handles, invites, safety numbers ----------------

#[uniffi::export]
pub fn normalize_handle(handle: &str) -> Result<String> {
    social::normalize_handle(handle)
}

#[uniffi::export]
pub fn handle_lookup(handle_key: &[u8], handle: &str) -> Result<Vec<u8>> {
    Ok(social::handle_lookup(&key32(handle_key, "handle_key")?, handle)?.to_vec())
}

#[uniffi::export]
pub fn identity_fingerprint(ed25519_pk: &[u8], x25519_pk: &[u8]) -> Result<Vec<u8>> {
    Ok(social::fingerprint(&key32(ed25519_pk, "ed25519_pk")?, &key32(x25519_pk, "x25519_pk")?).to_vec())
}

#[uniffi::export]
pub fn invite_token_hash(token: &[u8]) -> Result<Vec<u8>> {
    Ok(social::invite_token_hash(&key32(token, "token")?).to_vec())
}

#[uniffi::export]
pub fn safety_number(
    user_a: &[u8],
    ed25519_a: &[u8],
    x25519_a: &[u8],
    user_b: &[u8],
    ed25519_b: &[u8],
    x25519_b: &[u8],
) -> Result<SafetyNumber> {
    let (ua, ea, xa) = (
        id16(user_a, "user_a")?,
        key32(ed25519_a, "ed25519_a")?,
        key32(x25519_a, "x25519_a")?,
    );
    let (ub, eb, xb) = (
        id16(user_b, "user_b")?,
        key32(ed25519_b, "ed25519_b")?,
        key32(x25519_b, "x25519_b")?,
    );
    let s = social::safety_number((&ua, &ea, &xa), (&ub, &eb, &xb));
    Ok(SafetyNumber {
        digits: s.digits,
        qr: s.qr,
    })
}

// ---------------- OPAQUE: client ----------------

/// One registration attempt. Holds the password and protocol state between the two round trips.
#[derive(uniffi::Object)]
pub struct OpaqueClientRegistration {
    password: Zeroizing<Vec<u8>>,
    request: Vec<u8>,
    state: Mutex<Option<opaque_ke::ClientRegistration<opaque::Suite>>>,
}

#[uniffi::export]
impl OpaqueClientRegistration {
    #[uniffi::constructor]
    pub fn new(password: &[u8]) -> Result<Arc<Self>> {
        let (request, state) = opaque::client_registration_start(password)?;
        Ok(Arc::new(OpaqueClientRegistration {
            password: Zeroizing::new(password.to_vec()),
            request,
            state: Mutex::new(Some(state)),
        }))
    }

    pub fn request(&self) -> Vec<u8> {
        self.request.clone()
    }

    pub fn finish(&self, handle: &str, response: &[u8]) -> Result<OpaqueClientResult> {
        let state = self
            .state
            .lock()
            .map_err(|_| CoreError::AuthFailed)?
            .take()
            .ok_or(CoreError::AuthFailed)?;
        let (message, ek) =
            opaque::client_registration_finish(state, &self.password, &social::normalize_handle(handle)?, response)?;
        Ok(OpaqueClientResult {
            message,
            export_key: ek.to_vec(),
        })
    }
}

#[derive(uniffi::Object)]
pub struct OpaqueClientLogin {
    password: Zeroizing<Vec<u8>>,
    request: Vec<u8>,
    state: Mutex<Option<opaque_ke::ClientLogin<opaque::Suite>>>,
}

#[uniffi::export]
impl OpaqueClientLogin {
    #[uniffi::constructor]
    pub fn new(password: &[u8]) -> Result<Arc<Self>> {
        let (request, state) = opaque::client_login_start(password)?;
        Ok(Arc::new(OpaqueClientLogin {
            password: Zeroizing::new(password.to_vec()),
            request,
            state: Mutex::new(Some(state)),
        }))
    }

    pub fn request(&self) -> Vec<u8> {
        self.request.clone()
    }

    pub fn finish(&self, handle: &str, response: &[u8]) -> Result<OpaqueClientResult> {
        let state = self
            .state
            .lock()
            .map_err(|_| CoreError::AuthFailed)?
            .take()
            .ok_or(CoreError::AuthFailed)?;
        let (message, ek) =
            opaque::client_login_finish(state, &self.password, &social::normalize_handle(handle)?, response)?;
        Ok(OpaqueClientResult {
            message,
            export_key: ek.to_vec(),
        })
    }
}

// ---------------- OPAQUE: server ----------------

#[uniffi::export]
pub fn opaque_server_setup_new() -> Vec<u8> {
    opaque::server_setup_new().to_vec()
}

#[uniffi::export]
pub fn opaque_server_registration_start(
    server_setup: &[u8],
    credential_identifier: &[u8],
    request: &[u8],
) -> Result<Vec<u8>> {
    opaque::server_registration_start(server_setup, credential_identifier, request)
}

#[uniffi::export]
pub fn opaque_server_registration_finish(upload: &[u8]) -> Result<Vec<u8>> {
    opaque::server_registration_finish(upload)
}

#[uniffi::export]
pub fn opaque_server_login_start(
    server_setup: &[u8],
    record: Option<Vec<u8>>,
    credential_identifier: &[u8],
    handle: &str,
    request: &[u8],
) -> Result<OpaqueServerLoginStart> {
    let (response, state) = opaque::server_login_start(
        server_setup,
        record.as_deref(),
        credential_identifier,
        &social::normalize_handle(handle)?,
        request,
    )?;
    Ok(OpaqueServerLoginStart {
        response,
        state: state.to_vec(),
    })
}

#[uniffi::export]
pub fn opaque_server_login_finish(state: &[u8], handle: &str, finalization: &[u8]) -> Result<()> {
    opaque::server_login_finish(state, &social::normalize_handle(handle)?, finalization)
}

// ---------------- messaging (MLS, CRYPTO.md section 13a) ----------------

#[derive(uniffi::Record)]
pub struct MlsMember {
    pub user_id: Vec<u8>,
    pub device_id: Vec<u8>,
    pub binding: Vec<u8>,
    pub signature_key: Vec<u8>,
}

impl From<crate::mls::LeafIdentity> for MlsMember {
    fn from(l: crate::mls::LeafIdentity) -> Self {
        MlsMember {
            user_id: l.user_id.to_vec(),
            device_id: l.device_id.to_vec(),
            binding: l.binding.to_vec(),
            signature_key: l.signature_key,
        }
    }
}

#[derive(uniffi::Record)]
pub struct MlsCommit {
    pub commit: Vec<u8>,
    pub welcome: Option<Vec<u8>>,
}

#[derive(uniffi::Enum)]
pub enum MlsReceived {
    Application { sender: MlsMember, plaintext: Vec<u8> },
    Commit { epoch: u64, removed_self: bool },
    Proposal,
}

#[derive(uniffi::Record)]
pub struct MlsMessageMeta {
    pub group_id: Vec<u8>,
    pub epoch: u64,
    pub is_commit: bool,
}

/// A chat message: text, media descriptors (with their keys) and the matching object keys.
#[derive(uniffi::Record)]
pub struct ChatContent {
    pub text: String,
    pub created_at_ms: u64,
    pub media: Vec<MediaItem>,
    pub object_keys: Vec<String>,
}

/// Encodes and pads a chat message for `MlsClient::encrypt`.
#[uniffi::export]
pub fn encode_chat_payload(content: &ChatContent) -> Result<Vec<u8>> {
    let h = PostContent {
        text: content.text.clone(),
        created_at_ms: content.created_at_ms,
        media: content.media.clone(),
    }
    .to_header()?;
    crate::mls::encode_chat(&crate::mls::ChatPayload {
        text: h.text,
        media: h.media,
        object_keys: content.object_keys.clone(),
        created_at_ms: h.created_at_ms,
    })
}

/// Inverse of `encode_chat_payload` for a decrypted application message.
#[uniffi::export]
pub fn decode_chat_payload(bytes: &[u8]) -> Result<ChatContent> {
    let p = crate::mls::decode_chat(bytes)?;
    let c = PostContent::from_header(PostHeader {
        text: p.text,
        media: p.media,
        created_at_ms: p.created_at_ms,
    });
    Ok(ChatContent {
        text: c.text,
        created_at_ms: c.created_at_ms,
        media: c.media,
        object_keys: p.object_keys,
    })
}

// ---------------- device linking (CRYPTO.md 13b) ----------------

#[derive(uniffi::Record)]
pub struct LinkKeyPair {
    pub secret_key: Vec<u8>,
    pub public_key: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct LinkHandoff {
    pub backup: KeyBackup,
    pub handle: String,
}

/// The new device's one-time key for receiving the hand-off (its public half goes in the QR code).
#[uniffi::export]
pub fn link_generate_keys() -> LinkKeyPair {
    let k = crate::link::generate();
    LinkKeyPair {
        secret_key: k.secret.to_vec(),
        public_key: k.public.to_vec(),
    }
}

/// Six digits shown on both screens so the user can check they scanned their own new phone.
#[uniffi::export]
pub fn link_confirmation_code(link_public_key: &[u8]) -> Result<String> {
    Ok(crate::link::confirmation_code(&key32(
        link_public_key,
        "link_public_key",
    )?))
}

/// The signed-in device seals the account secrets to the new device's link key.
#[uniffi::export]
pub fn link_seal(
    link_public_key: &[u8],
    link_id: &[u8],
    user_id: &[u8],
    backup: &KeyBackup,
    handle: String,
) -> Result<Vec<u8>> {
    crate::link::seal(
        &key32(link_public_key, "link_public_key")?,
        &key32(link_id, "link_id")?,
        &id16(user_id, "user_id")?,
        &crate::link::LinkPayload {
            backup: backup.to_payload()?,
            handle,
        },
    )
}

#[uniffi::export]
pub fn link_open(link_secret_key: &[u8], link_id: &[u8], user_id: &[u8], sealed: &[u8]) -> Result<LinkHandoff> {
    let sk = Zeroizing::new(key32(link_secret_key, "link_secret_key")?);
    let p = crate::link::open(&sk, &key32(link_id, "link_id")?, &id16(user_id, "user_id")?, sealed)?;
    Ok(LinkHandoff {
        backup: KeyBackup::from_payload(p.backup),
        handle: p.handle,
    })
}

/// A fresh Ed25519 key pair for this device's MLS signatures (never used for anything else).
#[uniffi::export]
pub fn mls_generate_signer() -> SigningKeyPair {
    let sk = ed25519_dalek::SigningKey::from_bytes(&random_secret::<32>());
    SigningKeyPair {
        public_key: sk.verifying_key().to_bytes().to_vec(),
        secret_key: sk.to_bytes().to_vec(),
    }
}

/// The identity key vouches for a device's MLS signature key (the credential binding).
#[uniffi::export]
pub fn mls_bind_credential(
    identity: &IdentityKeys,
    user_id: &[u8],
    device_id: &[u8],
    mls_sig_pk: &[u8],
) -> Result<Vec<u8>> {
    Ok(crate::mls::sign_binding(
        &identity.load()?.ed25519,
        &id16(user_id, "user_id")?,
        &id16(device_id, "device_id")?,
        &key32(mls_sig_pk, "mls_sig_pk")?,
    )
    .to_vec())
}

/// Checks a group member's binding against the identity key the app has (pinned) for that user.
#[uniffi::export]
pub fn mls_verify_member(identity_ed25519_pk: &[u8], member: &MlsMember) -> Result<()> {
    crate::mls::verify_binding(
        &key32(identity_ed25519_pk, "identity_ed25519_pk")?,
        &id16(&member.user_id, "user_id")?,
        &id16(&member.device_id, "device_id")?,
        &member.signature_key,
        &fixed::<64>(&member.binding, "binding")?,
    )
}

/// Group id, epoch and commit flag from an MLS message's clear framing (what the server may see).
#[uniffi::export]
pub fn mls_message_meta(message: &[u8]) -> Result<MlsMessageMeta> {
    let m = crate::mls::message_meta(message)?;
    Ok(MlsMessageMeta {
        group_id: m.group_id,
        epoch: m.epoch,
        is_commit: m.is_commit,
    })
}

/// This device's MLS client. State is restored from, and should be saved back to, a blob sealed with the
/// device's `local_cache_key` (`export_state`) after every call that changes it.
#[derive(uniffi::Object)]
pub struct MlsClient {
    inner: Mutex<crate::mls::Client>,
}

#[uniffi::export]
impl MlsClient {
    #[uniffi::constructor]
    pub fn new(
        user_id: &[u8],
        device_id: &[u8],
        sig_sk: &[u8],
        sig_pk: &[u8],
        binding: &[u8],
        local_cache_key: &[u8],
        sealed_state: Option<Vec<u8>>,
    ) -> Result<Arc<Self>> {
        let key = key32(local_cache_key, "local_cache_key")?;
        let sk = Zeroizing::new(key32(sig_sk, "sig_sk")?);
        let client = crate::mls::Client::new(
            id16(user_id, "user_id")?,
            id16(device_id, "device_id")?,
            &sk,
            &key32(sig_pk, "sig_pk")?,
            fixed::<64>(binding, "binding")?,
            sealed_state.as_deref().map(|s| (&key, s)),
        )?;
        Ok(Arc::new(MlsClient {
            inner: Mutex::new(client),
        }))
    }

    pub fn export_state(&self, local_cache_key: &[u8]) -> Result<Vec<u8>> {
        self.lock()?.export_state(&key32(local_cache_key, "local_cache_key")?)
    }

    pub fn key_packages(&self, count: u32, last_resort: bool) -> Result<Vec<Vec<u8>>> {
        self.lock()?.key_packages(count.min(100) as usize, last_resort)
    }

    pub fn create_group(&self, group_id: &[u8]) -> Result<()> {
        self.lock()?.create_group(&id16(group_id, "group_id")?)
    }

    pub fn add_members(&self, group_id: &[u8], key_packages: Vec<Vec<u8>>) -> Result<MlsCommit> {
        let out = self.lock()?.add_members(group_id, &key_packages)?;
        Ok(MlsCommit {
            commit: out.commit,
            welcome: out.welcome,
        })
    }

    pub fn remove_devices(&self, group_id: &[u8], device_ids: Vec<Vec<u8>>) -> Result<MlsCommit> {
        let ids = device_ids
            .iter()
            .map(|d| id16(d, "device_id"))
            .collect::<Result<Vec<_>>>()?;
        let out = self.lock()?.remove_devices(group_id, &ids)?;
        Ok(MlsCommit {
            commit: out.commit,
            welcome: out.welcome,
        })
    }

    pub fn merge_pending_commit(&self, group_id: &[u8]) -> Result<()> {
        self.lock()?.merge_pending_commit(group_id)
    }

    pub fn clear_pending_commit(&self, group_id: &[u8]) -> Result<()> {
        self.lock()?.clear_pending_commit(group_id)
    }

    pub fn join(&self, welcome: &[u8]) -> Result<Vec<u8>> {
        self.lock()?.join(welcome)
    }

    pub fn encrypt(&self, group_id: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
        self.lock()?.encrypt(group_id, plaintext)
    }

    pub fn process(&self, message: &[u8]) -> Result<MlsReceived> {
        Ok(match self.lock()?.process(message)? {
            crate::mls::Received::Application { sender, plaintext } => MlsReceived::Application {
                sender: sender.into(),
                plaintext,
            },
            crate::mls::Received::Commit { epoch, removed_self } => MlsReceived::Commit { epoch, removed_self },
            crate::mls::Received::Proposal => MlsReceived::Proposal,
        })
    }

    pub fn members(&self, group_id: &[u8]) -> Result<Vec<MlsMember>> {
        Ok(self.lock()?.members(group_id)?.into_iter().map(Into::into).collect())
    }

    pub fn epoch(&self, group_id: &[u8]) -> Result<u64> {
        self.lock()?.epoch(group_id)
    }

    pub fn is_active(&self, group_id: &[u8]) -> Result<bool> {
        self.lock()?.is_active(group_id)
    }
}

impl MlsClient {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, crate::mls::Client>> {
        self.inner.lock().map_err(|_| invalid("mls client poisoned"))
    }
}

// ---------------- read tokens and reports (CRYPTO.md 13c) ----------------

/// The post's read token (proves to the server that I can open the post, without revealing anything else).
#[uniffi::export]
pub fn post_read_token(post_key: &[u8]) -> Result<Vec<u8>> {
    Ok(post::read_token(&key32(post_key, "post_key")?).to_vec())
}

/// Hash of a read token; sent once, when the post is created.
#[uniffi::export]
pub fn post_read_token_hash(read_token: &[u8]) -> Result<Vec<u8>> {
    Ok(post::read_token_hash(&key32(read_token, "read_token")?).to_vec())
}

/// Signs and seals a report for the operator's moderation key; the server only ever stores the ciphertext.
#[uniffi::export]
pub fn seal_report(
    moderation_public_key: &[u8],
    reporter: &IdentityKeys,
    reporter_id: &[u8],
    content: &[u8],
) -> Result<Vec<u8>> {
    crate::report::seal(
        &key32(moderation_public_key, "moderation_public_key")?,
        &reporter.load()?,
        &id16(reporter_id, "reporter_id")?,
        content,
    )
}
