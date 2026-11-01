package com.circlo.server.notify;

import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The unsubscribe link in notification emails. Opening it shows a page with one button (link scanners only open
 * links, so they can't unsubscribe anyone); the button, or a mail app's one-click unsubscribe (RFC 8058), posts back.
 * Public: the link's signature identifies the person.
 */
@RestController
public class UnsubscribeController {

    static final String PATH = "/v1/email/unsubscribe";
    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{24}");

    private final DailyDigests digests;

    public UnsubscribeController(DailyDigests digests) {
        this.digests = digests;
    }

    @GetMapping(PATH)
    public ResponseEntity<String> page(@RequestParam("u") UUID u, @RequestParam("t") String t) {
        if (!TOKEN.matcher(t).matches()) {
            return html(404, "This link isn’t valid.", "");
        }
        // Both values are checked above (a UUID and a base64url token), so they are safe to put in the page.
        return html(200, "Stop notification emails?", """
                <p>You won’t get emails about new replies and friend requests any more. You can turn them back on in
                Circlo, under Settings.</p>
                <form method="post" action="%s?u=%s&amp;t=%s"><button type="submit">Turn off emails</button></form>
                """.formatted(PATH, u, t));
    }

    @PostMapping(PATH)
    public ResponseEntity<String> unsubscribe(@RequestParam("u") UUID u, @RequestParam("t") String t) {
        if (!TOKEN.matcher(t).matches() || !digests.unsubscribe(u, t)) {
            return html(404, "This link isn’t valid.", "");
        }
        return html(200, "Emails turned off", "<p>You won’t get notification emails any more. You can turn them back on in Circlo, under Settings.</p>");
    }

    private static ResponseEntity<String> html(int status, String title, String body) {
        return ResponseEntity.status(status).contentType(new MediaType("text", "html", java.nio.charset.StandardCharsets.UTF_8)).body("""
                <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
                <title>Circlo</title><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#101828}
                button{font:inherit;font-weight:700;padding:.7rem 1.4rem;border:0;border-radius:999px;background:#101828;color:#fff}</style></head>
                <body><h1>%s</h1>%s</body></html>
                """.formatted(title, body));
    }
}
