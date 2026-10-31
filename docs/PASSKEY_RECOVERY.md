# Passkey recovery (design, for owner approval)

Status: **proposed** (2026-10-31). Nothing here is built yet.

## 1. Goal

Make account recovery easy without weakening end-to-end encryption:

- **Default:** "Protect your account with Face ID" (a passkey) at sign-up. Forgot your password? Face ID gets you back in.
- **Optional:** a **12-word** recovery phrase, for people who want an offline backup, switch between iPhone and Android,
  or whose phone can't do passkey recovery. The 3-word quiz goes.
- **Unchanged:** password login on a new phone, OPAQUE, the password backup, device linking. The server still never sees
  anything that can decrypt user data, and still can't tell what a user posts or to whom.

## 2. What the research found (2026-10-31)

- **Passkeys can derive an encryption key** through the WebAuthn **PRF** extension: the same passkey and salt give the
  same 32 bytes. Supported by Apple Passwords / iCloud Keychain (iOS 18+), Google Password Manager (every GPM passkey,
  per Corbado) and 1Password; **not reliably** by Bitwarden, Dashlane, NordPass or Samsung Pass (Samsung returns
  nothing at creation). Sources: Corbado "Passkeys & WebAuthn PRF for E2E encryption (2026)", Apple
  `ASAuthorizationPublicKeyCredentialPRFAssertionInput` docs.
- **React Native:** `react-native-passkey` (≥ 3.3) supports PRF on iOS 18+ and Android, on AndroidX Credential
  Manager 1.6 (an Expo docs PR recommends it over the older `react-native-passkeys`). Needs a dev build (we have one).
  **Verify on real devices before relying on it.**
- **Known risk:** Apple developer forum thread 822523 (Apr–Jul 2026) reports a synced iCloud passkey giving **different
  PRF output on another device** in some combinations: iPhone → Mac, and passkeys created on iOS 26 used on iOS 18.
  iPhone → iPhone on matching recent iOS works. Apple says it should be identical and asked for bug reports; no fix is
  confirmed. Corbado's advice: "treat PRF as an enhancement, not a dependency" and build the fallback first.
- **Moving passkeys between Apple and Google** (Credential Exchange) exists on iOS 26 for password-manager apps. Google's
  support is unclear, and whether PRF survives export is unknown. So a passkey must be assumed to stay in one
  ecosystem.

Design consequences: the passkey is the easy default, never the only way back in (password and optional phrase stay),
PRF is checked when the passkey is created, and every device where it works can add its own copy (section 4.3).

## 3. User flows

**Sign-up:** handle → password → **"Protect your account with Face ID"** (one tap; the system saves a passkey for
`hellocirclo.com` in iCloud Keychain or Google Password Manager) → in.
- If the device can't create a PRF passkey (older iOS, provider without PRF), the app says so and offers the
  **12-word phrase** instead, with "Save to password manager" (share sheet) / "Save as file" / "I've written it down".
  No quiz.
- *Owner decision A:* require one recovery method to finish sign-up (recommended), or allow "Later" with reminders.

**Settings → Recovery:** "Face ID recovery: on (iCloud Keychain)" · "Recovery phrase: not set → Create one" ·
remove either (at least one stays while there is no other, unless decision A allows none).

**Forgot password (new phone):** handle → **"Use Face ID"** → the system shows the passkey → new password → in.
"Use recovery phrase" stays as the other option. Other devices are signed out, as today.

**Every password login on a phone that has the passkey** quietly refreshes passkey recovery for that phone
(section 4.3), so the cross-device PRF bug can't strand users who still sign in normally.

**Existing users (2–3 people):** their 24-word phrases keep working. After the update, Home suggests "Turn on Face ID
recovery".

## 4. Cryptography (all in `core/`, CRYPTO.md section 6 to be updated)

### 4.1 Recovery methods
Today recovery has one 32-byte secret (the phrase entropy) feeding two derivations: `recovery_key` (seals the recovery
copy of the key backup) and `recovery_auth` (an Ed25519 key whose public half the server checks at recovery login).
This becomes **one or more recovery methods**, each with its own 32-byte root secret and the same two derivations,
domain-separated by kind:

| Method | Root secret (32 bytes) | Labels |
|---|---|---|
| Phrase, 24 words (existing) | BIP39 entropy | `circlo/v1/backup-recovery`, `circlo/v1/recovery-auth` (unchanged) |
| Phrase, 12 words (new) | `HKDF(entropy16, "circlo/v1/recovery-root-128")` | as above |
| Passkey (new) | PRF output, salt `SHA-256("circlo/v1/passkey-prf")` | `circlo/v1/backup-passkey`, `circlo/v1/passkey-auth` |

Each method stores `Seal(method_key, padded_backup, "circlo/v1/backup", user_id, kind_byte)` with a new kind byte for
passkeys (0x03), and its `auth` public key. The PRF output never leaves the phone, and nothing new is sent to the
server except ciphertext and a public key.

### 4.2 The passkey itself
- RP ID `hellocirclo.com`. `user.name` = the handle, `user.id` = 16 random bytes (stored only in the user's keychain).
  Discoverable (resident) credential, user verification required.
- The server **does not** register or verify the passkey (no WebAuthn on the server). The passkey is only where the
  phone keeps a PRF secret. The server checks only the derived Ed25519 `auth` signature, exactly as for phrases today.
- **At creation:** create, then immediately `get` with the PRF salt and require a 32-byte result. No result (provider
  without PRF) → no passkey method; offer the phrase.

### 4.3 Resilience against the PRF cross-device bug
A method row is keyed by `(user, method_id)`. A passkey method can hold **several wraps**: on a password login on a
device that has the passkey, the app gets that device's PRF output. If it opens none of the stored wraps, it adds a
new wrap (new `auth` key + ciphertext) for the same credential. Recovery tries every wrap's `auth` key.

### 4.4 What doesn't change
OPAQUE, the password copy, identity and device keys, epochs, posts and MLS are untouched. Recovery still ends with an
OPAQUE re-registration (new password) and revokes other sessions.

## 5. Server

- Migration: `recovery_methods(id, user_id, kind ENUM('phrase','passkey'), auth_pubkey BINARY(32), ciphertext,
  created_at, last_used_at)`. Existing `users.recovery_pubkey` + `key_backups(kind='recovery')` move into it as
  `phrase` rows.
- Registration takes a list of 0..n methods (minimum per decision A) instead of one phrase.
- Endpoints (full scope): list methods (id, kind, dates only), add a method or wrap, remove a method.
- Recovery: `recovery/start` (handle → challenge, unchanged shape; unknown handles stay indistinguishable),
  `recovery/finish` checks the signature against **any** of the user's method keys and returns a recovery token plus the
  matching method id. `GET` that method's ciphertext. No locking change: recovery is never locked out (it is
  rate-limited per handle).
- No new secrets, no WebAuthn library, no PII.

## 6. App

- `react-native-passkey` (≥ 3.3; pin the exact version after testing). Expo config: `ios.associatedDomains:
  ["webcredentials:hellocirclo.com"]`.
- Screens: the sign-up step, Settings → Recovery, the "Forgot password" chooser, a reminder card.
- Tests: core vectors per method kind, server ITs (multi-method recovery, migration of existing users, any-key match),
  app tests for the flows. Then real-device checks: iPhone → iPhone, iPhone → Mac (Safari), Android → Android.

## 7. Website and Apple / Google setup (one-off, by the owner)

- `https://hellocirclo.com/.well-known/apple-app-site-association`, served at the **apex** without a redirect:
  `{"webcredentials":{"apps":["P9273YDUQ9.com.hellocirclo.app"]}}`.
- `https://hellocirclo.com/.well-known/assetlinks.json` with relation `delegate_permission/common.get_login_creds` for
  `com.circlo.app` and the SHA-256 fingerprints of every key that signs the Android app (Play app signing, upload key,
  GitHub APK key).
- Apple Developer → Identifiers → `com.hellocirclo.app`: enable **Associated Domains**.

## 8. Owner decisions

- **A.** Must sign-up set up a recovery method (recommended: yes; Face ID makes it one tap), or allow "Later"?
- **B.** New phrases are 12 words (recommended); existing 24-word phrases keep working.
- **C.** Drop the 3-word quiz (recommended); keep an optional "Check my phrase" in Settings.
- **D.** Remove Face ID recovery in Settings needs the password (recommended) or just the session?

## 9. Plan

1. Core: method kinds, 12-word phrases, passkey-root derivations, vectors (with tests first).
2. Server: migration, multi-method registration, recovery and method endpoints (ITs first).
3. App: passkey module, sign-up step, Settings → Recovery, forgot-password chooser, reminder; website files.
4. Real-device testing (both platforms, the cross-device cases above), then release.

Rough size: a few days of work. The riskiest part is real-device PRF behaviour, so step 3 starts with a 1-hour spike
on a TestFlight build and the Android phones before the screens are built.
