# Halqo threat model

> **Status: v1.0 — approved 2026-10-25.** Derived from PLAN.md sections 1–2 and docs/CRYPTO.md v1.0.

## Headline guarantee

**A full copy of the database and the S3 bucket reveals no content, no names, no emails, no handles, no profile data,
no circle membership, no private keys and no push tokens, and does not allow offline password guessing.** The few
server secrets (CRYPTO.md section 13) live outside the database and still cannot decrypt user content.

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
| Authenticity | Ed25519 author signatures on posts/replies; HPKE Auth for friend payloads |
| Login without revealing the password | OPAQUE (RFC 9807); the server never sees the password or anything guessable from a DB dump |
| No PII at rest | No email/phone exists; handles stored only as keyed HMAC; profiles encrypted; push tokens sealed |
| Audience hiding over time | Per-post `key_ref`; every circle change rotates the epoch for all friends |
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
6. **Likes:** a like reveals to the server that the liker could read the post, so like patterns can hint at audiences.
7. **No revocation of the past:** anyone who already decrypted something keeps it. Epoch rotation only protects new posts.
8. **Epoch rotations are visible:** the server sees *that* the author changed some circle assignment (all friends get
   new payloads), not who or how.
9. **DB + server secrets stolen together:** weak passwords become guessable offline (each guess costs Argon2id 64 MiB);
   handles become testable. Content stays encrypted.
10. **Live server compromise:** an attacker running the server sees plaintext handles at login/lookup time and the
    request metadata above; still no content or keys.
11. **Push delivery:** APNs/FCM see that a device got "new activity" pings; pushes carry no content.

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

## Comparison with Threema (owner's benchmark)

Threema is a widely respected privacy messenger: anonymous random IDs (no phone number or email required), NaCl
end-to-end encryption, the Ibex protocol for forward secrecy in one-to-one chats, QR-code contact verification,
password-encrypted "Threema Safe" backups, open-source apps, and independent audits plus academic analysis.
Halqo's design aims at the same bar. Where it stands today (design level; Halqo is unaudited):

| Property | Threema | Halqo |
|---|---|---|
| Account without phone/email | Yes (random ID) | Yes (pseudonymous handle; the server stores only a keyed hash of it) |
| Content end-to-end encrypted | Yes | Yes (posts, media, replies, profiles, address book, backups; messages via MLS in Phase 9) |
| Profile name/photo hidden from the server | Profile pictures are shared end-to-end; the optional public nickname travels with messages | Yes: profiles are encrypted with a per-epoch key only friends receive |
| Forward secrecy in chats | Ibex (one-to-one chats) | MLS (RFC 9420): forward secrecy **and** post-compromise security, one-to-one and groups (Phase 9) |
| Contact verification | QR scan, three verification levels | Safety numbers + QR, pinned identity keys, blocking warning on any key change |
| Backup protection | Key derived from the backup password | OPAQUE: a stolen database alone doesn't allow password guessing; the OPAQUE server secret is kept outside the DB |
| Who-talks-to-whom metadata | The server relays messages and sees sender/recipient IDs; contact lists aren't stored on the server | **Weaker today**: the server stores the friendship graph (needed to deliver key payloads). Documented leak; candidate mitigations: no `friendships` table, sealed-sender-style delivery |
| Audience secrecy (who can see a post) | Not applicable | Server can't tell which circle anyone is in or which posts share an audience |
| Independent security audit | Yes | **Not yet: required before any public launch** |
| Maturity | Years in production | Early development |

**Bottom line:** at design level Halqo matches or exceeds Threema on content secrecy, backup protection and chat
security, and adds audience secrecy that Threema doesn't need. It is weaker on social-graph metadata (the server
knows friendships), and it has none of Threema's track record or audits yet. "As secure as Threema" can only be
claimed after an external audit.
