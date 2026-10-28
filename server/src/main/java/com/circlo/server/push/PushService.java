package com.circlo.server.push;

import com.circlo.server.config.ServerSecrets;
import com.circlo.server.crypto.CircloCore;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Content-free push (PLAN.md Phase 10): "new activity" only. Push tokens are stored sealed with
 * CIRCLO_PUSH_TOKEN_KEY (kept outside the DB) and opened only at send time. Sends happen after the triggering
 * transaction commits, off the request thread; failures are dropped silently (no logging of tokens or devices).
 */
@Service
public class PushService {

    static final Map<String, String> ACTIVITY = Map.of("type", "activity");

    private final JdbcTemplate jdbc;
    private final CircloCore core;
    private final ServerSecrets secrets;
    private final PushSender sender;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public PushService(JdbcTemplate jdbc, CircloCore core, ServerSecrets secrets, PushSender sender) {
        this.jdbc = jdbc;
        this.core = core;
        this.secrets = secrets;
        this.sender = sender;
    }

    public byte[] sealToken(byte[] deviceId, byte[] token) {
        return core.sealPushToken(secrets.pushTokenKey(), deviceId, token);
    }

    /** Notifies the given devices (never with content). */
    public void notifyDevices(List<byte[]> deviceIds) {
        if (deviceIds.isEmpty()) {
            return;
        }
        Runnable send = () -> executor.submit(() -> {
            for (byte[] device : deviceIds) {
                try {
                    List<Object[]> rows = jdbc.query(
                            "SELECT push_token_enc, push_platform FROM devices WHERE id = ? AND revoked_at IS NULL AND push_token_enc IS NOT NULL",
                            (rs, i) -> new Object[] {rs.getBytes(1), rs.getString(2)}, (Object) device);
                    for (Object[] row : rows) {
                        byte[] token = core.openPushToken(secrets.pushTokenKey(), device, (byte[]) row[0]);
                        sender.send((String) row[1], token, ACTIVITY);
                    }
                } catch (RuntimeException e) {
                    // a bad token or provider outage: skip this device
                }
            }
        });
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    send.run();
                }
            });
        } else {
            send.run();
        }
    }

    /** All active devices of a user. */
    public void notifyUser(byte[] userId) {
        notifyDevices(jdbc.query("SELECT id FROM devices WHERE user_id = ? AND revoked_at IS NULL", (rs, i) -> rs.getBytes(1), (Object) userId));
    }
}
