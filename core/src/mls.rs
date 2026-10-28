//! Messaging over MLS (RFC 9420) with OpenMLS (CRYPTO.md section 13a).
//!
//! One MLS client per device. The Basic credential is `user_id || device_id || binding`, where the binding is the
//! user's identity key signing the device's MLS signature key; apps verify it against pinned identity keys. OpenMLS
//! keeps its state in a `MemoryStorage`, which this module serializes and seals with the device's `local_cache_key`.

use std::collections::BTreeMap;

use ciborium::Value;
use ed25519_dalek::{Signature, Signer as _, SigningKey, VerifyingKey};
use openmls::prelude::tls_codec::{Deserialize as _, Serialize as _};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::{MemoryStorage, RustCrypto};
use openmls_traits::types::SignatureScheme;
use openmls_traits::OpenMlsProvider;
use zeroize::Zeroizing;

use crate::blob;
use crate::error::{invalid, CoreError, Result};
use crate::primitives::aad;

pub const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519;
const BINDING_LABEL: &str = "circlo/v1/mls-credential";
const STATE_LABEL_ID: [u8; 16] = *b"circlo-mlsstate1";
/// Padding applied by MLS to every PrivateMessage (on top of Padmé for application payloads).
const PADDING: usize = 64;

fn mls_err(what: &str) -> impl Fn(String) -> CoreError + '_ {
    move |detail| CoreError::InvalidInput {
        reason: format!("mls {what}: {detail}"),
    }
}

macro_rules! mls {
    ($what:expr, $e:expr) => {
        $e.map_err(|e| mls_err($what)(format!("{e:?}")))
    };
}

// ---------------- credential binding ----------------

fn binding_message(user_id: &[u8; 16], device_id: &[u8; 16], mls_sig_pk: &[u8]) -> Vec<u8> {
    aad(BINDING_LABEL, &[user_id, device_id, mls_sig_pk])
}

/// The identity key vouches for this device's MLS signature key.
pub fn sign_binding(identity_sk: &SigningKey, user_id: &[u8; 16], device_id: &[u8; 16], mls_sig_pk: &[u8]) -> [u8; 64] {
    identity_sk
        .sign(&binding_message(user_id, device_id, mls_sig_pk))
        .to_bytes()
}

pub fn verify_binding(
    identity_pk: &[u8; 32],
    user_id: &[u8; 16],
    device_id: &[u8; 16],
    mls_sig_pk: &[u8],
    binding: &[u8; 64],
) -> Result<()> {
    let pk = VerifyingKey::from_bytes(identity_pk).map_err(|_| CoreError::BadSignature)?;
    pk.verify_strict(
        &binding_message(user_id, device_id, mls_sig_pk),
        &Signature::from_bytes(binding),
    )
    .map_err(|_| CoreError::BadSignature)
}

/// A leaf's identity as carried in its Basic credential.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeafIdentity {
    pub user_id: [u8; 16],
    pub device_id: [u8; 16],
    pub binding: [u8; 64],
    pub signature_key: Vec<u8>,
}

fn parse_credential(credential: &Credential, signature_key: &[u8]) -> Result<LeafIdentity> {
    let id = credential.serialized_content();
    if id.len() != 96 {
        return Err(CoreError::Malformed);
    }
    Ok(LeafIdentity {
        user_id: id[..16].try_into().expect("16"),
        device_id: id[16..32].try_into().expect("16"),
        binding: id[32..].try_into().expect("64"),
        signature_key: signature_key.to_vec(),
    })
}

// ---------------- chat payload ----------------

/// The plaintext inside an MLS application message (CRYPTO.md 13a): CBOR `{1: kind, 2: text, 3: [media], 4: ts}`,
/// Padmé-padded so message sizes reveal little. Media descriptors carry each object's own `file_key`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatPayload {
    pub text: String,
    pub media: Vec<crate::post::MediaDescriptor>,
    /// The S3 object key for each media item (same order), so recipients can request download URLs.
    pub object_keys: Vec<String>,
    pub created_at_ms: u64,
}

const MAX_CHAT_TEXT_BYTES: usize = 4000 * 4;

pub fn encode_chat(p: &ChatPayload) -> Result<Vec<u8>> {
    if p.text.len() > MAX_CHAT_TEXT_BYTES || p.media.len() > crate::post::MAX_MEDIA {
        return Err(invalid("message too large"));
    }
    if p.object_keys.len() != p.media.len() || !p.object_keys.iter().all(|k| valid_object_key(k)) {
        return Err(invalid("bad object keys"));
    }
    let kind = u64::from(!p.media.is_empty());
    let v = crate::cbor::map(vec![
        (1, crate::cbor::uint(kind)),
        (2, Value::Text(p.text.clone())),
        (3, Value::Array(p.media.iter().map(|m| m.to_value()).collect())),
        (4, crate::cbor::uint(p.created_at_ms)),
        (
            5,
            Value::Array(p.object_keys.iter().map(|k| Value::Text(k.clone())).collect()),
        ),
    ]);
    crate::padding::pad(&crate::cbor::encode(&v))
}

pub fn decode_chat(bytes: &[u8]) -> Result<ChatPayload> {
    let plain = crate::padding::unpad(bytes)?;
    let mut f = crate::cbor::Fields::parse(crate::cbor::decode(&plain)?, &[1, 2, 3, 4, 5])?;
    let _kind = f.uint(1)?;
    let text = f.text(2, MAX_CHAT_TEXT_BYTES)?;
    let media = f
        .array(3, crate::post::MAX_MEDIA)?
        .into_iter()
        .map(crate::post::MediaDescriptor::from_value)
        .collect::<Result<Vec<_>>>()?;
    let created_at_ms = f.uint(4)?;
    let object_keys = f
        .array(5, crate::post::MAX_MEDIA)?
        .into_iter()
        .map(|v| match v {
            Value::Text(k) if valid_object_key(&k) => Ok(k),
            _ => Err(CoreError::Malformed),
        })
        .collect::<Result<Vec<_>>>()?;
    if object_keys.len() != media.len() {
        return Err(CoreError::Malformed);
    }
    Ok(ChatPayload {
        text,
        media,
        object_keys,
        created_at_ms,
    })
}

fn valid_object_key(k: &str) -> bool {
    k.len() == 64 && k.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

// ---------------- provider with exportable storage ----------------

#[derive(Default)]
struct Provider {
    crypto: RustCrypto,
    storage: MemoryStorage,
}

impl OpenMlsProvider for Provider {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = MemoryStorage;

    fn storage(&self) -> &Self::StorageProvider {
        &self.storage
    }
    fn crypto(&self) -> &Self::CryptoProvider {
        &self.crypto
    }
    fn rand(&self) -> &Self::RandProvider {
        &self.crypto
    }
}

// ---------------- results ----------------

#[derive(Debug)]
pub struct CommitOutput {
    pub commit: Vec<u8>,
    pub welcome: Option<Vec<u8>>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Received {
    /// An application message from a member.
    Application { sender: LeafIdentity, plaintext: Vec<u8> },
    /// A commit was applied; `removed_self` is true if it removed this device from the group.
    Commit { epoch: u64, removed_self: bool },
    /// A standalone proposal (stored; takes effect at the next commit).
    Proposal,
}

/// Unencrypted MLS framing the server may read to order a group's log.
#[derive(Debug, PartialEq, Eq)]
pub struct MessageMeta {
    pub group_id: Vec<u8>,
    pub epoch: u64,
    pub is_commit: bool,
}

/// Reads group id, epoch and whether a handshake message is a commit... from the clear framing only. For a
/// PrivateMessage the content type is visible (application vs handshake); a handshake from a member is a commit
/// in Circlo (proposals are always committed together).
pub fn message_meta(bytes: &[u8]) -> Result<MessageMeta> {
    let msg = MlsMessageIn::tls_deserialize_exact(bytes).map_err(|_| CoreError::Malformed)?;
    let proto = msg.try_into_protocol_message().map_err(|_| CoreError::Malformed)?;
    Ok(MessageMeta {
        group_id: proto.group_id().as_slice().to_vec(),
        epoch: proto.epoch().as_u64(),
        is_commit: proto.content_type() == ContentType::Commit,
    })
}

// ---------------- client ----------------

pub struct Client {
    provider: Provider,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
}

fn join_config() -> MlsGroupJoinConfig {
    MlsGroupJoinConfig::builder()
        .use_ratchet_tree_extension(true)
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .padding_size(PADDING)
        .build()
}

impl Client {
    /// `sig_sk`/`sig_pk` are this device's MLS signature key; `binding` is `sign_binding(...)` over `sig_pk`.
    /// `state` is a previous `export_state` (sealed), or `None` for a fresh device.
    pub fn new(
        user_id: [u8; 16],
        device_id: [u8; 16],
        sig_sk: &[u8; 32],
        sig_pk: &[u8; 32],
        binding: [u8; 64],
        state: Option<(&[u8; 32], &[u8])>,
    ) -> Result<Self> {
        let provider = Provider::default();
        if let Some((local_key, sealed)) = state {
            let plain = Zeroizing::new(blob::open_local(local_key, &STATE_LABEL_ID, sealed)?);
            restore_storage(&provider.storage, &plain)?;
        }
        let signer = SignatureKeyPair::from_raw(SignatureScheme::ED25519, sig_sk.to_vec(), sig_pk.to_vec());
        mls!("store signer", signer.store(provider.storage()))?;
        let mut identity = Vec::with_capacity(96);
        identity.extend_from_slice(&user_id);
        identity.extend_from_slice(&device_id);
        identity.extend_from_slice(&binding);
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity).into(),
            signature_key: sig_pk.to_vec().into(),
        };
        Ok(Client {
            provider,
            signer,
            credential,
        })
    }

    pub fn identity(&self) -> Result<LeafIdentity> {
        parse_credential(&self.credential.credential, self.credential.signature_key.as_slice())
    }

    /// Serializes and seals all MLS state (groups, secrets, unused key package private keys).
    pub fn export_state(&self, local_key: &[u8; 32]) -> Result<Vec<u8>> {
        let values = self.provider.storage.values.read().map_err(|_| invalid("state lock"))?;
        let sorted: BTreeMap<&Vec<u8>, &Vec<u8>> = values.iter().collect();
        let arr = Value::Array(
            sorted
                .into_iter()
                .map(|(k, v)| Value::Array(vec![Value::Bytes(k.clone()), Value::Bytes(v.clone())]))
                .collect(),
        );
        let mut plain = Zeroizing::new(Vec::new());
        ciborium::into_writer(&arr, &mut *plain).map_err(|_| invalid("state encode"))?;
        Ok(blob::seal_local(local_key, &STATE_LABEL_ID, &plain))
    }

    /// `count` one-time key packages and, if `last_resort`, one reusable last-resort package (TLS-serialized).
    pub fn key_packages(&self, count: usize, last_resort: bool) -> Result<Vec<Vec<u8>>> {
        let mut out = Vec::with_capacity(count + 1);
        for i in 0..count + usize::from(last_resort) {
            // Declaring LastResort support in every leaf lets peers validate last-resort packages.
            let mut builder = KeyPackage::builder().leaf_node_capabilities(Capabilities::new(
                None,
                None,
                Some(&[ExtensionType::LastResort]),
                None,
                None,
            ));
            if i == count {
                builder = builder.mark_as_last_resort();
            }
            let bundle = mls!(
                "key package",
                builder.build(SUITE, &self.provider, &self.signer, self.credential.clone())
            )?;
            out.push(mls!("serialize", bundle.key_package().tls_serialize_detached())?);
        }
        Ok(out)
    }

    fn group(&self, group_id: &[u8]) -> Result<MlsGroup> {
        mls!(
            "load",
            MlsGroup::load(self.provider.storage(), &GroupId::from_slice(group_id))
        )?
        .ok_or_else(|| invalid("unknown group"))
    }

    pub fn create_group(&self, group_id: &[u8; 16]) -> Result<()> {
        mls!(
            "create",
            MlsGroup::builder()
                .with_group_id(GroupId::from_slice(group_id))
                .ciphersuite(SUITE)
                .use_ratchet_tree_extension(true)
                .with_wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
                .padding_size(PADDING)
                .build(&self.provider, &self.signer, self.credential.clone())
        )?;
        Ok(())
    }

    /// Adds devices by their key packages. The commit is pending until `merge_pending_commit` (after the server
    /// accepted it) or `clear_pending_commit` (if it lost a race).
    pub fn add_members(&self, group_id: &[u8], key_packages: &[Vec<u8>]) -> Result<CommitOutput> {
        let mut group = self.group(group_id)?;
        let mut kps = Vec::with_capacity(key_packages.len());
        for bytes in key_packages {
            let kp_in = KeyPackageIn::tls_deserialize_exact(bytes).map_err(|_| CoreError::Malformed)?;
            let kp = mls!(
                "validate key package",
                kp_in.validate(self.provider.crypto(), ProtocolVersion::Mls10)
            )?;
            if kp.ciphersuite() != SUITE {
                return Err(invalid("wrong ciphersuite"));
            }
            parse_credential(kp.leaf_node().credential(), kp.leaf_node().signature_key().as_slice())?;
            kps.push(kp);
        }
        let (commit, welcome, _info) = mls!("add", group.add_members(&self.provider, &self.signer, &kps))?;
        Ok(CommitOutput {
            commit: mls!("serialize", commit.to_bytes())?,
            welcome: Some(mls!("serialize", welcome.to_bytes())?),
        })
    }

    /// Removes every leaf belonging to the given devices.
    pub fn remove_devices(&self, group_id: &[u8], devices: &[[u8; 16]]) -> Result<CommitOutput> {
        let mut group = self.group(group_id)?;
        let leaves: Vec<LeafNodeIndex> = group
            .members()
            .filter(|m| {
                parse_credential(&m.credential, &m.signature_key).is_ok_and(|id| devices.contains(&id.device_id))
            })
            .map(|m| m.index)
            .collect();
        if leaves.is_empty() {
            return Err(invalid("no such member"));
        }
        let (commit, welcome, _info) = mls!("remove", group.remove_members(&self.provider, &self.signer, &leaves))?;
        Ok(CommitOutput {
            commit: mls!("serialize", commit.to_bytes())?,
            welcome: welcome
                .map(|w| w.to_bytes())
                .transpose()
                .map_err(|e| mls_err("serialize")(format!("{e:?}")))?,
        })
    }

    pub fn merge_pending_commit(&self, group_id: &[u8]) -> Result<()> {
        let mut group = self.group(group_id)?;
        mls!("merge", group.merge_pending_commit(&self.provider))
    }

    pub fn clear_pending_commit(&self, group_id: &[u8]) -> Result<()> {
        let mut group = self.group(group_id)?;
        mls!("clear", group.clear_pending_commit(self.provider.storage()))
    }

    /// Joins a group from a Welcome; returns the group id.
    pub fn join(&self, welcome: &[u8]) -> Result<Vec<u8>> {
        let msg = MlsMessageIn::tls_deserialize_exact(welcome).map_err(|_| CoreError::Malformed)?;
        let MlsMessageBodyIn::Welcome(welcome) = msg.extract() else {
            return Err(CoreError::Malformed);
        };
        let staged = mls!(
            "welcome",
            StagedWelcome::new_from_welcome(&self.provider, &join_config(), welcome, None)
        )?;
        let group = mls!("join", staged.into_group(&self.provider))?;
        Ok(group.group_id().as_slice().to_vec())
    }

    pub fn encrypt(&self, group_id: &[u8], plaintext: &[u8]) -> Result<Vec<u8>> {
        let mut group = self.group(group_id)?;
        let msg = mls!("encrypt", group.create_message(&self.provider, &self.signer, plaintext))?;
        mls!("serialize", msg.to_bytes())
    }

    /// Decrypts and applies one message from the group's log. Commits from others are merged immediately (the
    /// server already ordered them).
    pub fn process(&self, bytes: &[u8]) -> Result<Received> {
        let msg = MlsMessageIn::tls_deserialize_exact(bytes).map_err(|_| CoreError::Malformed)?;
        let proto = msg.try_into_protocol_message().map_err(|_| CoreError::Malformed)?;
        let mut group = self.group(proto.group_id().as_slice())?;
        let processed = group
            .process_message(&self.provider, proto)
            .map_err(|_| CoreError::DecryptionFailed)?;
        let sender_cred = processed.credential().clone();
        let sender_key = match processed.sender() {
            Sender::Member(idx) => group
                .member(*idx)
                .map(|_| ())
                .and(group.members().find(|m| m.index == *idx).map(|m| m.signature_key)),
            _ => None,
        };
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(app) => Ok(Received::Application {
                sender: parse_credential(&sender_cred, &sender_key.unwrap_or_default())?,
                plaintext: app.into_bytes(),
            }),
            ProcessedMessageContent::StagedCommitMessage(staged) => {
                let removed_self = staged.self_removed();
                mls!("merge", group.merge_staged_commit(&self.provider, *staged))?;
                Ok(Received::Commit {
                    epoch: group.epoch().as_u64(),
                    removed_self,
                })
            }
            ProcessedMessageContent::ProposalMessage(p) => {
                mls!(
                    "store proposal",
                    group.store_pending_proposal(self.provider.storage(), *p)
                )?;
                Ok(Received::Proposal)
            }
            _ => Err(invalid("unsupported message")),
        }
    }

    pub fn members(&self, group_id: &[u8]) -> Result<Vec<LeafIdentity>> {
        self.group(group_id)?
            .members()
            .map(|m| parse_credential(&m.credential, &m.signature_key))
            .collect()
    }

    pub fn epoch(&self, group_id: &[u8]) -> Result<u64> {
        Ok(self.group(group_id)?.epoch().as_u64())
    }

    pub fn is_active(&self, group_id: &[u8]) -> Result<bool> {
        Ok(self.group(group_id)?.is_active())
    }
}

fn restore_storage(storage: &MemoryStorage, plain: &[u8]) -> Result<()> {
    let v: Value = ciborium::from_reader(plain).map_err(|_| CoreError::Malformed)?;
    let Value::Array(entries) = v else {
        return Err(CoreError::Malformed);
    };
    let mut map = storage.values.write().map_err(|_| invalid("state lock"))?;
    for e in entries {
        let Value::Array(kv) = e else {
            return Err(CoreError::Malformed);
        };
        match kv.as_slice() {
            [Value::Bytes(k), Value::Bytes(v)] => {
                map.insert(k.clone(), v.clone());
            }
            _ => return Err(CoreError::Malformed),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::primitives::random;

    struct Dev {
        identity_sk: SigningKey,
        client: Client,
    }

    fn device(identity_sk: &SigningKey, user: u8, dev: u8) -> Dev {
        let sig_sk: [u8; 32] = random();
        let sig_pk = SigningKey::from_bytes(&sig_sk).verifying_key().to_bytes();
        let (user_id, device_id) = ([user; 16], [dev; 16]);
        let binding = sign_binding(identity_sk, &user_id, &device_id, &sig_pk);
        Dev {
            identity_sk: identity_sk.clone(),
            client: Client::new(user_id, device_id, &sig_sk, &sig_pk, binding, None).unwrap(),
        }
    }

    fn kp(d: &Dev) -> Vec<u8> {
        d.client.key_packages(1, false).unwrap().remove(0)
    }

    fn text(d: &Dev, group: &[u8], t: &str) -> Vec<u8> {
        d.client.encrypt(group, t.as_bytes()).unwrap()
    }

    fn read(d: &Dev, msg: &[u8]) -> Option<String> {
        match d.client.process(msg) {
            Ok(Received::Application { plaintext, .. }) => Some(String::from_utf8(plaintext).unwrap()),
            _ => None,
        }
    }

    #[test]
    fn three_people_four_devices_then_removal() {
        let (alice_id, bob_id, carol_id) = (
            SigningKey::from_bytes(&random()),
            SigningKey::from_bytes(&random()),
            SigningKey::from_bytes(&random()),
        );
        let alice1 = device(&alice_id, 0xA1, 1);
        let alice2 = device(&alice_id, 0xA1, 2); // Alice's second device
        let bob = device(&bob_id, 0xB0, 3);
        let carol = device(&carol_id, 0xC0, 4);
        let group = [7u8; 16];

        alice1.client.create_group(&group).unwrap();
        let out = alice1
            .client
            .add_members(&group, &[kp(&alice2), kp(&bob), kp(&carol)])
            .unwrap();
        let meta = message_meta(&out.commit).unwrap();
        assert_eq!(
            (meta.group_id.as_slice(), meta.epoch, meta.is_commit),
            (&group[..], 0, true)
        );
        alice1.client.merge_pending_commit(&group).unwrap();
        let welcome = out.welcome.unwrap();
        for d in [&alice2, &bob, &carol] {
            assert_eq!(d.client.join(&welcome).unwrap(), group);
        }

        // Every leaf's binding verifies under its user's identity key; a wrong identity key fails.
        for m in alice1.client.members(&group).unwrap() {
            let id = match m.user_id[0] {
                0xA1 => &alice_id,
                0xB0 => &bob_id,
                _ => &carol_id,
            };
            verify_binding(
                &id.verifying_key().to_bytes(),
                &m.user_id,
                &m.device_id,
                &m.signature_key,
                &m.binding,
            )
            .unwrap();
            assert!(
                verify_binding(
                    &bob_id.verifying_key().to_bytes(),
                    &m.user_id,
                    &m.device_id,
                    &m.signature_key,
                    &m.binding
                )
                .is_err()
                    || m.user_id[0] == 0xB0
            );
        }
        assert_eq!(alice1.client.members(&group).unwrap().len(), 4);

        // A message reaches every other device, including the sender's own second device, with sender identity.
        let hello = text(&bob, &group, "hello from bob");
        assert!(!message_meta(&hello).unwrap().is_commit);
        for d in [&alice1, &alice2, &carol] {
            match d.client.process(&hello).unwrap() {
                Received::Application { sender, plaintext } => {
                    assert_eq!(plaintext, b"hello from bob");
                    assert_eq!((sender.user_id, sender.device_id), ([0xB0; 16], [3; 16]));
                }
                other => panic!("{other:?}"),
            }
        }

        // Carol removes Bob; Bob learns he was removed and can't read anything afterwards.
        let rm = carol.client.remove_devices(&group, &[[3; 16]]).unwrap();
        carol.client.merge_pending_commit(&group).unwrap();
        for d in [&alice1, &alice2] {
            assert_eq!(
                d.client.process(&rm.commit).unwrap(),
                Received::Commit {
                    epoch: 2,
                    removed_self: false
                }
            );
        }
        assert_eq!(
            bob.client.process(&rm.commit).unwrap(),
            Received::Commit {
                epoch: 2,
                removed_self: true
            }
        );
        assert!(!bob.client.is_active(&group).unwrap());
        let secret = text(&alice2, &group, "bob is gone");
        assert_eq!(read(&alice1, &secret).as_deref(), Some("bob is gone"));
        assert_eq!(read(&carol, &secret).as_deref(), Some("bob is gone"));
        assert_eq!(
            read(&bob, &secret),
            None,
            "removed member must not decrypt new messages"
        );
        assert_eq!(alice1.client.members(&group).unwrap().len(), 3);
        let _ = (&alice1.identity_sk, &carol.identity_sk);
    }

    #[test]
    fn state_survives_export_and_restore_and_is_sealed() {
        let id = SigningKey::from_bytes(&random());
        let a = device(&id, 1, 1);
        let b_sig: [u8; 32] = random();
        let b_pk = SigningKey::from_bytes(&b_sig).verifying_key().to_bytes();
        let b_binding = sign_binding(&id, &[2; 16], &[2; 16], &b_pk);
        let b = Client::new([2; 16], [2; 16], &b_sig, &b_pk, b_binding, None).unwrap();
        let group = [9u8; 16];
        a.client.create_group(&group).unwrap();
        let out = a
            .client
            .add_members(&group, &[b.key_packages(1, false).unwrap().remove(0)])
            .unwrap();
        a.client.merge_pending_commit(&group).unwrap();
        b.join(&out.welcome.unwrap()).unwrap();

        let key: [u8; 32] = random();
        let sealed = b.export_state(&key).unwrap();
        assert!(
            Client::new([2; 16], [2; 16], &b_sig, &b_pk, b_binding, Some((&[0; 32], &sealed))).is_err(),
            "wrong local key"
        );
        let b2 = Client::new([2; 16], [2; 16], &b_sig, &b_pk, b_binding, Some((&key, &sealed))).unwrap();
        let m = a.client.encrypt(&group, b"after restart").unwrap();
        assert!(
            matches!(b2.process(&m).unwrap(), Received::Application { plaintext, .. } if plaintext == b"after restart")
        );
    }

    #[test]
    fn chat_payload_round_trips_padded() {
        let p = ChatPayload {
            text: "hi 👋".into(),
            media: vec![],
            object_keys: vec![],
            created_at_ms: 42,
        };
        let enc = encode_chat(&p).unwrap();
        assert!(enc.len() >= 256, "padded to the minimum bucket");
        assert_eq!(decode_chat(&enc).unwrap(), p);
        let mut bad = enc.clone();
        bad[..4].copy_from_slice(&u32::MAX.to_be_bytes()); // length prefix beyond the buffer
        assert!(decode_chat(&bad).is_err());
        assert!(encode_chat(&ChatPayload {
            text: "x".repeat(MAX_CHAT_TEXT_BYTES + 1),
            media: vec![],
            object_keys: vec![],
            created_at_ms: 0
        })
        .is_err());
        assert!(encode_chat(&ChatPayload {
            text: "x".into(),
            media: vec![],
            object_keys: vec!["ab".into()],
            created_at_ms: 0
        })
        .is_err());
    }

    #[test]
    fn last_resort_key_package_and_garbage_rejected() {
        let id = SigningKey::from_bytes(&random());
        let a = device(&id, 1, 1);
        let kps = a.client.key_packages(3, true).unwrap();
        assert_eq!(kps.len(), 4);
        let last = KeyPackageIn::tls_deserialize_exact(&kps[3])
            .unwrap()
            .validate(a.client.provider.crypto(), ProtocolVersion::Mls10)
            .unwrap();
        assert!(last.last_resort());
        assert!(message_meta(b"not mls").is_err());
        assert!(a.client.process(b"not mls").is_err());
        a.client.create_group(&[1; 16]).unwrap();
        assert!(a.client.add_members(&[1; 16], &[b"junk".to_vec()]).is_err());
    }

    /// The identity point (small order) with R = identity, s = 0 passes non-strict Ed25519 for any message.
    #[test]
    fn binding_rejects_weak_identity_key() {
        use ed25519_dalek::Verifier as _;
        let mut weak_pk = [0u8; 32];
        weak_pk[0] = 1;
        let mut sig = [0u8; 64];
        sig[0] = 1;
        let lax = VerifyingKey::from_bytes(&weak_pk).unwrap();
        assert!(lax
            .verify(
                &binding_message(&[1; 16], &[2; 16], b"pk"),
                &Signature::from_bytes(&sig)
            )
            .is_ok());
        assert_eq!(
            verify_binding(&weak_pk, &[1; 16], &[2; 16], b"pk", &sig),
            Err(CoreError::BadSignature)
        );

        let id = SigningKey::from_bytes(&random());
        let good = sign_binding(&id, &[1; 16], &[2; 16], b"pk");
        assert!(verify_binding(&id.verifying_key().to_bytes(), &[1; 16], &[2; 16], b"pk", &good).is_ok());
    }
}
