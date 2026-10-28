package com.circlo.server.crypto;

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

    // MLS test clients (handles; CRYPTO.md 13a). Tests only.
    public static native long mlsNew(byte[] identity, byte[] userId, byte[] deviceId);

    public static native byte[][] mlsKeyPackages(long handle, int count, boolean lastResort);

    public static native void mlsCreateGroup(long handle, byte[] groupId);

    /** {@code [commit, welcome]}. */
    public static native byte[][] mlsAdd(long handle, byte[] groupId, byte[][] keyPackages);

    public static native byte[] mlsRemove(long handle, byte[] groupId, byte[] deviceId);

    public static native void mlsMerge(long handle, byte[] groupId);

    public static native void mlsClear(long handle, byte[] groupId);

    public static native byte[] mlsJoin(long handle, byte[] welcome);

    public static native byte[] mlsEncrypt(long handle, byte[] groupId, byte[] plaintext);

    /** Plaintext of an application message; empty for a commit; throws if unreadable. */
    public static native byte[] mlsProcess(long handle, byte[] message);
}
