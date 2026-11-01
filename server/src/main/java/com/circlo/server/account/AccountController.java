package com.circlo.server.account;

import com.circlo.server.auth.Accounts;
import com.circlo.server.auth.AuthService;
import com.circlo.server.auth.TokenService;
import com.circlo.server.media.Attachments;
import com.circlo.server.media.MediaSweeper;
import com.circlo.server.storage.MediaStore;
import com.circlo.server.storage.MediaUrlSigner;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** My account: profile and photo, signed-in devices, recent sign-ins, a copy of my data, and deleting it all. */
@RestController
public class AccountController {

    private final JdbcTemplate jdbc;
    private final MediaUrlSigner signer;
    private final MediaStore store;
    private final Attachments attachments;
    private final TokenService tokens;
    private final AuthService auth;

    public AccountController(JdbcTemplate jdbc, MediaUrlSigner signer, MediaStore store, Attachments attachments, TokenService tokens,
            AuthService auth) {
        this.jdbc = jdbc;
        this.signer = signer;
        this.store = store;
        this.attachments = attachments;
        this.tokens = tokens;
        this.auth = auth;
    }

    private static byte[] userId(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    // ---------- profile ----------

    /** `name` is null until I set one. */
    public record Me(UUID userId, String name, String username, String email, String bio, String avatarUrl, Instant createdAt) {}

    @GetMapping("/v1/me")
    public Me me(@AuthenticationPrincipal Jwt jwt) {
        return load(userId(jwt));
    }

    private Me load(byte[] me) {
        return jdbc.query("SELECT id, name, username, email, bio, avatar_key, created_at FROM users WHERE id = ? AND status = 'active'",
                        (rs, i) -> new Me(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                                signer.url(rs.getString(6)), rs.getTimestamp(7).toInstant()),
                        (Object) me)
                .stream().findFirst().orElseThrow(ApiException::unauthorized);
    }

    public record ProfileEdit(@NotNull @Size(max = 200) String name, @NotNull @Size(max = 1000) String bio) {}

    @PutMapping("/v1/me/profile")
    public Me editProfile(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ProfileEdit r) {
        byte[] me = userId(jwt);
        jdbc.update("UPDATE users SET name = ?, bio = ? WHERE id = ?", Accounts.optionalName(r.name()), Accounts.bio(r.bio()), me);
        return load(me);
    }

    public record AvatarRequest(@NotNull @Pattern(regexp = "[0-9a-f]{64}") String objectKey) {}

    /** Sets my photo to an image I just uploaded; the previous one is removed from the bucket. */
    @PutMapping("/v1/me/avatar")
    @Transactional
    public Me setAvatar(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody AvatarRequest r) {
        byte[] me = userId(jwt);
        if (!attachments.claim(me, r.objectKey()).startsWith("image/")) {
            throw ApiException.badRequest("wrong_media_type");
        }
        MediaSweeper.release(jdbc, "owner_id = ? AND is_avatar = TRUE", (Object) me);
        jdbc.update("UPDATE media_uploads SET is_avatar = TRUE WHERE object_key = ?", r.objectKey());
        jdbc.update("UPDATE users SET avatar_key = ? WHERE id = ?", r.objectKey(), me);
        return load(me);
    }

    @DeleteMapping("/v1/me/avatar")
    @Transactional
    public Me removeAvatar(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = userId(jwt);
        MediaSweeper.release(jdbc, "owner_id = ? AND is_avatar = TRUE", (Object) me);
        jdbc.update("UPDATE users SET avatar_key = NULL WHERE id = ?", (Object) me);
        return load(me);
    }

    // ---------- devices and sign-ins ----------

    public record DeviceView(UUID deviceId, Instant createdAt, boolean current) {}

    /** The devices and browsers signed in to my account, oldest first. */
    @GetMapping("/v1/devices")
    public List<DeviceView> devices(@AuthenticationPrincipal Jwt jwt) {
        UUID current = TokenService.deviceOf(jwt);
        return jdbc.query("SELECT id, created_at FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at",
                (rs, i) -> new DeviceView(Ids.uuid(rs.getBytes(1)), rs.getTimestamp(2).toInstant(), Ids.uuid(rs.getBytes(1)).equals(current)),
                (Object) userId(jwt));
    }

    /** Signs a device out (it can't refresh its session or run background checks any more). */
    @DeleteMapping("/v1/devices/{deviceId}")
    public Map<String, String> revoke(@AuthenticationPrincipal Jwt jwt, @PathVariable("deviceId") UUID deviceId) {
        if (!tokens.revokeDevice(TokenService.userOf(jwt), deviceId)) {
            throw ApiException.notFound();
        }
        return Map.of("status", "revoked");
    }

    public record SecurityEvent(UUID id, String kind, Instant createdAt) {}

    public record SecurityEvents(List<SecurityEvent> events) {}

    /** Recent sign-ins to my account (30 days, newest first). */
    @GetMapping("/v1/security-events")
    public SecurityEvents securityEvents(@AuthenticationPrincipal Jwt jwt) {
        return new SecurityEvents(jdbc.query(
                "SELECT id, kind, created_at FROM security_events WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 20",
                (rs, i) -> new SecurityEvent(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getTimestamp(3).toInstant()),
                userId(jwt), Timestamp.from(Instant.now().minus(Duration.ofDays(30)))));
    }

    // ---------- export and deletion ----------

    /**
     * A copy of what I've put into Circlo: my profile, circles, friends, posts with their replies to me, my replies and
     * likes, and the chats I'm in. Photos and videos are listed with download links (valid for an hour).
     */
    @GetMapping("/v1/me/export")
    public Map<String, Object> export(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = userId(jwt);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("exportedAt", Instant.now());
        out.put("profile", load(me));
        out.put("circles", jdbc.queryForList("""
                SELECT c.id, c.name, (SELECT GROUP_CONCAT(u.username ORDER BY u.username) FROM circle_members m JOIN users u ON u.id = m.member_id
                  WHERE m.owner_id = c.owner_id AND m.circle_id = c.id) AS members
                FROM circles c WHERE c.owner_id = ? ORDER BY c.id""", (Object) me));
        out.put("friends", jdbc.queryForList("""
                SELECT COALESCE(u.name, u.username) AS name, u.username, f.status, f.created_at AS since FROM friendships f
                JOIN users u ON u.id = IF(f.user_a = ?, f.user_b, f.user_a) WHERE f.user_a = ? OR f.user_b = ?""", me, me, me));
        List<Map<String, Object>> posts = jdbc.queryForList(
                "SELECT id, body AS text, audience, created_at FROM posts WHERE author_id = ? ORDER BY created_at", (Object) me);
        Map<UUID, List<Attachments.AttachmentView>> media = attachments.of("post_id",
                posts.stream().map(p -> Ids.uuid((byte[]) p.get("id"))).toList());
        for (Map<String, Object> p : posts) {
            byte[] id = (byte[]) p.get("id");
            p.put("id", Ids.uuid(id));
            p.put("media", media.getOrDefault(Ids.uuid(id), List.of()));
            p.put("replies", jdbc.queryForList("""
                    SELECT u.username AS author, r.body AS text, r.created_at FROM post_replies r JOIN users u ON u.id = r.author_id
                    WHERE r.post_id = ? ORDER BY r.created_at""", (Object) id));
        }
        out.put("posts", posts);
        out.put("myReplies", jdbc.queryForList("""
                SELECT u.username AS postAuthor, r.body AS text, r.created_at FROM post_replies r JOIN posts p ON p.id = r.post_id
                JOIN users u ON u.id = p.author_id WHERE r.author_id = ? ORDER BY r.created_at""", (Object) me));
        out.put("chats", jdbc.query("SELECT chat_id FROM chat_members WHERE user_id = ?", (rs, i) -> {
            byte[] chat = rs.getBytes(1);
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("members", jdbc.queryForList("SELECT u.username FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.chat_id = ?",
                    String.class, (Object) chat));
            c.put("messages", jdbc.queryForList("""
                    SELECT u.username AS sender, m.body AS text, m.created_at FROM chat_messages m JOIN users u ON u.id = m.sender_id
                    WHERE m.chat_id = ? ORDER BY m.seq""", (Object) chat));
            return c;
        }, (Object) me));
        return out;
    }

    public record DeleteAccount(@NotNull @Size(max = 512) String password) {}

    /**
     * Deletes my account after checking my password. Files in the bucket go first, then the user row; every other row
     * (posts, replies, likes, circles, friendships, chats memberships and messages, devices, sessions) cascades.
     */
    @DeleteMapping("/v1/account")
    @Transactional(noRollbackFor = ApiException.class) // a wrong password still counts towards the lock
    public Map<String, String> deleteAccount(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody DeleteAccount r) {
        if (!auth.confirmPassword(TokenService.userOf(jwt), r.password())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "wrong_password");
        }
        byte[] me = userId(jwt);
        for (String key : jdbc.queryForList("SELECT object_key FROM media_uploads WHERE owner_id = ?", String.class, (Object) me)) {
            store.delete(key);
        }
        jdbc.update("DELETE FROM users WHERE id = ?", (Object) me);
        return Map.of("status", "deleted");
    }
}
