//! JNI surface for halqo-server (`com.halqo.server.crypto.HalqoCoreNative`). Server-side operations only:
//! OPAQUE server, keyed handle lookup, signature checks, push-token sealing, invite hashing, MLS framing metadata.
//!
//! Errors and panics become `com.halqo.server.crypto.CoreException` carrying only the error kind — never key
//! material or plaintext. Built with `--features jni --profile server` (panic = unwind, so a bug can't abort the JVM).

use std::panic::{catch_unwind, AssertUnwindSafe};

use jni::objects::{JByteArray, JClass, JObject, JObjectArray, JString};
use jni::sys::{jboolean, jbyteArray, jint, jlong, jobjectArray, jstring, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;

use crate::error::{fixed, CoreError};
use crate::{blob, identity, opaque, recovery, social};

const EXCEPTION: &str = "com/halqo/server/crypto/CoreException";

enum Fail {
    Core(CoreError),
    Jni,
}

impl From<CoreError> for Fail {
    fn from(e: CoreError) -> Self {
        Fail::Core(e)
    }
}

impl From<jni::errors::Error> for Fail {
    fn from(_: jni::errors::Error) -> Self {
        Fail::Jni
    }
}

type R<T> = Result<T, Fail>;

/// Runs `f`, converting errors and panics into a thrown CoreException and returning `default`.
fn guard<T>(env: &mut JNIEnv, default: T, f: impl FnOnce(&mut JNIEnv) -> R<T>) -> T {
    let outcome = catch_unwind(AssertUnwindSafe(|| f(env)));
    let message = match outcome {
        Ok(Ok(v)) => return v,
        Ok(Err(Fail::Core(e))) => kind(&e),
        Ok(Err(Fail::Jni)) => "JniError",
        Err(_) => "InternalError",
    };
    if !env.exception_check().unwrap_or(true) {
        let _ = env.throw_new(EXCEPTION, message);
    }
    default
}

fn kind(e: &CoreError) -> &'static str {
    match e {
        CoreError::InvalidInput { .. } => "InvalidInput",
        CoreError::DecryptionFailed => "DecryptionFailed",
        CoreError::BadSignature => "BadSignature",
        CoreError::Malformed => "Malformed",
        CoreError::UnsupportedVersion => "UnsupportedVersion",
        CoreError::AuthFailed => "AuthFailed",
        CoreError::Io { .. } => "Io",
    }
}

fn bytes(env: &JNIEnv, a: &JByteArray) -> R<Vec<u8>> {
    if a.is_null() {
        return Err(Fail::Core(CoreError::InvalidInput {
            reason: "null array".into(),
        }));
    }
    Ok(env.convert_byte_array(a)?)
}

fn string(env: &mut JNIEnv, s: &JString) -> R<String> {
    if s.is_null() {
        return Err(Fail::Core(CoreError::InvalidInput {
            reason: "null string".into(),
        }));
    }
    Ok(env.get_string(s)?.into())
}

fn out(env: &JNIEnv, b: &[u8]) -> R<jbyteArray> {
    Ok(env.byte_array_from_slice(b)?.into_raw())
}

fn ok(r: Result<(), CoreError>) -> R<jboolean> {
    Ok(if r.is_ok() { JNI_TRUE } else { JNI_FALSE })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_opaqueServerSetupNew(
    mut env: JNIEnv,
    _c: JClass,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        out(env, &opaque::server_setup_new())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_opaqueServerRegistrationStart(
    mut env: JNIEnv,
    _c: JClass,
    setup: JByteArray,
    credential_id: JByteArray,
    request: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let r = opaque::server_registration_start(
            &bytes(env, &setup)?,
            &bytes(env, &credential_id)?,
            &bytes(env, &request)?,
        )?;
        out(env, &r)
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_opaqueServerRegistrationFinish(
    mut env: JNIEnv,
    _c: JClass,
    upload: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let r = opaque::server_registration_finish(&bytes(env, &upload)?)?;
        out(env, &r)
    })
}

/// Returns `[response, state]`. `record` may be null for unknown handles (fake response).
#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_opaqueServerLoginStart(
    mut env: JNIEnv,
    _c: JClass,
    setup: JByteArray,
    record: JByteArray,
    credential_id: JByteArray,
    handle: JString,
    request: JByteArray,
) -> jobjectArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let record = if record.is_null() {
            None
        } else {
            Some(bytes(env, &record)?)
        };
        let handle = social::normalize_handle(&string(env, &handle)?)?;
        let (response, state) = opaque::server_login_start(
            &bytes(env, &setup)?,
            record.as_deref(),
            &bytes(env, &credential_id)?,
            &handle,
            &bytes(env, &request)?,
        )?;
        let arr = env.new_object_array(2, "[B", JObject::null())?;
        let response = env.byte_array_from_slice(&response)?;
        let state = env.byte_array_from_slice(&state)?;
        env.set_object_array_element(&arr, 0, response)?;
        env.set_object_array_element(&arr, 1, state)?;
        Ok(arr.into_raw())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_opaqueServerLoginFinish(
    mut env: JNIEnv,
    _c: JClass,
    state: JByteArray,
    handle: JString,
    finalization: JByteArray,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |env| {
        let handle = social::normalize_handle(&string(env, &handle)?)?;
        ok(opaque::server_login_finish(
            &bytes(env, &state)?,
            &handle,
            &bytes(env, &finalization)?,
        ))
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_normalizeHandle(
    mut env: JNIEnv,
    _c: JClass,
    handle: JString,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let n = social::normalize_handle(&string(env, &handle)?)?;
        Ok(env.new_string(n)?.into_raw())
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_handleLookup(
    mut env: JNIEnv,
    _c: JClass,
    key: JByteArray,
    handle: JString,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let key: [u8; 32] = fixed(&bytes(env, &key)?, "handle key")?;
        let h = string(env, &handle)?;
        out(env, &social::handle_lookup(&key, &h)?)
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_inviteTokenHash(
    mut env: JNIEnv,
    _c: JClass,
    token: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let t: [u8; 32] = fixed(&bytes(env, &token)?, "token")?;
        out(env, &social::invite_token_hash(&t))
    })
}

/// `H(read_token)` for comparing a presented read token with the one stored at post creation (CRYPTO.md 13c).
#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_readTokenHash(
    mut env: JNIEnv,
    _c: JClass,
    token: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let t: [u8; 32] = fixed(&bytes(env, &token)?, "read_token")?;
        out(env, &crate::post::read_token_hash(&t))
    })
}

/// MLS framing the delivery service may read: `group_id || epoch:u64 BE || is_commit:u8` (CRYPTO.md 13a).
#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_mlsMessageMeta(
    mut env: JNIEnv,
    _c: JClass,
    message: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let m = crate::mls::message_meta(&bytes(env, &message)?)?;
        let mut b = m.group_id;
        b.extend_from_slice(&m.epoch.to_be_bytes());
        b.push(u8::from(m.is_commit));
        out(env, &b)
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_verifyRecoveryLogin(
    mut env: JNIEnv,
    _c: JClass,
    pubkey: JByteArray,
    user_id: JByteArray,
    challenge_id: JByteArray,
    nonce: JByteArray,
    expires_at: jlong,
    sig: JByteArray,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |env| {
        let expires = u64::try_from(expires_at).map_err(|_| CoreError::BadSignature)?;
        ok(recovery::verify_recovery_login(
            &fixed(&bytes(env, &pubkey)?, "pubkey")?,
            &fixed(&bytes(env, &user_id)?, "user_id")?,
            &fixed(&bytes(env, &challenge_id)?, "challenge_id")?,
            &fixed(&bytes(env, &nonce)?, "nonce")?,
            expires,
            &fixed(&bytes(env, &sig)?, "signature")?,
        ))
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_verifyIdentity(
    mut env: JNIEnv,
    _c: JClass,
    ed25519_pk: JByteArray,
    user_id: JByteArray,
    version: jint,
    x25519_pk: JByteArray,
    sig: JByteArray,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |env| {
        let version = u8::try_from(version).map_err(|_| CoreError::BadSignature)?;
        ok(identity::verify_identity_sig(
            &fixed(&bytes(env, &ed25519_pk)?, "ed25519_pk")?,
            &fixed(&bytes(env, &user_id)?, "user_id")?,
            version,
            &fixed(&bytes(env, &x25519_pk)?, "x25519_pk")?,
            &fixed(&bytes(env, &sig)?, "signature")?,
        ))
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_verifyDeviceCertificate(
    mut env: JNIEnv,
    _c: JClass,
    identity_pk: JByteArray,
    user_id: JByteArray,
    device_id: JByteArray,
    device_pk: JByteArray,
    sig: JByteArray,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |env| {
        ok(identity::verify_device_cert(
            &fixed(&bytes(env, &identity_pk)?, "identity_pk")?,
            &fixed(&bytes(env, &user_id)?, "user_id")?,
            &fixed(&bytes(env, &device_id)?, "device_id")?,
            &fixed(&bytes(env, &device_pk)?, "device_pk")?,
            &fixed(&bytes(env, &sig)?, "signature")?,
        ))
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_sealPushToken(
    mut env: JNIEnv,
    _c: JClass,
    key: JByteArray,
    device_id: JByteArray,
    token: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let ct = blob::seal_push_token(
            &fixed(&bytes(env, &key)?, "push key")?,
            &fixed(&bytes(env, &device_id)?, "device_id")?,
            &bytes(env, &token)?,
        )?;
        out(env, &ct)
    })
}

#[no_mangle]
pub extern "system" fn Java_com_halqo_server_crypto_HalqoCoreNative_openPushToken(
    mut env: JNIEnv,
    _c: JClass,
    key: JByteArray,
    device_id: JByteArray,
    ciphertext: JByteArray,
) -> jbyteArray {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let pt = blob::open_push_token(
            &fixed(&bytes(env, &key)?, "push key")?,
            &fixed(&bytes(env, &device_id)?, "device_id")?,
            &bytes(env, &ciphertext)?,
        )?;
        out(env, &pt)
    })
}

/// Client-side operations so halqo-server's integration tests can act as a real app. Only compiled with
/// `jni-test-client`; production server libraries are built without it.
#[cfg(feature = "jni-test-client")]
mod test_client {
    use super::*;
    use crate::identity::{generate_signing_key, Identity};
    use opaque_ke::{ClientLogin, ClientRegistration};

    fn pair(env: &mut JNIEnv, a: &[u8], b: &[u8]) -> R<jobjectArray> {
        let arr = env.new_object_array(2, "[B", JObject::null())?;
        let a = env.byte_array_from_slice(a)?;
        let b = env.byte_array_from_slice(b)?;
        env.set_object_array_element(&arr, 0, a)?;
        env.set_object_array_element(&arr, 1, b)?;
        Ok(arr.into_raw())
    }

    fn identity_of(b: &[u8]) -> R<Identity> {
        if b.len() != 128 {
            return Err(Fail::Core(CoreError::Malformed));
        }
        Ok(Identity::from_secrets(
            &fixed(&b[..32], "x")?,
            &fixed(&b[64..96], "ed")?,
        )?)
    }

    /// `x25519_sk || x25519_pk || ed25519_sk || ed25519_pk` (128 bytes).
    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_generateIdentity(
        mut env: JNIEnv,
        _c: JClass,
    ) -> jbyteArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let id = Identity::generate();
            let mut v = id.x25519_sk_bytes().to_vec();
            v.extend_from_slice(&id.x25519_pk_bytes());
            v.extend_from_slice(&*id.ed25519_sk_bytes());
            v.extend_from_slice(&id.ed25519_pk_bytes());
            out(env, &v)
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_signIdentity(
        mut env: JNIEnv,
        _c: JClass,
        identity: JByteArray,
        user_id: JByteArray,
        version: jint,
    ) -> jbyteArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let id = identity_of(&bytes(env, &identity)?)?;
            let sig = id.identity_sig(&fixed(&bytes(env, &user_id)?, "user_id")?, version as u8);
            out(env, &sig)
        })
    }

    /// `device_sk || device_pk` (64 bytes).
    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_generateDeviceKeys(
        mut env: JNIEnv,
        _c: JClass,
    ) -> jbyteArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let k = generate_signing_key();
            let mut v = k.to_bytes().to_vec();
            v.extend_from_slice(&k.verifying_key().to_bytes());
            out(env, &v)
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_signDeviceCertificate(
        mut env: JNIEnv,
        _c: JClass,
        identity: JByteArray,
        user_id: JByteArray,
        device_id: JByteArray,
        device_pk: JByteArray,
    ) -> jbyteArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let id = identity_of(&bytes(env, &identity)?)?;
            let sig = id.device_cert(
                &fixed(&bytes(env, &user_id)?, "user_id")?,
                &fixed(&bytes(env, &device_id)?, "device_id")?,
                &fixed(&bytes(env, &device_pk)?, "device_pk")?,
            );
            out(env, &sig)
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_recoveryPublicKey(
        mut env: JNIEnv,
        _c: JClass,
        entropy: JByteArray,
    ) -> jbyteArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            out(
                env,
                &recovery::recovery_public_key(&fixed(&bytes(env, &entropy)?, "entropy")?),
            )
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_signRecoveryLogin(
        mut env: JNIEnv,
        _c: JClass,
        entropy: JByteArray,
        user_id: JByteArray,
        challenge_id: JByteArray,
        nonce: JByteArray,
        expires_at: jlong,
    ) -> jbyteArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let sig = recovery::sign_recovery_login(
                &fixed(&bytes(env, &entropy)?, "entropy")?,
                &fixed(&bytes(env, &user_id)?, "user_id")?,
                &fixed(&bytes(env, &challenge_id)?, "challenge_id")?,
                &fixed(&bytes(env, &nonce)?, "nonce")?,
                expires_at as u64,
            );
            out(env, &sig)
        })
    }

    /// Returns `[request, state]`.
    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_registrationStart(
        mut env: JNIEnv,
        _c: JClass,
        password: JByteArray,
    ) -> jobjectArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let (req, state) = opaque::client_registration_start(&bytes(env, &password)?)?;
            let st = state.serialize().to_vec();
            pair(env, &req, &st)
        })
    }

    /// Returns `[upload, export_key]`.
    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_registrationFinish(
        mut env: JNIEnv,
        _c: JClass,
        state: JByteArray,
        password: JByteArray,
        handle: JString,
        response: JByteArray,
    ) -> jobjectArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let st = ClientRegistration::<opaque::Suite>::deserialize(&bytes(env, &state)?)
                .map_err(|_| CoreError::Malformed)?;
            let handle = social::normalize_handle(&string(env, &handle)?)?;
            let (upload, ek) =
                opaque::client_registration_finish(st, &bytes(env, &password)?, &handle, &bytes(env, &response)?)?;
            pair(env, &upload, &*ek)
        })
    }

    /// Returns `[request, state]`.
    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_loginStart(
        mut env: JNIEnv,
        _c: JClass,
        password: JByteArray,
    ) -> jobjectArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let (req, state) = opaque::client_login_start(&bytes(env, &password)?)?;
            let st = state.serialize().to_vec();
            pair(env, &req, &st)
        })
    }

    /// Returns `[finalization, export_key]`; throws CoreException(AuthFailed) for a wrong password.
    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_loginFinish(
        mut env: JNIEnv,
        _c: JClass,
        state: JByteArray,
        password: JByteArray,
        handle: JString,
        response: JByteArray,
    ) -> jobjectArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let st =
                ClientLogin::<opaque::Suite>::deserialize(&bytes(env, &state)?).map_err(|_| CoreError::Malformed)?;
            let handle = social::normalize_handle(&string(env, &handle)?)?;
            let (fin, ek) = opaque::client_login_finish(st, &bytes(env, &password)?, &handle, &bytes(env, &response)?)?;
            pair(env, &fin, &*ek)
        })
    }

    // ---------- MLS test clients (handles into a registry; tests only) ----------

    use std::collections::HashMap;
    use std::sync::Mutex;

    static MLS: Mutex<Option<HashMap<i64, crate::mls::Client>>> = Mutex::new(None);
    static NEXT: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(1);

    fn with_client<T>(handle: jlong, f: impl FnOnce(&crate::mls::Client) -> crate::error::Result<T>) -> R<T> {
        let guard = MLS.lock().map_err(|_| Fail::Jni)?;
        let client = guard
            .as_ref()
            .and_then(|m| m.get(&handle))
            .ok_or(Fail::Core(CoreError::Malformed))?;
        Ok(f(client)?)
    }

    fn byte_arrays_in(env: &mut JNIEnv, arr: &JObjectArray) -> R<Vec<Vec<u8>>> {
        let n = env.get_array_length(arr)?;
        let mut out = Vec::with_capacity(n as usize);
        for i in 0..n {
            let el: JByteArray = env.get_object_array_element(arr, i)?.into();
            out.push(env.convert_byte_array(el)?);
        }
        Ok(out)
    }

    fn byte_arrays_out(env: &mut JNIEnv, items: &[Vec<u8>]) -> R<jobjectArray> {
        let arr = env.new_object_array(items.len() as i32, "[B", JObject::null())?;
        for (i, b) in items.iter().enumerate() {
            let a = env.byte_array_from_slice(b)?;
            env.set_object_array_element(&arr, i as i32, a)?;
        }
        Ok(arr.into_raw())
    }

    /// A fresh MLS client for (user, device), with its credential bound by `identity` (128-byte test identity).
    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_mlsNew(
        mut env: JNIEnv,
        _c: JClass,
        identity: JByteArray,
        user_id: JByteArray,
        device_id: JByteArray,
    ) -> jlong {
        guard(&mut env, 0, |env| {
            let id = identity_of(&bytes(env, &identity)?)?;
            let (user, device): ([u8; 16], [u8; 16]) = (
                fixed(&bytes(env, &user_id)?, "user_id")?,
                fixed(&bytes(env, &device_id)?, "device_id")?,
            );
            let sk = generate_signing_key();
            let pk = sk.verifying_key().to_bytes();
            let binding = crate::mls::sign_binding(&id.ed25519, &user, &device, &pk);
            let client = crate::mls::Client::new(user, device, &sk.to_bytes(), &pk, binding, None)?;
            let handle = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            MLS.lock()
                .map_err(|_| Fail::Jni)?
                .get_or_insert_with(HashMap::new)
                .insert(handle, client);
            Ok(handle)
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_mlsKeyPackages(
        mut env: JNIEnv,
        _c: JClass,
        handle: jlong,
        count: jint,
        last_resort: jboolean,
    ) -> jobjectArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let kps = with_client(handle, |c| c.key_packages(count as usize, last_resort == JNI_TRUE))?;
            byte_arrays_out(env, &kps)
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_mlsCreateGroup(
        mut env: JNIEnv,
        _c: JClass,
        handle: jlong,
        group_id: JByteArray,
    ) {
        guard(&mut env, (), |env| {
            let g: [u8; 16] = fixed(&bytes(env, &group_id)?, "group_id")?;
            with_client(handle, |c| c.create_group(&g))
        })
    }

    /// `[commit, welcome]`; the commit stays pending until mlsMerge.
    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_mlsAdd(
        mut env: JNIEnv,
        _c: JClass,
        handle: jlong,
        group_id: JByteArray,
        key_packages: JObjectArray,
    ) -> jobjectArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let g = bytes(env, &group_id)?;
            let kps = byte_arrays_in(env, &key_packages)?;
            let out = with_client(handle, |c| c.add_members(&g, &kps))?;
            byte_arrays_out(env, &[out.commit, out.welcome.unwrap_or_default()])
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_mlsRemove(
        mut env: JNIEnv,
        _c: JClass,
        handle: jlong,
        group_id: JByteArray,
        device_id: JByteArray,
    ) -> jbyteArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let g = bytes(env, &group_id)?;
            let d: [u8; 16] = fixed(&bytes(env, &device_id)?, "device_id")?;
            let out = with_client(handle, |c| c.remove_devices(&g, &[d]))?;
            out_bytes(env, &out.commit)
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_mlsMerge(
        mut env: JNIEnv,
        _c: JClass,
        handle: jlong,
        group_id: JByteArray,
    ) {
        guard(&mut env, (), |env| {
            let g = bytes(env, &group_id)?;
            with_client(handle, |c| c.merge_pending_commit(&g))
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_mlsClear(
        mut env: JNIEnv,
        _c: JClass,
        handle: jlong,
        group_id: JByteArray,
    ) {
        guard(&mut env, (), |env| {
            let g = bytes(env, &group_id)?;
            with_client(handle, |c| c.clear_pending_commit(&g))
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_mlsJoin(
        mut env: JNIEnv,
        _c: JClass,
        handle: jlong,
        welcome: JByteArray,
    ) -> jbyteArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let w = bytes(env, &welcome)?;
            let g = with_client(handle, |c| c.join(&w))?;
            out_bytes(env, &g)
        })
    }

    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_mlsEncrypt(
        mut env: JNIEnv,
        _c: JClass,
        handle: jlong,
        group_id: JByteArray,
        plaintext: JByteArray,
    ) -> jbyteArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let (g, p) = (bytes(env, &group_id)?, bytes(env, &plaintext)?);
            let m = with_client(handle, |c| c.encrypt(&g, &p))?;
            out_bytes(env, &m)
        })
    }

    /// Plaintext for an application message, an empty array for a commit/proposal; throws if it can't be read.
    #[no_mangle]
    pub extern "system" fn Java_com_halqo_server_crypto_TestClientNative_mlsProcess(
        mut env: JNIEnv,
        _c: JClass,
        handle: jlong,
        message: JByteArray,
    ) -> jbyteArray {
        guard(&mut env, std::ptr::null_mut(), |env| {
            let m = bytes(env, &message)?;
            let r = with_client(handle, |c| c.process(&m))?;
            let plain = match r {
                crate::mls::Received::Application { plaintext, .. } => plaintext,
                _ => Vec::new(),
            };
            out_bytes(env, &plain)
        })
    }

    fn out_bytes(env: &JNIEnv, b: &[u8]) -> R<jbyteArray> {
        out(env, b)
    }
}
