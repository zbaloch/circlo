/**
 * The web app opens an article in a new tab with no link back to Circlo (noopener) and no referrer (noreferrer), so the
 * site can neither reach into the Circlo tab nor see where its reader came from. expo-web-browser would open a sized
 * popup that keeps window.opener. Same exports as open-article.ts.
 */
export type BrowserColors = { primary: string; surface: string };

export async function openArticle(url: string, _colors: BrowserColors): Promise<void> {
  window.open(url, '_blank', 'noopener,noreferrer');
}
