package com.halqo.server.web;

import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.util.UUID;

/** 16-byte IDs: UUID strings in JSON, BINARY(16) in the database, the same bytes in crypto AAD. */
public final class Ids {

    private static final SecureRandom RANDOM = new SecureRandom();

    private Ids() {}

    public static byte[] bytes(UUID id) {
        return ByteBuffer.allocate(16).putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits()).array();
    }

    public static UUID uuid(byte[] b) {
        ByteBuffer bb = ByteBuffer.wrap(b);
        return new UUID(bb.getLong(), bb.getLong());
    }

    /** UUIDv7: time-ordered (good index locality), 74 random bits. */
    public static UUID newId() {
        byte[] b = new byte[16];
        RANDOM.nextBytes(b);
        long ms = System.currentTimeMillis();
        for (int i = 0; i < 6; i++) {
            b[i] = (byte) (ms >>> (40 - 8 * i));
        }
        b[6] = (byte) ((b[6] & 0x0f) | 0x70);
        b[8] = (byte) ((b[8] & 0x3f) | 0x80);
        return uuid(b);
    }

    public static byte[] random(int n) {
        byte[] b = new byte[n];
        RANDOM.nextBytes(b);
        return b;
    }
}
