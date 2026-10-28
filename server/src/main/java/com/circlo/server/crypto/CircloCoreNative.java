package com.circlo.server.crypto;

/**
 * JNI entry points into circlo-core (core/src/jni_bridge.rs). Use {@link CircloCore}, not this class directly.
 * All crypto lives in the Rust core; these are thin calls.
 */
final class CircloCoreNative {

    private CircloCoreNative() {}

    static native byte[] opaqueServerSetupNew();

    static native byte[] opaqueServerRegistrationStart(byte[] setup, byte[] credentialId, byte[] request);

    static native byte[] opaqueServerRegistrationFinish(byte[] upload);

    /** Returns {response, state}; {@code record} is null for unknown handles. */
    static native byte[][] opaqueServerLoginStart(
            byte[] setup, byte[] record, byte[] credentialId, String handle, byte[] request);

    static native boolean opaqueServerLoginFinish(byte[] state, String handle, byte[] finalization);

    static native String normalizeHandle(String handle);

    static native byte[] handleLookup(byte[] key, String handle);

    static native byte[] inviteTokenHash(byte[] token);

    static native byte[] mlsMessageMeta(byte[] message);

    static native byte[] readTokenHash(byte[] token);

    static native boolean verifyRecoveryLogin(
            byte[] pubkey, byte[] userId, byte[] challengeId, byte[] nonce, long expiresAt, byte[] signature);

    static native boolean verifyIdentity(byte[] ed25519Pk, byte[] userId, int version, byte[] x25519Pk, byte[] sig);

    static native boolean verifyDeviceCertificate(
            byte[] identityPk, byte[] userId, byte[] deviceId, byte[] devicePk, byte[] sig);

    static native byte[] sealPushToken(byte[] key, byte[] deviceId, byte[] token);

    static native byte[] openPushToken(byte[] key, byte[] deviceId, byte[] ciphertext);
}
