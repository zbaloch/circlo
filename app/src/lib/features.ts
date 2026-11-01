/**
 * Product switches. Chat is hidden (owner decision 2026-11-01): Circlo is about posts in circles, and people already
 * chat elsewhere. Everything behind it (screens, lib/messaging, the server's /v1/chats) is kept intact; set this to
 * true to bring the Messages tab back.
 */
export const CHAT_ENABLED = false;

/**
 * Likes are hidden (owner decision 2026-11-01): counting approval is vanity; if something matters, people reply. The
 * like buttons, counts, "Liked by" lines, the Likes tab and like notifications are switched off here; the server's
 * likes and the app code behind them are kept intact.
 */
export const LIKES_ENABLED = false;
