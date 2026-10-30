# Circlo cryptography specification

> **Status: v1.4 — owner request 2026-10-29** (v1.4: reports to the operator reinstated, section 13c; v1.3: independent circles and audiences, sections 8.3, 8.5, 8.6, 9.1; v1.2: exclusive circles; no new primitives. v1.1, approved 2026-10-25: where epoch secrets are stored, section 6.1) (owner delegated all design choices to "the most secure
> option"). Section 14 lists every point where this spec deliberately goes beyond PLAN.md and why.
> `core/` implements this document byte-for-byte. Any change requires editing this file first.
> **An external cryptography audit is required before public launch.**

## 1. Goals

1. The server stores and relays **ciphertext only**. It never sees plaintext content, media, names, emails,
   profile fields, passwords, private keys, circle numbers or circle labels.
2. **A stolen database (and S3 bucket) reveals nothing readable.** No key that decrypts user data is stored on the
   server. A database dump alone does not even allow offline password guessing (section 5).
3. Server-side secrets that exist (OPAQUE server setup, handle key, push-token key) live in the deployment secret
   store / environment, **never in the database or the repo**.
4. All primitives live in `core/` (Rust) using audited crates. The app and the server call the core; neither implements
   primitives itself.
5. Every symmetric ciphertext is AEAD with AAD binding **object type, object id(s) and format version**.
6. Every key has exactly one purpose; sub-keys are derived with HKDF and a unique `circlo/v1/...` label.
7. All secrets are zeroized on drop.

## 2. Primitives

| Purpose | Algorithm | Crate |
|---|---|---|
| Symmetric AEAD | XChaCha20-Poly1305 (32-byte key, 24-byte random nonce, 16-byte tag) | `chacha20poly1305` 0.10 |
| Streaming file AEAD | STREAM (`StreamBE32`) over XChaCha20-Poly1305 | `chacha20poly1305` 0.10 (`stream`) |
| KDF | HKDF-SHA256 (RFC 5869) | `hkdf` 0.12, `sha2` 0.10 |
| MAC | HMAC-SHA256 | `hmac` 0.12 |
| Hash | SHA-256 | `sha2` 0.10 |
| Public-key encryption | HPKE (RFC 9180) **mode Auth**, DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305 | `hpke` 0.13 |
| Signatures | Ed25519 (RFC 8032), strict verification | `ed25519-dalek` 2 |
| Password authentication | **OPAQUE (RFC 9807)**: OPRF ristretto255, 3DH ristretto255 + SHA-512, KSF Argon2id | `opaque-ke` 4 |
| Password stretching | Argon2id v1.3, m = 64 MiB, t = 3, p = 1 (inside OPAQUE) | `argon2` 0.5 |
| Recovery phrase | BIP39, English, 24 words (256-bit entropy) | `bip39` 2 |
| Messaging (Phase 9) | MLS (RFC 9420), ciphersuite 0x0003 `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519` | `openmls` |
| Randomness | OS CSPRNG | `rand_core` `OsRng` / `getrandom` |

## 3. Encodings and conventions

- `||` is concatenation. Integers are big-endian unsigned (`u8`, `u32`, `u64`).
- IDs (`user_id`, `post_id`, `epoch_id`, `device_id`, `reply_id`, `object_id`) are 16 raw bytes (UUIDv7 or random).
- `HKDF(ikm, info)` = HKDF-SHA256 Extract with empty salt, then Expand with `info` to 32 bytes unless stated.
- Labels are ASCII and start with `circlo/v1/`.
- **AAD:** `AAD(label, f1, ..., fn) = label || 0x00 || f1 || ... || fn`. Every field is fixed-length (IDs 16 bytes,
  `u8` kinds/versions, 32-byte keys/hashes). Variable-length fields are never put in AAD.
- **Sealed envelope** (every single-shot XChaCha20-Poly1305 ciphertext):
  ```
  envelope = version:u8 (=0x01) || nonce:24 || ciphertext || tag:16
  ```
  The envelope `version` byte is always the **last AAD field**, so it cannot be swapped.
  `Seal(key, plaintext, label, fields...)` means: random nonce; AAD = `AAD(label, fields..., version)`.
- Structured plaintexts are CBOR (RFC 8949) maps with small integer keys, then padded (section 4).

## 4. Padding (Padmé)

```
padme(L): if L < 2: return L
          E = floor(log2 L); S = floor(log2 E) + 1; z = E - S; mask = (1 << z) - 1
          return (L + mask) & ~mask
```
- **Structured plaintexts:** `padded = u32(len) || plain || zeros`, total length `max(256, padme(4 + len))`.
  Unpadding rejects a length prefix larger than the buffer and non-zero padding bytes.
- **Media streams:** `content || zeros` to `padme(content_len)` (minimum 1 chunk); the real `content_len` is stored only
  inside the encrypted post header.
- Server column `size_bucket = ceil(log2(ciphertext_size))`.

## 5. Accounts and authentication (OPAQUE)

### 5.1 Handle and lookup key
- Every account has a **handle** (the login name, chosen by the user, a pseudonym; no email or phone number exists).
  `normalize(handle) = NFKC(lowercase(trim(handle)))`, 3–30 chars of `[a-z0-9_]` after normalization.
- The server never stores the handle. It stores
  `handle_lookup = HMAC-SHA256(HANDLE_KEY, "circlo/v1/handle" || 0x00 || normalize(handle))`, where `HANDLE_KEY` (32 bytes)
  is a server secret (`CIRCLO_HANDLE_KEY`) kept outside the database. A DB thief cannot reverse or test handles.
- **No search.** Handles are never searchable; `handle_lookup` is used only to log in. The only way to connect is an
  invite link or QR code (section 12), and a friend request is accepted only from someone who redeemed the target's
  invite. (Owner decision 2026-10-28; opt-in exact-match search was removed together with `users.discoverable`.)

### 5.2 OPAQUE configuration
```
CipherSuite: OprfCs = Ristretto255, KeGroup = Ristretto255, KeyExchange = TripleDh<Ristretto255, Sha512>,
             Ksf = Argon2id(m = 65536 KiB, t = 3, p = 1, output 64)
credential_identifier = handle_lookup                       (computed by the server)
client identity       = normalize(handle) (UTF-8)
server identity       = "circlo-server"
context               = "circlo/v1/opaque"
```
- `ServerSetup` (OPRF seed + server AKE keypair) is generated once, serialized and stored as `CIRCLO_OPAQUE_SERVER_SETUP`
  in the secret store, **never in the database**. Losing it forces every user through recovery (section 6.3), so it is
  backed up in the secret store.
- The DB stores only the OPAQUE `registration_record` (`users.opaque_record`). Without `ServerSetup` this record does not
  allow offline password guessing; even with both, every guess costs one Argon2id at 64 MiB.
- Unknown handles get a fake login response generated by `opaque-ke` from `ServerSetup` and the identifier, so the
  server never reveals whether an account exists.

### 5.3 Flows
- **Registration:** client `ClientRegistration::start(password)` → server `ServerRegistration::start` → client
  `finish` (with the identities and KSF above) → upload `registration_record` + the backups (section 6) + public keys.
- **Login:** client `ClientLogin::start` → server `ServerLogin::start(record or None)` → client `finish` →
  server `finish`. On success the server issues a short-lived JWT (iss `circlo-server`, aud `circlo-app`) and a refresh token.
- The server's login state between `start` and `finish` is **secret and stays server-side** (short-lived DB row or
  cache entry, deleted on use or expiry). It contains the expected client MAC, so it must never be sent to the client.
- The client's OPAQUE **`export_key`** (64 bytes) never leaves the device. It derives
  `backup_pw_key = HKDF(export_key, "circlo/v1/backup-password")`.
- **Password change:** prove the current password with an OPAQUE login bound to the session
  (`/v1/auth/password/verify/*`; it opens the password backup on the phone), re-register with the new password, and
  re-encrypt the backup. All other sessions are revoked.
- **Lockout:** a wrong password fails in the client's `finish`, so the server can't see failures; it counts every login
  start for a `handle_lookup` until one finishes. After 3, password login locks for 15 min, then 1 h, then 24 h (a day
  without attempts resets). Unknown handles are throttled identically. Recovery (section 6.3) is never locked, and a
  new password clears the lock.
- **New sign-in alerts:** each successful password login records a `security_events` row (kind and time only) and
  sends a content-free push; other devices show the ones after their own sign-in.
- **Password strength** can only be checked on the phone (the server never sees the password): at least 12
  characters, zxcvbn score >= 3, and not in a leaked-password blocklist (no composition rules, NIST SP 800-63B).

## 6. Key backup and recovery

### 6.1 Backup plaintext (fixed binary layout, padded)
Not CBOR: the backup is all secret material, so a fixed layout keeps every byte zeroizable and keeps parsers away from it.
```
version:u8 (=0x01) || id_x25519_sk:32 || id_ed25519_sk:32 || data_key:32 || local_root:32
|| u16(count) || count × ( epoch_id:16 || C1:32 || profile_key:32 )          // every epoch the user has created
```
Decoding rejects any length other than `131 + 80 × count`, and `count > 10 000`.
`data_key` encrypts the address book and settings blobs (section 10).

**Where epoch secrets live (v1.1 note, no primitive change):** the epoch list in this layout stays empty in practice.
Epoch roots `C1`, per-epoch `profile_key`s, friends' received `Ck`/`profile_key`s and pinned identity keys are kept in
the **address book** blob, sealed with `data_key` (section 10). `data_key` is in both backup copies and never changes,
so this state syncs across devices and survives recovery without re-sealing the recovery copy, which would need the
24-word phrase the device does not keep.

### 6.2 Password copy (`key_backups.kind = 'password'`, kind byte 0x01)
`Seal(backup_pw_key, padded_backup, "circlo/v1/backup", user_id, 0x01)`

### 6.3 Recovery copy (`key_backups.kind = 'recovery'`, kind byte 0x02)
```
entropy       = 32 random bytes  →  BIP39 24-word phrase, shown once at signup (user confirms 3 words)
recovery_key  = HKDF(entropy, "circlo/v1/backup-recovery")
recovery_auth = Ed25519 key from seed HKDF(entropy, "circlo/v1/recovery-auth")      → users.recovery_pubkey
envelope      = Seal(recovery_key, padded_backup, "circlo/v1/backup", user_id, 0x02)
```
**Recovery login:** server sends `challenge_id:16 || nonce:32 || expires_at:u64`; client signs
`"circlo/v1/recovery-login" || 0x00 || user_id || challenge_id || nonce || u64(expires_at)` with `recovery_auth`;
the server verifies (strict) and releases the recovery copy; the client then re-registers OPAQUE with a new password.
Recovery requires the handle (to find `user_id`) and the phrase (256 bits: not guessable).

## 7. Identity and device keys

- `id_x25519` and `id_ed25519`: random keypairs per user, shared by the user's devices via the backup.
  Published with `identity_sig = Ed25519_sign(id_ed25519_sk, "circlo/v1/identity" || 0x00 || user_id || u8(version) || id_x25519_pk)`.
- `dev_ed25519`: random per device, never leaves it. Device certificate:
  `Ed25519_sign(id_ed25519_sk, "circlo/v1/device" || 0x00 || user_id || device_id || dev_ed25519_pk)`.
- Keys are stored in iOS Keychain / Android Keystore under service `com.circlo.app.keys`.

## 8. Circle key chain

### 8.1 Chain (per epoch)
```
C1     = 32 random bytes                         (never leaves the owner's devices except inside backups)
C(n+1) = HKDF(Cn, "circlo/v1/circle-step")        n = 1..99
```
HKDF is one-way: `Ck` yields `C(k+1)..C100`, never `C(k-1)`.

### 8.2 Per-circle sub-keys (`Cn` is never used directly)
```
wrap_key_n = HKDF(Cn, "circlo/v1/post-wrap")
ref_key_n  = HKDF(Cn, "circlo/v1/post-ref")
key_ref    = HMAC-SHA256(ref_key_n, "circlo/v1/post-ref" || 0x00 || author_id || post_id)     (per post, 32 bytes)
```
Because `key_ref` depends on `post_id`, two posts to the same circle have unrelated tags: the server cannot group posts
by audience.

### 8.3 Friend payload (`friend_payloads.hpke_ciphertext`)
Plaintext, **fixed 368 bytes for every friend** (version 3, v1.3 of this spec):
```
version:u8 (=0x03) || reserved:15 zero bytes || epoch_id:16 || E:32 || profile_key:32 || X_1..X_8: 8 × 32 || reserved:16 zero bytes
```
`E = C2` is the epoch's **Everyone** key (section 8.6), given to every friend. Slot `i` holds circle `i`'s key `X_i`
(section 8.5) if the friend is a member of circle `i`, and **32 random bytes** otherwise. Real keys and filler look
the same, so neither the server nor the friend can tell which circles a friend is in (a member only finds out when
such a post opens).
HPKE mode **Auth** (sender authenticates with `id_x25519_sk`), recipient = friend's `id_x25519_pk`:
```
info   = "circlo/v1/friend-payload"
aad    = AAD("circlo/v1/friend-payload", from_user_id, to_user_id, epoch_id, 0x03)
stored = enc:32 || ciphertext:368 || tag:16          (416 bytes for every friend)
```
Older payloads still open for older epochs: version 1 (112-byte plaintext `version || reserved:15 || epoch_id || Ck ||
profile_key || reserved:16`, AAD version 0x01, 160 bytes stored) and version 2 (144 bytes, one `X` slot after
`profile_key`, AAD version 0x02, 192 bytes stored). Every new payload is version 3.

### 8.4 Epochs: **every** circle change rotates
Any change of any friend's circle (inward, outward, removal, unfriend) creates a new epoch: fresh `C1`, fresh
`profile_key`, a new payload for **every** remaining friend, profile re-encrypted. Adding a brand-new friend gives
them a payload for the current epoch. Rationale: if inward moves sent a single extra payload, the server would learn
who was moved. Old posts keep their old epoch and stay readable to whoever could read them (nothing seen can be revoked).
The reverse holds too: moving someone closer opens only what is posted from then on, never earlier posts (owner
decision 2026-10-29: past posts keep the audience they were shared with).
Joining or leaving an exclusive circle (section 8.5) is a circle change too, so it also rotates.

### 8.5 Circles (exclusive)
A circle is an audience off the chain: a post to it is readable by its members only, never by anyone else (whatever
other circles they're in).
```
X_i = HKDF(C1, "circlo/v1/exclusive-circle/<i>")      i = 1..8; owner-side only, like every Cn
```
`C1` never leaves the owner's devices, and the label differs from the chain step, so no friend's key yields any
`X_i`. A fresh `C1` per epoch gives fresh `X_i`. `X_i` is used exactly like a chain key:
`wrap_key = HKDF(X_i, "circlo/v1/post-wrap")`, `ref_key = HKDF(X_i, "circlo/v1/post-ref")`. Circle names, ids and
memberships are author-only (address book, section 10). A friend can be in any number of the 8 circles.

### 8.6 Audiences (v1.3)
A post goes to **Only me**, **Everyone** (all friends), or **one or more circles**.
```
Only me   : C1        (never given to anyone)
Everyone  : E = C2    (in every friend's payload)
Circle i  : X_i       (in its members' payloads)
```
The chain beyond `C2` is unused from v1.3 on (it still opens posts from older epochs, which used nested circles).

## 9. Posts, replies, likes

### 9.1 Post (active epoch)
```
post_id    = client-generated UUIDv7 (server rejects duplicates)
postKey    = 32 random bytes
header_key = HKDF(postKey, "circlo/v1/post-header")
header     = CBOR { 1: text, 2: created_at_ms:u64, 3: [media_descriptor...], 4: author_sig:64 }
media_descriptor = { 1: object_id:16, 2: kind (0 full | 1 thumb | 2 poster), 3: mime, 4: file_key:32,
                     5: content_len:u64, 6: width, 7: height, 8: duration_ms }
author_sig = Ed25519_sign(id_ed25519_sk, "circlo/v1/post-sig" || 0x00 || author_id || post_id || epoch_id ||
                          SHA-256(CBOR(header map without key 4)))
slot(K)    = HMAC-SHA256(ref_key(K), "circlo/v1/post-ref" || 0x00 || author_id || post_id)      key_ref, 32
             || Seal(wrap_key(K), postKey, "circlo/v1/post-key", author_id, post_id, epoch_id)   73 bytes
filler     = 32 random bytes || 0x01 || 72 random bytes           (indistinguishable from a real slot)
body       = Seal(header_key, padded(header), "circlo/v1/post-header", author_id, post_id)
header_ct  = 0x02 || 8 slots (one per audience key K, filler for the rest, in random order) || body
server row : posts(id = post_id, author_id, epoch_id, key_ref, header_ct, created_at, size_bucket)
```
Every post carries 8 slots, whether it goes to Only me, Everyone or several circles, so the server learns nothing
about its audience. The row's `key_ref` is 32 random bytes for these posts. Posts sealed before v1.3 have
`header_ct = u32(len(wrapped)) || wrapped || body` (first byte 0x00) with the real `key_ref` in the row; both
formats still open.

### 9.2 Read
For a post in an epoch where the reader holds `Ck` (from v1.3: `E`): derive `Ck..C100`, add the payload's `X` slots
(filler never matches), compute each candidate's `key_ref` for this `post_id` and compare it with the post's slots
(or, for posts before v1.3, the row's `key_ref`); on a match unwrap `postKey` from that slot, open the header, verify
`author_sig` with the author's pinned identity key.
Any failure → shown as unreadable (never partially rendered).

### 9.3 Replies
```
reply_key = HKDF(postKey, "circlo/v1/reply")
reply     = CBOR { 1: text, 2: created_at_ms, 3: reply_sig:64 }
reply_sig = Ed25519_sign(id_ed25519_sk(replier), "circlo/v1/reply-sig" || 0x00 || post_id || reply_id || replier_id || SHA-256(text))
row       = Seal(reply_key, padded(reply), "circlo/v1/reply", post_id, reply_id, replier_id)
```

### 9.4 Likes
Plain rows (`post_likes`). The server learns who liked which post (documented leak). Counts are shown only by clients
that can decrypt the post.

## 10. Blobs: profile, address book, settings, local cache
```
profile_ct      = Seal(HKDF(profile_key, "circlo/v1/profile"),      padded, "circlo/v1/profile",      user_id, epoch_id)
address_book_ct = Seal(HKDF(data_key,    "circlo/v1/address-book"), padded, "circlo/v1/address-book", user_id)
settings_ct     = Seal(HKDF(data_key,    "circlo/v1/settings"),     padded, "circlo/v1/settings",     user_id)
local cache     = Seal(local_cache_key,  bytes,  "circlo/v1/local-cache", file_id)   (local_cache_key: random, in Keychain/Keystore)
```
Profile: display name, bio, avatar/banner media descriptors. Address book: circle labels 1–100, friend → circle,
per-epoch bookkeeping. Avatars/banners use section 11's media format.

## 11. Media: chunked streaming encryption

- Each media object has a random `file_key` (32 bytes), carried only inside an encrypted header/profile/MLS message.
- S3 object key = hex of 32 random bytes; `object_id` = first 16 of those bytes. Keys encode nothing.
- Plaintext stream = content padded to `padme(content_len)`, split into **65 536-byte chunks**.
- STREAM `StreamBE32<XChaCha20Poly1305>`: 19-byte random nonce prefix, 4-byte chunk counter, 1-byte last flag.
  The final chunk (may be short or empty) has the last flag; a missing final chunk, reordering, truncation, extension
  or any modified byte fails.
- Per-chunk AAD: `AAD("circlo/v1/media-chunk", object_id, 0x01)`.
- Layout: `version:u8 (=0x01) || nonce_prefix:19 || chunk_0 (65 552) || ... || chunk_last (16..65 552)`.
  Chunk `i` starts at byte `20 + i * 65 552` → byte-range fetch + independent decryption (progressive video, seeking).

## 12. Invites, safety numbers, identity changes

- **Invite token:** 32 random bytes. Link `https://circlo.com/i/<base64url(token)>#<base64url(fingerprint)>`.
  The fragment never reaches the server. `fingerprint = SHA-256("circlo/v1/fingerprint" || 0x00 || id_ed25519_pk || id_x25519_pk)[0..16]`.
  Server stores `SHA-256("circlo/v1/invite" || 0x00 || token)` only. Accepting checks the fingerprint against the inviter's keys.
- **Safety number** for users A, B:
  ```
  h = "circlo/v1/safety-number" || 0x00 || user_id(U); repeat 5200 times: h = SHA-256(h || id_ed25519_pk(U) || id_x25519_pk(U))
  digits(U) = 6 groups: for i in 0..6: u40(h[5i..5i+5]) mod 100000, zero-padded to 5 digits
  safety_number = concat(sort([digits(A), digits(B)]))       (60 digits, shown as 12 groups of 5)
  QR = 0x01 || first 30 bytes of h(first) || first 30 bytes of h(second)   (same order as the digits)
  ```
- **Pinning:** clients pin each friend's identity keys on first contact (trust on first use). A change triggers a
  blocking warning and clears the verified state.

## 13a. Messaging: MLS (Phase 9)

Protocol: MLS 1.0 (RFC 9420), ciphersuite `0x0003` (MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519), via
OpenMLS with RustCrypto primitives. Nothing below changes MLS itself; it defines how Circlo identities, devices and
storage plug into it.

- **One MLS client per device.** Every device of every member is its own leaf, so messages reach all of a user's
  devices and a lost device is removed like any member.
- **MLS signature key:** a fresh Ed25519 key per device (`mls_sig`), never reused for anything else; secret kept in
  the device keystore.
- **Credential (Basic):** `identity = user_id:16 || device_id:16 || binding:64` where
  `binding = Sign(id_ed25519_sk, "circlo/v1/mls-credential" || 0x00 || user_id || device_id || mls_sig_pk)`.
  Before accepting a Welcome, and after every commit, the app checks every leaf: the binding must verify under the
  identity key it has pinned for that `user_id` (friends) or, for people it doesn't know, the server-provided
  identity key (shown as "not verified"). A leaf whose binding fails makes the app refuse to send to the group.
- **Key packages:** each device uploads up to 20 one-time KeyPackages plus one last-resort package. The server hands
  out one per device on claim and deletes it (the last-resort one is reused). KeyPackages carry only the credential
  above (ids and public keys).
- **Groups:** random 16-byte group ids. A 1:1 chat is a 2-user group. `use_ratchet_tree_extension = true`;
  handshake messages are encrypted (PrivateMessage) except what MLS requires in the clear (group id, epoch,
  content type).
- **Ordering:** the server keeps one ordered log per group and accepts a commit only if it targets the group's current
  epoch (read from the MLS framing by the core); the loser of a race refetches, processes, and retries. Clients
  merge their own commit only after the server accepts it.
- **Application payload:** CBOR `{1: kind (0 text, 1 media), 2: text, 3: [MediaItem], 4: created_at_ms}`, Padmé-padded
  before MLS encryption. Media reuse section 11: each object has its own random `file_key`, carried only inside the
  MLS message.
- **Local state:** the device's OpenMLS storage (group secrets, trees, key package private keys) is serialized and
  sealed with `local_cache_key` (section 10) after every operation. It never leaves the device; a reinstalled device
  joins as a new device.
- **Removal:** removing a member commits Remove proposals for all of their devices; MLS guarantees they can't derive
  the new epoch's keys, so they can't read anything sent afterwards (tested).

## 13b. Linking a new device (Phase 10)

- The new device generates a one-time X25519 key pair and a random 32-byte `link_id`, and shows a QR code
  `circlo://link/<link_id>#<link_pk>` (base64url).
- Both devices show a 6-digit confirmation code `SHA-256("circlo/v1/device-link-code" || 0x00 || link_pk)` (first 4
  bytes, mod 10^6). The signed-in device sends nothing until the user confirms the codes match, so tricking someone
  into scanning an attacker's code doesn't hand over their keys.
- The signed-in device seals `CBOR {1: backup payload (section 6), 2: handle}` with HPKE base mode
  (X25519-HKDF-SHA256, HKDF-SHA256, ChaCha20-Poly1305), `info = "circlo/v1/device-link"`,
  `aad = "circlo/v1/device-link" || 0x00 || link_id || user_id`, and posts it to the server.
- The server keeps the ciphertext at most 10 minutes and hands it out once (unauthenticated, rate-limited pickup by
  `link_id`) together with a session for the account. The new device opens it, checks the published identity keys
  match (as at login), registers itself as a new device and joins chats as its members add it.
- Revoking a device removes it from every chat's server-side ACL, deletes its key packages, welcomes and push token;
  members' apps remove its MLS leaves.

## 13c. Read tokens (Phase 11)

- **Read token:** `read_token = HKDF(post_key, "circlo/v1/read-token")`. At creation the author sends only
  `H = SHA-256("circlo/v1/read-token-hash" || 0x00 || read_token)`. Listing or adding replies and likes, and fetching
  their counts, requires presenting `read_token` (header `X-Circlo-Read-Token`, or per item in `/v1/posts/stats`);
  the server hashes and compares in constant time. Only people who can open the post can derive the token, so
  friends outside the audience learn nothing about who interacted. A database copy holds only hashes. (Owner
  approved, 2026-10-27; closes THREAT_MODEL leak 14.)
- **Reports to the operator (v1.4, owner decision 2026-10-29; reinstated after the 2026-10-27 removal):** a user who
  reports a post, a person or a chat message chooses to share what they can see. Their device builds the report
  (reason, optional note, and either the post's text and photos, the person's name, handle and bio, or the one
  message's text and photos with its sender, all as decrypted on that device), signs
  `"circlo/v1/report" || 0x00 || report_id || reporter_id || content` with the reporter's Ed25519 identity key, and
  seals CBOR `{1: content, 2: reporter_id, 3: signature}` with HPKE base mode (X25519-HKDF-SHA256,
  ChaCha20-Poly1305) to the operator's moderation public key, info `"circlo/v1/report"`, AAD
  `AAD("circlo/v1/report", report_id)` (section 3: label, id, version). `report_id` is a fresh random id the server
  stores the row under, so a sealed report can't be replayed under another id. Reports are at most 4 MiB. The server
  stores ciphertext only (`POST /v1/reports`, 20 per hour per user); the operator opens reports offline with the
  moderation secret key (`circlo-moderation open`), which never touches the server. The person reported is not told. Only
  what a reporter explicitly reports becomes readable to the operator; nothing else does.

## 13. Server-side secrets (outside the DB, via the core)

| Secret | Env var | Used for | If lost |
|---|---|---|---|
| OPAQUE `ServerSetup` | `CIRCLO_OPAQUE_SERVER_SETUP` | Password login | Users log in via recovery phrase and re-register |
| Handle key | `CIRCLO_HANDLE_KEY` | `handle_lookup` | Handles must be re-entered by users at next login |
| Push-token key | `CIRCLO_PUSH_TOKEN_KEY` | `devices.push_token_enc = Seal(key, token, "circlo/v1/push-token", device_id)` | Devices re-register push tokens |
| JWT signing key | `CIRCLO_JWT_KEY` | Sessions | Everyone logs in again |

None of these can decrypt user content. They only protect metadata and stop offline guessing from a DB-only leak.
The server calls the core (JNI) for OPAQUE, HMAC and the push-token seal; it implements no primitives.

## 14. Where this goes beyond PLAN.md (approved)

| # | Change | Why |
|---|---|---|
| A1 | Ed25519 author signatures on posts and replies | Anyone holding `Cn` (a friend) could otherwise forge posts "from" the author with server help |
| A2 | HPKE **Auth** mode for friend payloads | Base mode would let the server inject fake circle keys |
| A3 | Recovery auth key, `users.recovery_pubkey` | A user who forgot their password must still authenticate to fetch the recovery copy |
| A4 | `user_blobs.kind` gains `'profile'`; profile keyed per epoch | The encrypted profile needs a home; ex-friends must lose access to future profile changes |
| A6 | Padmé padding | Published, analysed bucket scheme |
| A7 | **OPAQUE replaces Argon2id + Ed25519 challenge** (PLAN.md's own "upgrade path", done now). `users.auth_pubkey`/`auth_salt` become `users.opaque_record` | With the original design a DB dump allowed offline guessing of every password, then decryption of the password backups |
| A8 | Handle required (login name); stored only as a keyed HMAC; never searchable (invite link or QR only) | No plaintext handle in the DB; resolves open decision 1 privately |
| A9 | Per-post `key_ref` (HMAC over `post_id`) | Fixed tags let the server group posts by audience |
| A10 | Every circle change rotates the epoch | Single inward-move payloads would reveal who was moved |
| A11 | Push tokens sealed with a server key outside the DB | A DB thief gets no device push tokens |
| A12 | Exclusive circles (8.5) carried in a v2 friend payload with a random filler for non-members | "Close Friends": posts only its members can read, without revealing membership to the server or to other friends |
| A13 | Audiences (8.6): Only me, Everyone, or several independent circles; v3 payload (8 circle slots) and 8-slot posts (9.1) | Real relationships aren't a single ranking; fixed slots keep membership and audience invisible to the server |

## 15. Known limitations

See `docs/THREAT_MODEL.md`. In short: the server sees the (pseudonymous) social graph, timestamps, padded sizes and
likes; friends can see that unreadable posts exist; nothing already decrypted can be revoked; if the database **and**
the server secrets are both stolen, weak passwords can be guessed offline (each guess costs Argon2id 64 MiB); a
compromised unlocked device sees what its user sees.
