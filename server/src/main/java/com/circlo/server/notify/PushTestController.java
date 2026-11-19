package com.circlo.server.notify;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sends a test notification to all my phones, to check push end to end (locally and in production, e.g. with curl).
 * Says whether each provider has credentials and, per phone, what happened: sent, unregistered (Apple or Google say the
 * app is gone; it registers again on its next launch), failed (the server log says why), notifications_off or
 * provider_off.
 */
@RestController
public class PushTestController {

    static final PushSender.Message TEST = new PushSender.Message("This is a test notification from Circlo.", Map.of("type", "test"));

    private final PhonePush phones;
    private final PushSender sender;
    private final RateLimiter limiter;

    public PushTestController(PhonePush phones, PushSender sender, RateLimiter limiter) {
        this.phones = phones;
        this.sender = sender;
        this.limiter = limiter;
    }

    @PostMapping("/v1/push/test")
    public Map<String, Object> test(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = Ids.bytes(TokenService.userOf(jwt));
        if (!limiter.tryAcquire("push-test", me, 10, 3_600_000)) {
            throw ApiException.rateLimited();
        }
        List<Map<String, Object>> results = phones.send(me, TEST).stream()
                .map(o -> Map.<String, Object>of("deviceId", o.deviceId().toString(), "kind", o.kind(), "result", o.result()))
                .toList();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("apns", sender.enabled("apns") ? "on" : "off");
        out.put("fcm", sender.enabled("fcm") ? "on" : "off");
        out.put("phones", results);
        return out;
    }
}
