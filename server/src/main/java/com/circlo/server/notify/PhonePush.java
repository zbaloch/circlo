package com.circlo.server.notify;

import com.circlo.server.web.Ids;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Sends one push to every phone a person is signed in on, and says what happened to each. A phone with notifications
 * off has no token and is skipped; one Apple or Google call gone loses its token until the app registers again.
 */
@Component
public class PhonePush {

    private static final Logger log = LoggerFactory.getLogger(PhonePush.class);

    /** What happened on one phone: sent, unregistered, failed, notifications_off or provider_off. */
    public record Outcome(UUID deviceId, String kind, String result) {}

    private record Phone(byte[] id, String kind, byte[] sealed, String service) {}

    private final JdbcTemplate jdbc;
    private final PushTokens tokens;
    private final PushSender sender;

    public PhonePush(JdbcTemplate jdbc, PushTokens tokens, PushSender sender) {
        this.jdbc = jdbc;
        this.tokens = tokens;
        this.sender = sender;
    }

    public List<Outcome> send(byte[] user, PushSender.Message message) {
        // Devices from before the kind was recorded count when they have a push token.
        List<Phone> phones = jdbc.query("""
                SELECT id, kind, push_token_enc, push_service FROM devices
                WHERE user_id = ? AND revoked_at IS NULL AND (kind IN ('ios', 'android') OR push_token_enc IS NOT NULL)
                ORDER BY created_at""",
                (rs, i) -> new Phone(rs.getBytes(1), rs.getString(2), rs.getBytes(3), rs.getString(4)), (Object) user);
        List<Outcome> out = new ArrayList<>();
        for (Phone p : phones) {
            String kind = p.kind() != null ? p.kind() : "fcm".equals(p.service()) ? "android" : "ios";
            out.add(new Outcome(Ids.uuid(p.id()), kind, deliver(p, message)));
        }
        return out;
    }

    private String deliver(Phone p, PushSender.Message message) {
        if (p.sealed() == null || p.service() == null) {
            return "notifications_off";
        }
        if (!sender.enabled(p.service())) {
            return "provider_off";
        }
        try {
            String token = tokens.open(p.id(), p.sealed());
            PushSender.Result result = token == null ? PushSender.Result.UNREGISTERED : sender.send(p.service(), token, message);
            if (result == PushSender.Result.UNREGISTERED) {
                jdbc.update("UPDATE devices SET push_token_enc = NULL, push_service = NULL, push_lost = TRUE WHERE id = ? AND revoked_at IS NULL",
                        (Object) p.id());
            }
            return result.name().toLowerCase();
        } catch (RuntimeException e) {
            log.warn("push failed ({})", e.getClass().getSimpleName());
            return "failed";
        }
    }
}
