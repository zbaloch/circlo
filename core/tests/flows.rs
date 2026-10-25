//! End-to-end flows through the public FFI surface, as the app and server will call it.

use halqo_core::error::CoreError;
use halqo_core::ffi::*;

const SERVER_HANDLE_KEY: [u8; 32] = [0x11; 32];

struct Server {
    setup: Vec<u8>,
}

impl Server {
    fn new() -> Self {
        Server {
            setup: opaque_server_setup_new(),
        }
    }

    fn cred_id(&self, handle: &str) -> Vec<u8> {
        handle_lookup(&SERVER_HANDLE_KEY, handle).unwrap()
    }

    fn register(&self, handle: &str, password: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let reg = OpaqueClientRegistration::new(password).unwrap();
        let resp = opaque_server_registration_start(&self.setup, &self.cred_id(handle), &reg.request()).unwrap();
        let fin = reg.finish(handle, &resp).unwrap();
        (opaque_server_registration_finish(&fin.message).unwrap(), fin.export_key)
    }

    fn login(&self, record: Option<Vec<u8>>, handle: &str, password: &[u8]) -> Result<Vec<u8>, CoreError> {
        let login = OpaqueClientLogin::new(password)?;
        let start = opaque_server_login_start(&self.setup, record, &self.cred_id(handle), handle, &login.request())?;
        let fin = login.finish(handle, &start.response)?;
        opaque_server_login_finish(&start.state, handle, &fin.message)?;
        Ok(fin.export_key)
    }
}

fn backup_of(id: &IdentityKeys, epochs: Vec<EpochKeys>) -> KeyBackup {
    KeyBackup {
        x25519_sk: id.x25519_sk.clone(),
        ed25519_sk: id.ed25519_sk.clone(),
        data_key: new_symmetric_key(),
        local_root: new_symmetric_key(),
        epochs,
    }
}

/// Phase 4 criterion (crypto level): sign up on device A, log in on device B, same identity.
#[test]
fn signup_on_a_login_on_b_same_identity() {
    let server = Server::new();
    let user_id = [0x01; 16];
    let handle = "Alice_Test";

    // Device A: keys, OPAQUE registration, both backups.
    let id = generate_identity();
    let (record, export_key) = server.register(handle, b"long passphrase for alice");
    let phrase = new_recovery_phrase();
    let backup = backup_of(&id, vec![]);
    let pw_backup = seal_password_backup(&export_key, &user_id, &backup).unwrap();
    let rc_backup = seal_recovery_backup(&phrase.entropy, &user_id, &backup).unwrap();
    let recovery_pk = recovery_public_key(&phrase.entropy).unwrap();

    // Device B: login with the password, download and open the backup.
    let ek_b = server
        .login(Some(record.clone()), "alice_test", b"long passphrase for alice")
        .unwrap();
    let restored = open_password_backup(&ek_b, &user_id, &pw_backup).unwrap();
    assert_eq!(restored.ed25519_sk, id.ed25519_sk);
    assert_eq!(restored.x25519_sk, id.x25519_sk);

    // Wrong password: login fails, so the backup can't be opened.
    assert_eq!(
        server.login(Some(record), handle, b"wrong").err(),
        Some(CoreError::AuthFailed)
    );

    // Device C: forgot password; recovery phrase authenticates and opens the recovery copy.
    let entropy = recovery_entropy_from_phrase(&phrase.phrase.to_uppercase()).unwrap();
    let sig = sign_recovery_login(&entropy, &user_id, &[7; 16], &[8; 32], 1_900_000_000).unwrap();
    verify_recovery_login(&recovery_pk, &user_id, &[7; 16], &[8; 32], 1_900_000_000, &sig).unwrap();
    let recovered = open_recovery_backup(&entropy, &user_id, &rc_backup).unwrap();
    assert_eq!(recovered.ed25519_sk, id.ed25519_sk);
}

fn content(text: &str) -> PostContent {
    PostContent {
        text: text.into(),
        created_at_ms: 1,
        media: vec![],
    }
}

/// Phase 5–6 criteria (crypto level): friends exchange keys; circle 7 reads 7 and 9 not 5;
/// after moving 7 → 9 (new epoch) the friend can't read new circle-7 posts; payloads are identical in size.
#[test]
fn friends_circles_and_epoch_rotation() {
    let (alice_id, bob_id, carol_id) = ([0xA1; 16], [0xB0; 16], [0xC0; 16]);
    let (alice, bob, carol) = (generate_identity(), generate_identity(), generate_identity());

    // Alice's epoch 1: Bob in circle 7, Carol in circle 2.
    let (epoch1, root1, profile1) = ([0xE1; 16], new_symmetric_key(), new_symmetric_key());
    let to_bob = seal_friend_payload(
        &alice,
        &bob.x25519_pk,
        &alice_id,
        &bob_id,
        &epoch1,
        &root1,
        7,
        &profile1,
    )
    .unwrap();
    let to_carol = seal_friend_payload(
        &alice,
        &carol.x25519_pk,
        &alice_id,
        &carol_id,
        &epoch1,
        &root1,
        2,
        &profile1,
    )
    .unwrap();
    assert_eq!(to_bob.len(), to_carol.len(), "server can't tell circles apart by size");

    let bob_key = open_friend_payload(&bob, &alice.x25519_pk, &alice_id, &bob_id, &epoch1, &to_bob).unwrap();
    assert_eq!(bob_key.profile_key, profile1);
    let bob_ring = ReaderKeyring::new(&bob_key.circle_key).unwrap();

    // Profile readable with the shared profile key.
    let prof = seal_profile(&profile1, &alice_id, &epoch1, b"{\"displayName\":\"Alice\"}").unwrap();
    assert_eq!(
        open_profile(&bob_key.profile_key, &alice_id, &epoch1, &prof).unwrap(),
        b"{\"displayName\":\"Alice\"}"
    );

    let post = |epoch: &[u8], root: &[u8], circle: u8, pid: u8| {
        let s = seal_post(&alice, &alice_id, &[pid; 16], epoch, root, circle, &content("hi")).unwrap();
        (s, [pid; 16])
    };
    let read = |ring: &ReaderKeyring, epoch: &[u8], (s, pid): &(SealedPost, [u8; 16])| {
        ring.open_post(&alice.ed25519_pk, &alice_id, pid, epoch, &s.key_ref, &s.header_ct)
    };

    for (circle, readable) in [(5u8, false), (7, true), (9, true)] {
        let p = post(&epoch1, &root1, circle, circle);
        assert_eq!(read(&bob_ring, &epoch1, &p).is_ok(), readable, "circle {circle}");
    }
    // Alice reads all her own posts.
    let owner = ReaderKeyring::for_owner(&root1).unwrap();
    assert!(read(&owner, &epoch1, &post(&epoch1, &root1, 1, 50)).is_ok());

    // Move Bob 7 → 9: new epoch for everyone.
    let (epoch2, root2, profile2) = ([0xE2; 16], new_symmetric_key(), new_symmetric_key());
    let to_bob2 = seal_friend_payload(
        &alice,
        &bob.x25519_pk,
        &alice_id,
        &bob_id,
        &epoch2,
        &root2,
        9,
        &profile2,
    )
    .unwrap();
    let bob_key2 = open_friend_payload(&bob, &alice.x25519_pk, &alice_id, &bob_id, &epoch2, &to_bob2).unwrap();
    let bob_ring2 = ReaderKeyring::new(&bob_key2.circle_key).unwrap();

    let new_c7 = post(&epoch2, &root2, 7, 70);
    assert!(
        read(&bob_ring2, &epoch2, &new_c7).is_err(),
        "moved outward: new circle-7 posts are closed"
    );
    assert!(
        read(&bob_ring, &epoch2, &new_c7).is_err(),
        "old epoch key doesn't open new epoch"
    );
    assert!(read(&bob_ring2, &epoch2, &post(&epoch2, &root2, 9, 90)).is_ok());
    // Old posts he already had access to stay readable (no revocation of the past).
    assert!(read(&bob_ring, &epoch1, &post(&epoch1, &root1, 7, 71)).is_ok());

    // Replies: readable by anyone who can read the post.
    let (sealed, pid) = post(&epoch2, &root2, 9, 91);
    let opened = read(&bob_ring2, &epoch2, &(sealed, pid)).unwrap();
    let reply = ReplyContent {
        text: "👋".into(),
        created_at_ms: 2,
    };
    let rct = seal_reply(&opened.post_key, &bob, &pid, &[1; 16], &bob_id, &reply).unwrap();
    let back = open_reply(&opened.post_key, &bob.ed25519_pk, &pid, &[1; 16], &bob_id, &rct).unwrap();
    assert_eq!(back.text, "👋");
}

#[test]
fn identity_and_device_signatures_and_safety_numbers() {
    let (a, b) = (generate_identity(), generate_identity());
    let sig = sign_identity(&a, &[1; 16], 1).unwrap();
    verify_identity(&a.ed25519_pk, &[1; 16], 1, &a.x25519_pk, &sig).unwrap();
    assert!(verify_identity(&b.ed25519_pk, &[1; 16], 1, &a.x25519_pk, &sig).is_err());

    let dev = generate_device_keys();
    let cert = sign_device_certificate(&a, &[1; 16], &[2; 16], &dev.public_key).unwrap();
    verify_device_certificate(&a.ed25519_pk, &[1; 16], &[2; 16], &dev.public_key, &cert).unwrap();

    let ab = safety_number(
        &[1; 16],
        &a.ed25519_pk,
        &a.x25519_pk,
        &[2; 16],
        &b.ed25519_pk,
        &b.x25519_pk,
    )
    .unwrap();
    let ba = safety_number(
        &[2; 16],
        &b.ed25519_pk,
        &b.x25519_pk,
        &[1; 16],
        &a.ed25519_pk,
        &a.x25519_pk,
    )
    .unwrap();
    assert_eq!(ab.digits, ba.digits);
}

#[test]
fn media_file_round_trip_and_chunk_access() {
    let dir = tempfile::tempdir().unwrap();
    let (plain, enc, dec) = (dir.path().join("p"), dir.path().join("e"), dir.path().join("d"));
    let data: Vec<u8> = (0..300_000u32).map(|i| (i % 253) as u8).collect();
    std::fs::write(&plain, &data).unwrap();
    let key = new_symmetric_key();
    let object_key = "a".repeat(64);
    let object_id = object_id_from_object_key(&object_key).unwrap();

    let len = encrypt_file(plain.to_str().unwrap(), enc.to_str().unwrap(), &key, &object_id).unwrap();
    assert_eq!(len, data.len() as u64);
    let ct = std::fs::read(&enc).unwrap();
    assert_eq!(ct.len() as u64, media_layout(len).unwrap().encrypted_len);
    decrypt_file(enc.to_str().unwrap(), dec.to_str().unwrap(), &key, &object_id, len).unwrap();
    assert_eq!(std::fs::read(&dec).unwrap(), data);

    let d = MediaChunkDecryptor::new(&key, &object_id, &ct[..20], len).unwrap();
    let off = media_chunk_offset(1) as usize;
    assert_eq!(
        d.decrypt_chunk(1, &ct[off..off + 65_552]).unwrap(),
        data[65_536..131_072]
    );

    // Tampered file: decryption fails and leaves no partial output behind.
    let mut bad = ct.clone();
    bad[100] ^= 1;
    std::fs::write(&enc, &bad).unwrap();
    std::fs::remove_file(&dec).unwrap();
    assert!(decrypt_file(enc.to_str().unwrap(), dec.to_str().unwrap(), &key, &object_id, len).is_err());
    assert!(!dec.exists());
}

#[test]
fn ffi_rejects_wrong_lengths() {
    assert!(matches!(
        ReaderKeyring::new(&[0; 31]),
        Err(CoreError::InvalidInput { .. })
    ));
    assert!(object_id_from_object_key("XYZ").is_err());
    assert!(seal_profile(&[0; 32], &[0; 15], &[0; 16], b"x").is_err());
}

/// Phase 2 criterion support: a 200 MB file streams in constant memory. Run with
/// `cargo test --release -- --ignored large_file`.
#[test]
#[ignore]
fn large_file_200mb_streams() {
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    let (plain, enc, dec) = (dir.path().join("p"), dir.path().join("e"), dir.path().join("d"));
    let mut f = std::io::BufWriter::new(std::fs::File::create(&plain).unwrap());
    let block: Vec<u8> = (0..1_048_576u32).map(|i| (i % 251) as u8).collect();
    for _ in 0..200 {
        f.write_all(&block).unwrap();
    }
    drop(f);
    let key = new_symmetric_key();
    let len = encrypt_file(plain.to_str().unwrap(), enc.to_str().unwrap(), &key, &[9; 16]).unwrap();
    assert_eq!(len, 200 * 1_048_576);
    decrypt_file(enc.to_str().unwrap(), dec.to_str().unwrap(), &key, &[9; 16], len).unwrap();
    assert_eq!(std::fs::metadata(&dec).unwrap().len(), len);
}
