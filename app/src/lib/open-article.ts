/**
 * Opens a Reading article on its own site: in the in-app browser on phones (Safari View Controller / Chrome Custom
 * Tabs, which send no referrer), falling back to the system browser. The web app has its own (open-article.web.ts).
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

export type BrowserColors = { primary: string; surface: string };

export async function openArticle(url: string, colors: BrowserColors): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      controlsColor: colors.primary,
      toolbarColor: colors.surface,
      dismissButtonStyle: 'close',
      enableBarCollapsing: true,
      showTitle: true,
    });
  } catch {
    await Linking.openURL(url);
  }
}
