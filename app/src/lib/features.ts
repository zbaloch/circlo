/**
 * Product switches. Chat is on again (owner decision 2026-11-07, reversing 2026-11-01's "people chat elsewhere"):
 * the Messages tab, chats with one person or a group, with report and block on every message. Set this to false to
 * hide it again; the screens, lib/messaging and the server's /v1/chats stay intact either way.
 */
export const CHAT_ENABLED = true;

/**
 * Likes are hidden (owner decision 2026-11-01): counting approval is vanity; if something matters, people reply. The
 * like buttons, counts, "Liked by" lines, the Likes tab and like notifications are switched off here; the server's
 * likes and the app code behind them are kept intact.
 */
export const LIKES_ENABLED = false;

/**
 * The web app's "Get Circlo for iPhone" banner (components/app-banner). Off until App Store review approves 1.1:
 * 1.0 has no chat, so sending people there from the web app would be a step down. Turn on once 1.1 is live.
 */
export const APP_BANNER_ENABLED = false;
