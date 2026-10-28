//! Committed test vectors (core/test_vectors/vectors_TEST_ONLY.json). All keys here are public test values.
//! Regenerate deliberately with `CIRCLO_WRITE_VECTORS=1 cargo test vectors` — only after a CRYPTO.md change.

use std::collections::BTreeMap;

use crate::chain::{circle_key, exclusive_key, CircleKey};
use crate::envelope::seal_with_nonce;
use crate::identity::Identity;
use crate::padding::padme;
use crate::primitives::aad;
use crate::stream::ChunkCipher;
use crate::{recovery, social};

const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/test_vectors/vectors_TEST_ONLY.json");

fn compute() -> BTreeMap<String, String> {
    let mut v = BTreeMap::new();
    let mut put = |k: &str, bytes: &[u8]| {
        v.insert(k.to_owned(), hex::encode(bytes));
    };

    // Circle chain from a fixed root.
    let root = CircleKey::from_bytes([0x01; 32]);
    for n in [1u8, 2, 7, 9, 100] {
        put(&format!("chain.C{n}"), circle_key(&root, n).unwrap().as_bytes());
    }
    let c7 = circle_key(&root, 7).unwrap();
    put("chain.C7.wrap_key", &*c7.wrap_key());
    put("chain.C7.ref_key", &*c7.ref_key());
    put("chain.X1(close-friends)", exclusive_key(&root, 1).unwrap().as_bytes());
    put(
        "chain.C7.key_ref(author=a1*16,post=50*16)",
        &c7.key_ref(&[0xA1; 16], &[0x50; 16]),
    );

    // AAD and envelope with a fixed nonce.
    put(
        "aad(circlo/v1/post-key,a1*16,50*16)",
        &aad("circlo/v1/post-key", &[&[0xA1; 16], &[0x50; 16]]),
    );
    put(
        "envelope(key=07*32,nonce=24*24,label=circlo/v1/profile,fields=a1*16|e1*16,pt=hello)",
        &seal_with_nonce(
            &[0x07; 32],
            &[0x24; 24],
            b"hello",
            "circlo/v1/profile",
            &[&[0xA1; 16], &[0xE1; 16]],
        ),
    );

    // Media chunk with a fixed nonce prefix.
    let cc = ChunkCipher::new(&[0x03; 32], &[0x04; 16], &[0x19; 19]);
    put(
        "media.chunk0.last(key=03*32,obj=04*16,prefix=19*19,pt=abc)",
        &cc.encrypt(0, true, b"abc"),
    );

    // Identity signature (Ed25519 is deterministic).
    let id = Identity::from_secrets(&[0x21; 32], &[0x22; 32]).unwrap();
    put("identity.x25519_pk(sk=21*32)", &id.x25519_pk_bytes());
    put("identity.ed25519_pk(sk=22*32)", &id.ed25519_pk_bytes());
    put("identity.sig(user=01*16,v=1)", &id.identity_sig(&[0x01; 16], 1));

    // Handles, invites, fingerprints, safety numbers.
    put(
        "handle_lookup(key=11*32,handle=Alice_Test)",
        &social::handle_lookup(&[0x11; 32], "Alice_Test").unwrap(),
    );
    put("invite_token_hash(33*32)", &social::invite_token_hash(&[0x33; 32]));
    put(
        "fingerprint(ed=22pk,x=21pk)",
        &social::fingerprint(&id.ed25519_pk_bytes(), &id.x25519_pk_bytes()),
    );
    let other = Identity::from_secrets(&[0x31; 32], &[0x32; 32]).unwrap();
    let sn = social::safety_number(
        (&[0x01; 16], &id.ed25519_pk_bytes(), &id.x25519_pk_bytes()),
        (&[0x02; 16], &other.ed25519_pk_bytes(), &other.x25519_pk_bytes()),
    );
    put("safety_number.digits", sn.digits.as_bytes());
    put("safety_number.qr", &sn.qr);

    // Recovery.
    put(
        "recovery.phrase(entropy=44*32)",
        recovery::phrase_from_entropy(&[0x44; 32]).as_bytes(),
    );
    put(
        "recovery.pubkey(entropy=44*32)",
        &recovery::recovery_public_key(&[0x44; 32]),
    );
    put(
        "recovery.login_sig(entropy=44*32,user=01*16,chal=02*16,nonce=03*32,exp=1900000000)",
        &recovery::sign_recovery_login(&[0x44; 32], &[1; 16], &[2; 16], &[3; 32], 1_900_000_000),
    );

    // Padding.
    let pads: Vec<u8> = [0u64, 1, 9, 100, 1000, 65_537, 10_000_000]
        .iter()
        .flat_map(|&l| padme(l).to_be_bytes())
        .collect();
    put("padme(0,1,9,100,1000,65537,10000000).u64be", &pads);
    v
}

#[test]
fn vectors_match_committed_file() {
    let got = compute();
    if std::env::var("CIRCLO_WRITE_VECTORS").as_deref() == Ok("1") {
        let json = serde_json::to_string_pretty(&got).unwrap() + "\n";
        std::fs::create_dir_all(std::path::Path::new(PATH).parent().unwrap()).unwrap();
        std::fs::write(PATH, json).unwrap();
        return;
    }
    let committed: BTreeMap<String, String> =
        serde_json::from_str(&std::fs::read_to_string(PATH).expect("committed vectors file")).unwrap();
    assert_eq!(
        got, committed,
        "a byte format changed: update CRYPTO.md first, then regenerate"
    );
}

/// draft-irtf-cfrg-xchacha-03 section A.3.1: confirms the AEAD crate matches the standard.
#[test]
fn xchacha20poly1305_draft_vector() {
    use chacha20poly1305::aead::{Aead, KeyInit, Payload};
    use chacha20poly1305::{XChaCha20Poly1305, XNonce};
    let key: Vec<u8> = (0x80u8..=0x9f).collect();
    let nonce: Vec<u8> = (0x40u8..=0x57).collect();
    let aad = hex::decode("50515253c0c1c2c3c4c5c6c7").unwrap();
    let pt = b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
    let ct = XChaCha20Poly1305::new(key.as_slice().into())
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: pt, aad: &aad })
        .unwrap();
    assert_eq!(
        hex::encode(ct),
        "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c2\
         16cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b\
         13b52ec0875924c1c7987947deafd8780acf49"
    );
}
