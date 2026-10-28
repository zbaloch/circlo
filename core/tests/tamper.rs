//! Phase 1 criterion: tampered ciphertext always fails, for every ciphertext type.
//! Property tests flip a random bit, truncate, or extend each kind of ciphertext.

use circlo_core::ffi::*;
use proptest::prelude::*;

#[derive(Debug, Clone)]
enum Tamper {
    Flip { index: usize, bit: u8 },
    Truncate { keep: usize },
    Extend { byte: u8 },
}

fn apply(ct: &[u8], t: &Tamper) -> Vec<u8> {
    let mut v = ct.to_vec();
    match *t {
        Tamper::Flip { index, bit } => {
            let i = index % v.len();
            v[i] ^= 1 << (bit % 8);
        }
        Tamper::Truncate { keep } => v.truncate(keep % v.len()),
        Tamper::Extend { byte } => v.push(byte),
    }
    v
}

fn tamper() -> impl Strategy<Value = Tamper> {
    prop_oneof![
        (any::<usize>(), any::<u8>()).prop_map(|(index, bit)| Tamper::Flip { index, bit }),
        any::<usize>().prop_map(|keep| Tamper::Truncate { keep }),
        any::<u8>().prop_map(|byte| Tamper::Extend { byte }),
    ]
}

struct Fixture {
    alice: IdentityKeys,
    bob: IdentityKeys,
    root: Vec<u8>,
    post: SealedPost,
    reply: Vec<u8>,
    friend: Vec<u8>,
    profile: Vec<u8>,
    blob: Vec<u8>,
    backup: Vec<u8>,
    export_key: Vec<u8>,
    media: Vec<u8>,
    file_key: Vec<u8>,
}

const A: [u8; 16] = [0xA1; 16];
const B: [u8; 16] = [0xB0; 16];
const E: [u8; 16] = [0xE1; 16];
const P: [u8; 16] = [0x50; 16];

fn fixture() -> &'static Fixture {
    use std::sync::OnceLock;
    static F: OnceLock<Fixture> = OnceLock::new();
    F.get_or_init(|| {
        let (alice, bob) = (generate_identity(), generate_identity());
        let root = new_symmetric_key();
        let content = PostContent {
            text: "tamper target".into(),
            created_at_ms: 5,
            media: vec![],
        };
        let post = seal_post(&alice, &A, &P, &E, &root, 3, &content).unwrap();
        let reply = seal_reply(
            &post.post_key,
            &bob,
            &P,
            &[1; 16],
            &B,
            &ReplyContent {
                text: "r".into(),
                created_at_ms: 6,
            },
        )
        .unwrap();
        let friend = seal_friend_payload(&alice, &bob.x25519_pk, &A, &B, &E, &root, 3, &[4; 32]).unwrap();
        let profile = seal_profile(&[4; 32], &A, &E, b"profile").unwrap();
        let blob = seal_user_blob(&[5; 32], BlobKind::AddressBook, &A, b"address book").unwrap();
        let export_key = vec![6u8; 64];
        let backup = seal_password_backup(
            &export_key,
            &A,
            &KeyBackup {
                x25519_sk: alice.x25519_sk.clone(),
                ed25519_sk: alice.ed25519_sk.clone(),
                data_key: vec![5; 32],
                local_root: vec![7; 32],
                epochs: vec![EpochKeys {
                    epoch_id: E.to_vec(),
                    root: root.clone(),
                    profile_key: vec![4; 32],
                }],
            },
        )
        .unwrap();
        let file_key = new_symmetric_key();
        let dir = tempfile::tempdir().unwrap();
        let (p, e) = (dir.path().join("p"), dir.path().join("e"));
        std::fs::write(&p, vec![9u8; 70_000]).unwrap();
        encrypt_file(p.to_str().unwrap(), e.to_str().unwrap(), &file_key, &[8; 16]).unwrap();
        let media = std::fs::read(&e).unwrap();
        Fixture {
            alice,
            bob,
            root,
            post,
            reply,
            friend,
            profile,
            blob,
            backup,
            export_key,
            media,
            file_key,
        }
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn post_header(t in tamper()) {
        let f = fixture();
        let ring = ReaderKeyring::for_owner(&f.root).unwrap();
        prop_assert!(ring.open_post(&f.alice.ed25519_pk, &A, &P, &E, &f.post.key_ref, &apply(&f.post.header_ct, &t)).is_err());
        prop_assert!(ring.open_post(&f.alice.ed25519_pk, &A, &P, &E, &apply(&f.post.key_ref, &t), &f.post.header_ct).is_err());
    }

    #[test]
    fn reply(t in tamper()) {
        let f = fixture();
        prop_assert!(open_reply(&f.post.post_key, &f.bob.ed25519_pk, &P, &[1; 16], &B, &apply(&f.reply, &t)).is_err());
    }

    #[test]
    fn friend_payload(t in tamper()) {
        let f = fixture();
        prop_assert!(open_friend_payload(&f.bob, &f.alice.x25519_pk, &A, &B, &E, &apply(&f.friend, &t)).is_err());
    }

    #[test]
    fn profile_blob_and_backup(t in tamper()) {
        let f = fixture();
        prop_assert!(open_profile(&[4; 32], &A, &E, &apply(&f.profile, &t)).is_err());
        prop_assert!(open_user_blob(&[5; 32], BlobKind::AddressBook, &A, &apply(&f.blob, &t)).is_err());
        prop_assert!(open_password_backup(&f.export_key, &A, &apply(&f.backup, &t)).is_err());
    }

    #[test]
    fn media_stream(t in tamper()) {
        let f = fixture();
        let dir = tempfile::tempdir().unwrap();
        let (e, d) = (dir.path().join("e"), dir.path().join("d"));
        std::fs::write(&e, apply(&f.media, &t)).unwrap();
        prop_assert!(decrypt_file(e.to_str().unwrap(), d.to_str().unwrap(), &f.file_key, &[8; 16], 70_000).is_err());
    }
}

#[test]
fn untampered_fixture_opens() {
    let f = fixture();
    let ring = ReaderKeyring::for_owner(&f.root).unwrap();
    assert!(ring
        .open_post(&f.alice.ed25519_pk, &A, &P, &E, &f.post.key_ref, &f.post.header_ct)
        .is_ok());
    assert!(open_reply(&f.post.post_key, &f.bob.ed25519_pk, &P, &[1; 16], &B, &f.reply).is_ok());
    assert!(open_friend_payload(&f.bob, &f.alice.x25519_pk, &A, &B, &E, &f.friend).is_ok());
    assert!(open_password_backup(&f.export_key, &A, &f.backup).is_ok());
}
