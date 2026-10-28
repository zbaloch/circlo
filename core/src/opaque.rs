//! OPAQUE password authentication, RFC 9807 via `opaque-ke` (CRYPTO.md section 5).
//!
//! Client functions run in the app; server functions run in circlo-server via JNI. The server's `ServerSetup`
//! is a secret held outside the database (`CIRCLO_OPAQUE_SERVER_SETUP`).

use opaque_ke::argon2::{Algorithm, Argon2, Params, Version};
use opaque_ke::{
    CipherSuite, ClientLogin, ClientLoginFinishParameters, ClientRegistration, ClientRegistrationFinishParameters,
    CredentialFinalization, CredentialRequest, CredentialResponse, Identifiers, RegistrationRequest,
    RegistrationResponse, RegistrationUpload, Ristretto255, ServerLogin, ServerLoginParameters, ServerRegistration,
    ServerSetup, TripleDh,
};
use rand_core::OsRng;
use zeroize::Zeroizing;

use crate::error::{CoreError, Result};

pub struct Suite;

impl CipherSuite for Suite {
    type OprfCs = Ristretto255;
    type KeyExchange = TripleDh<Ristretto255, sha2::Sha512>;
    type Ksf = Argon2<'static>;
}

const SERVER_ID: &[u8] = b"circlo-server";
const CONTEXT: &[u8] = b"circlo/v1/opaque";

/// Argon2id, 64 MiB, t = 3, p = 1 (CRYPTO.md section 2).
fn ksf() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(65_536, 3, 1, None).expect("valid Argon2 params"),
    )
}

fn identifiers(handle: &str) -> Identifiers<'_> {
    Identifiers {
        client: Some(handle.as_bytes()),
        server: Some(SERVER_ID),
    }
}

fn auth<E>(_: E) -> CoreError {
    CoreError::AuthFailed
}

// ---------- client ----------

pub fn client_registration_start(password: &[u8]) -> Result<(Vec<u8>, ClientRegistration<Suite>)> {
    let r = ClientRegistration::<Suite>::start(&mut OsRng, password).map_err(auth)?;
    Ok((r.message.serialize().to_vec(), r.state))
}

/// Returns the registration upload for the server and the 64-byte export key (stays on the device).
pub fn client_registration_finish(
    state: ClientRegistration<Suite>,
    password: &[u8],
    normalized_handle: &str,
    response: &[u8],
) -> Result<(Vec<u8>, Zeroizing<[u8; 64]>)> {
    let response = RegistrationResponse::<Suite>::deserialize(response).map_err(auth)?;
    let ksf = ksf();
    let r = state
        .finish(
            &mut OsRng,
            password,
            response,
            ClientRegistrationFinishParameters::new(identifiers(normalized_handle), Some(&ksf)),
        )
        .map_err(auth)?;
    Ok((r.message.serialize().to_vec(), export_key(&r.export_key)))
}

pub fn client_login_start(password: &[u8]) -> Result<(Vec<u8>, ClientLogin<Suite>)> {
    let r = ClientLogin::<Suite>::start(&mut OsRng, password).map_err(auth)?;
    Ok((r.message.serialize().to_vec(), r.state))
}

/// Fails with `AuthFailed` for a wrong password, unknown account or a tampering server.
pub fn client_login_finish(
    state: ClientLogin<Suite>,
    password: &[u8],
    normalized_handle: &str,
    response: &[u8],
) -> Result<(Vec<u8>, Zeroizing<[u8; 64]>)> {
    let response = CredentialResponse::<Suite>::deserialize(response).map_err(auth)?;
    let ksf = ksf();
    let r = state
        .finish(
            &mut OsRng,
            password,
            response,
            ClientLoginFinishParameters::new(Some(CONTEXT), identifiers(normalized_handle), Some(&ksf)),
        )
        .map_err(auth)?;
    Ok((r.message.serialize().to_vec(), export_key(&r.export_key)))
}

fn export_key(k: &[u8]) -> Zeroizing<[u8; 64]> {
    Zeroizing::new(k.try_into().expect("SHA-512 output is 64 bytes"))
}

// ---------- server ----------

pub fn server_setup_new() -> Zeroizing<Vec<u8>> {
    Zeroizing::new(ServerSetup::<Suite>::new(&mut OsRng).serialize().to_vec())
}

fn setup(bytes: &[u8]) -> Result<ServerSetup<Suite>> {
    ServerSetup::<Suite>::deserialize(bytes).map_err(|_| CoreError::InvalidInput {
        reason: "bad OPAQUE server setup".into(),
    })
}

pub fn server_registration_start(server_setup: &[u8], credential_identifier: &[u8], request: &[u8]) -> Result<Vec<u8>> {
    let request = RegistrationRequest::<Suite>::deserialize(request).map_err(auth)?;
    let r = ServerRegistration::<Suite>::start(&setup(server_setup)?, request, credential_identifier).map_err(auth)?;
    Ok(r.message.serialize().to_vec())
}

/// The record stored in `users.opaque_record`.
pub fn server_registration_finish(upload: &[u8]) -> Result<Vec<u8>> {
    let upload = RegistrationUpload::<Suite>::deserialize(upload).map_err(auth)?;
    Ok(ServerRegistration::<Suite>::finish(upload).serialize().to_vec())
}

/// `record = None` for unknown handles: opaque-ke produces an indistinguishable fake response.
/// Returns (response for the client, serialized server state). Keep the state server-side only (it is secret).
pub fn server_login_start(
    server_setup: &[u8],
    record: Option<&[u8]>,
    credential_identifier: &[u8],
    normalized_handle: &str,
    request: &[u8],
) -> Result<(Vec<u8>, Zeroizing<Vec<u8>>)> {
    let record = record
        .map(ServerRegistration::<Suite>::deserialize)
        .transpose()
        .map_err(auth)?;
    let request = CredentialRequest::<Suite>::deserialize(request).map_err(auth)?;
    let r = ServerLogin::start(
        &mut OsRng,
        &setup(server_setup)?,
        record,
        request,
        credential_identifier,
        ServerLoginParameters {
            context: Some(CONTEXT),
            identifiers: identifiers(normalized_handle),
        },
    )
    .map_err(auth)?;
    Ok((
        r.message.serialize().to_vec(),
        Zeroizing::new(r.state.serialize().to_vec()),
    ))
}

/// Succeeds only if the client proved knowledge of the password.
///
/// SECURITY: `state` must come from server-side storage (from `server_login_start`), never from the client.
/// It contains the expected client MAC, so anyone able to supply it could complete a login.
pub fn server_login_finish(state: &[u8], normalized_handle: &str, finalization: &[u8]) -> Result<()> {
    let state = ServerLogin::<Suite>::deserialize(state).map_err(auth)?;
    let fin = CredentialFinalization::<Suite>::deserialize(finalization).map_err(auth)?;
    state
        .finish(
            fin,
            ServerLoginParameters {
                context: Some(CONTEXT),
                identifiers: identifiers(normalized_handle),
            },
        )
        .map_err(auth)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HANDLE: &str = "alice_test";
    const CRED_ID: &[u8] = b"handle-lookup-test-only";

    fn register(setup: &[u8], password: &[u8]) -> (Vec<u8>, Zeroizing<[u8; 64]>) {
        let (req, st) = client_registration_start(password).unwrap();
        let resp = server_registration_start(setup, CRED_ID, &req).unwrap();
        let (upload, ek) = client_registration_finish(st, password, HANDLE, &resp).unwrap();
        (server_registration_finish(&upload).unwrap(), ek)
    }

    fn login(setup: &[u8], record: Option<&[u8]>, password: &[u8], handle: &str) -> Result<Zeroizing<[u8; 64]>> {
        let (req, st) = client_login_start(password)?;
        let (resp, server_state) = server_login_start(setup, record, CRED_ID, HANDLE, &req)?;
        let (fin, ek) = client_login_finish(st, password, handle, &resp)?;
        server_login_finish(&server_state, HANDLE, &fin)?;
        Ok(ek)
    }

    #[test]
    fn register_then_login_yields_same_export_key() {
        let setup = server_setup_new();
        let (record, ek) = register(&setup, b"correct horse battery staple");
        let ek2 = login(&setup, Some(&record), b"correct horse battery staple", HANDLE).unwrap();
        assert_eq!(*ek, *ek2);
    }

    #[test]
    fn wrong_password_unknown_user_wrong_handle_or_wrong_setup_fail() {
        let setup = server_setup_new();
        let (record, _) = register(&setup, b"right password");
        assert_eq!(
            login(&setup, Some(&record), b"wrong password", HANDLE).err(),
            Some(CoreError::AuthFailed)
        );
        assert_eq!(
            login(&setup, None, b"right password", HANDLE).err(),
            Some(CoreError::AuthFailed)
        );
        assert_eq!(
            login(&setup, Some(&record), b"right password", "mallory").err(),
            Some(CoreError::AuthFailed)
        );
        // A stolen DB record is useless without the server setup (kept outside the DB).
        let other_setup = server_setup_new();
        assert_eq!(
            login(&other_setup, Some(&record), b"right password", HANDLE).err(),
            Some(CoreError::AuthFailed)
        );
    }

    #[test]
    fn record_does_not_contain_the_password() {
        let setup = server_setup_new();
        let pw = b"a-very-distinctive-password";
        let (record, _) = register(&setup, pw);
        assert!(!record.windows(pw.len()).any(|w| w == pw));
    }
}
