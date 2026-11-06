package com.circlo.server.posts;

import com.circlo.server.web.Ids;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Who may see a post: its author; for Everyone posts, the author's current friends; for circle posts, those of the
 * author's current friends who are in one of the chosen circles now (owner decision 2026-11-01: taking someone out of
 * a circle closes its posts to them, earlier ones too, and putting them in opens them). Likes follow the post; replies
 * also stay in the circle they came from ({@link #replyVisibleTo}).
 */
@Component
public class PostAccess {

    /** My accepted friends' ids (two parameters: me, me). */
    public static final String FRIENDS = "(SELECT user_b FROM friendships WHERE user_a = ? AND status = 'accepted' "
            + "UNION SELECT user_a FROM friendships WHERE user_b = ? AND status = 'accepted')";

    /** True for posts `p` the viewer may see; bind with {@link #visibleArgs}. */
    public static final String VISIBLE = "(p.author_id = ? OR (p.author_id IN " + FRIENDS + " AND (p.audience = 'everyone' OR "
            + "(p.audience = 'circles' AND EXISTS (SELECT 1 FROM post_circles pc JOIN circle_members cm ON cm.owner_id = p.author_id "
            + "AND cm.circle_id = pc.circle_id WHERE pc.post_id = p.id AND cm.member_id = ?)))))";

    public static Object[] visibleArgs(byte[] viewer) {
        return new Object[] {viewer, viewer, viewer, viewer};
    }

    /**
     * True for replies `r` on posts `p` that `viewer` (a column, or "?" for a bound id) may see, once they may see the
     * post (owner decision 2026-11-06): replies stay in the circle they came from. On a circle post the viewer sees
     * their own replies, the post author's replies, and replies from people who share one of the post's circles with
     * them, as the circles are now; the post's author sees every reply. Everyone posts are one conversation. Without
     * this, Close Friends would learn who in Family the post also went to.
     */
    public static String replyVisibleTo(String viewer) {
        return "(p.author_id = " + viewer + " OR r.author_id = " + viewer + " OR r.author_id = p.author_id OR p.audience = 'everyone' "
                + "OR EXISTS (SELECT 1 FROM post_circles pc "
                + "JOIN circle_members cv ON cv.owner_id = p.author_id AND cv.circle_id = pc.circle_id AND cv.member_id = " + viewer + " "
                + "JOIN circle_members cr ON cr.owner_id = p.author_id AND cr.circle_id = pc.circle_id AND cr.member_id = r.author_id "
                + "WHERE pc.post_id = p.id))";
    }

    /** {@link #replyVisibleTo} for a bound viewer; bind with {@link #replyVisibleArgs}. */
    public static final String REPLY_VISIBLE = replyVisibleTo("?");

    public static Object[] replyVisibleArgs(byte[] viewer) {
        return new Object[] {viewer, viewer, viewer};
    }

    /** The reply's post, if the viewer may see both the post and the reply; otherwise empty (callers answer 404). */
    public Optional<byte[]> visibleReplyPost(byte[] viewer, byte[] replyId) {
        List<byte[]> post = jdbc.query("SELECT r.post_id FROM post_replies r JOIN posts p ON p.id = r.post_id WHERE r.id = ? AND "
                + REPLY_VISIBLE, (rs, i) -> rs.getBytes(1), replyId, viewer, viewer, viewer);
        return post.isEmpty() || !canSee(viewer, post.get(0)) ? Optional.empty() : Optional.of(post.get(0));
    }

    private final JdbcTemplate jdbc;

    public PostAccess(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean canSee(byte[] viewer, byte[] postId) {
        Object[] args = new Object[5];
        args[0] = postId;
        System.arraycopy(visibleArgs(viewer), 0, args, 1, 4);
        return !jdbc.queryForList("SELECT 1 FROM posts p WHERE p.id = ? AND " + VISIBLE, args).isEmpty();
    }

    public Optional<byte[]> authorOf(byte[] postId) {
        return jdbc.query("SELECT author_id FROM posts WHERE id = ?", (rs, i) -> rs.getBytes(1), (Object) postId).stream().findFirst();
    }

    /** The post's author if the viewer may see it; otherwise empty (callers answer 404, as for a missing post). */
    public Optional<byte[]> visibleAuthor(byte[] viewer, java.util.UUID postId) {
        byte[] id = Ids.bytes(postId);
        return canSee(viewer, id) ? authorOf(id) : Optional.empty();
    }
}
