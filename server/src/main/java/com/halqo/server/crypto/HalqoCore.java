package com.halqo.server.crypto;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.BooleanSupplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The server's only way to do crypto: a typed facade over the native halqo-core library, loaded once.
 * The path comes from {@code halqo.core.library} (env {@code HALQO_CORE_LIBRARY}); by default the server build of
 * the core in {@code ../core/target/server/}.
 */
@Component
public class HalqoCore {

    private static volatile boolean loaded;

    public HalqoCore(@Value("${halqo.core.library:}") String libraryPath) {
        load(libraryPath);
    }

    /** Loads the native library (idempotent). Also used by tests that run without Spring. */
    public static synchronized void load(String libraryPath) {
        if (loaded) {
            return;
        }
        Path path = (libraryPath == null || libraryPath.isBlank())
                ? Path.of("..", "core", "target", "server", System.mapLibraryName("halqo_core"))
                : Path.of(libraryPath);
        if (!Files.isRegularFile(path)) {
            throw new IllegalStateException("halqo-core native library not found at " + path.toAbsolutePath()
                    + "; build it in core/ with: cargo build --features jni --profile server");
        }
        System.load(path.toAbsolutePath().toString());
        loaded = true;
    }

    public byte[] opaqueServerSetupNew() {
        return HalqoCoreNative.opaqueServerSetupNew();
    }

    public byte[] opaqueRegistrationStart(byte[] setup, byte[] credentialId, byte[] request) {
        return HalqoCoreNative.opaqueServerRegistrationStart(setup, credentialId, request);
    }

    public byte[] opaqueRegistrationFinish(byte[] upload) {
        return HalqoCoreNative.opaqueServerRegistrationFinish(upload);
    }

    public record LoginStart(byte[] response, byte[] state) {}

    /** {@code record} is null for unknown handles: the core returns an indistinguishable fake response. */
    public LoginStart opaqueLoginStart(byte[] setup, byte[] record, byte[] credentialId, String handle, byte[] request) {
        byte[][] r = HalqoCoreNative.opaqueServerLoginStart(setup, record, credentialId, handle, request);
        return new LoginStart(r[0], r[1]);
    }

    /** The state must come from server-side storage, never from the client (CRYPTO.md 5.3). */
    public boolean opaqueLoginFinish(byte[] state, String handle, byte[] finalization) {
        return safe(() -> HalqoCoreNative.opaqueServerLoginFinish(state, handle, finalization));
    }

    public String normalizeHandle(String handle) {
        return HalqoCoreNative.normalizeHandle(handle);
    }

    public byte[] handleLookup(byte[] handleKey, String handle) {
        return HalqoCoreNative.handleLookup(handleKey, handle);
    }

    public byte[] inviteTokenHash(byte[] token) {
        return HalqoCoreNative.inviteTokenHash(token);
    }

    /** What the delivery service may read from an MLS message: its group, epoch, and whether it is a commit. */
    public record MlsMeta(byte[] groupId, long epoch, boolean commit) {}

    /** Parses only the clear MLS framing; throws {@link CoreException} for anything that isn't an MLS message. */
    public MlsMeta mlsMessageMeta(byte[] message) {
        byte[] b = HalqoCoreNative.mlsMessageMeta(message);
        int n = b.length - 9;
        if (n < 1) {
            throw new CoreException("Malformed");
        }
        return new MlsMeta(java.util.Arrays.copyOf(b, n), java.nio.ByteBuffer.wrap(b, n, 8).getLong(), b[b.length - 1] == 1);
    }

    public boolean verifyRecoveryLogin(
            byte[] pubkey, byte[] userId, byte[] challengeId, byte[] nonce, long expiresAt, byte[] signature) {
        return safe(() -> HalqoCoreNative.verifyRecoveryLogin(pubkey, userId, challengeId, nonce, expiresAt, signature));
    }

    public boolean verifyIdentity(byte[] ed25519Pk, byte[] userId, int version, byte[] x25519Pk, byte[] signature) {
        return safe(() -> HalqoCoreNative.verifyIdentity(ed25519Pk, userId, version, x25519Pk, signature));
    }

    public boolean verifyDeviceCertificate(
            byte[] identityPk, byte[] userId, byte[] deviceId, byte[] devicePk, byte[] signature) {
        return safe(() -> HalqoCoreNative.verifyDeviceCertificate(identityPk, userId, deviceId, devicePk, signature));
    }

    public byte[] sealPushToken(byte[] key, byte[] deviceId, byte[] token) {
        return HalqoCoreNative.sealPushToken(key, deviceId, token);
    }

    public byte[] openPushToken(byte[] key, byte[] deviceId, byte[] ciphertext) {
        return HalqoCoreNative.openPushToken(key, deviceId, ciphertext);
    }

    private static boolean safe(BooleanSupplier check) {
        try {
            return check.getAsBoolean();
        } catch (CoreException e) {
            return false;
        }
    }
}
