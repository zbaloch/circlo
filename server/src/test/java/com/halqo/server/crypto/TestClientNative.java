package com.halqo.server.crypto;

/**
 * Client-side core operations for integration tests, only present in libraries built with the
 * {@code jni-test-client} feature. Lets tests act as a real app: OPAQUE client, identity keys, signatures.
 */
public final class TestClientNative {

    private TestClientNative() {}

    /** x25519_sk || x25519_pk || ed25519_sk || ed25519_pk (128 bytes). */
    public static native byte[] generateIdentity();

    public static native byte[] signIdentity(byte[] identity, byte[] userId, int version);

    /** device_sk || device_pk (64 bytes). */
    public static native byte[] generateDeviceKeys();

    public static native byte[] signDeviceCertificate(byte[] identity, byte[] userId, byte[] deviceId, byte[] devicePk);

    public static native byte[] recoveryPublicKey(byte[] entropy);

    public static native byte[] signRecoveryLogin(
            byte[] entropy, byte[] userId, byte[] challengeId, byte[] nonce, long expiresAt);

    /** {request, state}. */
    public static native byte[][] registrationStart(byte[] password);

    /** {upload, exportKey}. */
    public static native byte[][] registrationFinish(byte[] state, byte[] password, String handle, byte[] response);

    /** {request, state}. */
    public static native byte[][] loginStart(byte[] password);

    /** {finalization, exportKey}; throws CoreException("AuthFailed") for a wrong password. */
    public static native byte[][] loginFinish(byte[] state, byte[] password, String handle, byte[] response);
}
