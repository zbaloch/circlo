# Halqo threat model

> **Status: DRAFT v0.1 — awaiting owner review.** Derived from PLAN.md sections 1–2 and docs/CRYPTO.md.

## Assets

1. Post content and media, replies, DMs.
2. Profile data (display name, avatar, bio).
3. Circle membership: who is in which circle, and circle labels.
4. Private keys: identity, device, chain roots (`C1` per epoch), `profile_key`, `data_key`.
5. Passwords and recovery phrases.

## Adversaries

| Adversary | Capabilities |
|---|---|
| **Honest-but-curious server operator** | Reads every DB row, S3 object and request; keeps logs. |
| **Malicious server** | Additionally modifies, drops, replays or injects data; serves fake keys. |
| **Database / bucket thief** | Gets a full dump of MySQL and S3 at one point in time. |
| **Network attacker** | Observes and tampers with traffic (TLS in production; certificate pinning in Phase 12). |
| **Curious friend** | Holds legitimate keys for their circle; inspects app internals. |
| **Stranger** | Can register, search handles, use invite links. |
| **Device thief** | Holds an unlocked or locked phone. |

## What the server never learns

Plaintext content, media, replies, DMs, profile fields, names, emails, private keys, passwords, recovery phrases,
circle numbers, circle labels, group names.

## Guarantees

| Property | Mechanism |
|---|---|
| Confidentiality of posts/media | Per-post `postKey`, wrapped by a circle sub-key; XChaCha20-Poly1305 / STREAM |
| Audience secrecy from server | Every friend gets one identical-size HPKE payload; `key_ref` doesn't reveal *n* |
| Audience secrecy from friends | Friends are never told their circle; UI never shows labels to readers |
| Narrower circles stay closed | HKDF chain is one-way: `Ck` gives `C(k+1..100)`, never `C(k-1)` |
| Integrity / tamper detection | AEAD with AAD bound to type, ids and version; STREAM detects truncation/reordering |
| Authenticity (if A1/A2 approved) | Ed25519 author signatures on posts/replies; HPKE Auth for friend payloads |
| Login without revealing the password | Argon2id → Ed25519 auth key; signed challenge |
| Messaging FS / PCS | MLS (RFC 9420) |
| Key-substitution detection | Safety numbers; pinned identity keys with change warnings |

## Known and accepted leaks

1. **Social graph:** the server sees friendships (`friendships`, `friend_payloads`), who messages whom (MLS groups,
   delivery), and who likes which post.
2. **Metadata:** timestamps, padded sizes (Padmé), number of posts, number of media items per post.
3. **Unreadable posts exist:** a reader fetches every header from an author and can tell that posts exist which they
   cannot read (not their content or audience). Optional later fix: decoy headers.
4. **Same-circle comparison:** two friends comparing app internals can tell whether they hold the same `Ck`.
5. **Relative offset:** a reader learns at which derivation step a post matched. Combined with guesses about which
   circle the author uses for "everyone", this can hint at their own circle.
6. **Audience grouping (unless P1 is adopted):** posts to the same circle in the same epoch share a `key_ref`, so the
   server can group posts by audience and, with like data, infer nesting between audiences.
7. **Likes:** a like reveals to the server that the liker could read the post.
8. **No revocation of the past:** anyone who already decrypted something keeps it. Epoch rotation only protects new posts.
9. **Offline password guessing after a DB leak:** `auth_pk` + `auth_salt` let an attacker test password guesses
   (each guess costs one Argon2id at 64 MiB / t=3). Strong passwords and the OPAQUE upgrade mitigate this.
10. **Handle hashes are guessable** (if handles are searchable).
11. **Push tokens:** the server must hold device push tokens to deliver pushes; pushes carry no content.

## Out of scope (for now)

- A compromised, unlocked device (malware with app access sees what the user sees).
- Traffic analysis by a global network observer; IP addresses at the network layer (we don't log them, but the
  hosting provider can see them).
- Code-delivery attacks on a future web client (PLAN.md open decision 2).
- Coercion of the user.

## Operational rules that support the model

- No logging of request bodies, IPs or decrypted data; no access log.
- Buckets are private; presigned URLs only (PUT 15 min, GET 5 min). Object keys are random.
- Leaked-DB drill in Phase 12: dump MySQL and S3, confirm nothing readable.
- External cryptography audit before any public launch.
