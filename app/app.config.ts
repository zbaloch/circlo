import type { ExpoConfig } from 'expo/config';

// Names and identifiers follow docs/PLAN.md section 0A. Secrets never go here: signing keys come from EAS credentials or
// the release workflow's secrets. Push on iPhone is content-free and sent by Circlo's server straight to Apple; the APNs
// key lives only on the server (CIRCLO_APNS_*). Android has no remote push yet, so no google-services.json.
// Development builds talk to the local server over plain HTTP (LAN / emulator). Release builds are HTTPS-only.
const isDev = process.env.APP_VARIANT !== 'production';
// Release builds pin the API host's keys; host and pins come from EAS environment variables (plugins/pinning.js).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pinning = require('./plugins/pinning').pinningFromEnv(process.env);
// Brand and surface colours come from the design tokens, so native assets match the app.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { colors } = require('./src/theme/tokens');
// Store builds need a higher build number each time; the release workflow passes its run number.
const buildNumber = process.env.CIRCLO_BUILD_NUMBER;

const config: ExpoConfig = {
  name: 'Circlo',
  slug: 'circlo',
  scheme: 'circlo',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    // com.circlo.app was already taken on Apple's side, so iOS uses com.hellocirclo.app (owner decision 2026-10-31).
    bundleIdentifier: 'com.hellocirclo.app',
    ...(buildNumber ? { buildNumber } : {}),
    // Brand pack (ios/AppIcon.appiconset): the dotted "o" on white, plus dark and tinted (iOS 18) variants.
    icon: {
      light: './assets/images/icon.png',
      dark: './assets/images/icon-ios-dark.png',
      tinted: './assets/images/icon-ios-tinted.png',
    },
    supportsTablet: false,
    // Invite links (https://www.hellocirclo.com/i/<token>) open the app: www.hellocirclo.com serves the matching
    // apple-app-site-association (circlo-web), and the App ID has the Associated Domains capability.
    associatedDomains: ['applinks:www.hellocirclo.com'],
    // Export compliance: Circlo uses only standard HTTPS (TLS) from the operating system, which is exempt.
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: 'com.circlo.app',
    ...(buildNumber ? { versionCode: Number(buildNumber) } : {}),
    adaptiveIcon: {
      backgroundColor: colors.brand.background,
      foregroundImage: './assets/images/adaptive-icon-foreground.png',
      monochromeImage: './assets/images/adaptive-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Invite links open the app (www.hellocirclo.com serves the matching assetlinks.json).
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: 'www.hellocirclo.com', pathPrefix: '/i' }],
      },
    ],
  },
  // The web app (app.hellocirclo.com): the same screens, exported as a static single-page app.
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/images/favicon.png',
    name: 'Circlo',
    shortName: 'Circlo',
    themeColor: colors.brand.accent,
    backgroundColor: colors.brand.background,
  },
  // Which Apple push service this build's tokens belong to (it must match the aps-environment entitlement above).
  extra: { pushService: isDev ? 'apns_sandbox' : 'apns' },
  plugins: [
    'expo-router',
    // No install attribution, advertising ids or tracking on either platform.
    './plugins/with-no-tracking',
    // The session lives in the Android Keystore / iOS Keychain; excluded from Android Auto Backup.
    ['expo-secure-store', { configureAndroidBackup: true }],
    ['./plugins/with-network-security', { allowAllCleartext: isDev, pinning }],
    ['expo-camera', { cameraPermission: 'Circlo uses the camera to scan friend invites and to take photos you share.', microphonePermission: false, recordAudioAndroid: false }],
    [
      'expo-image-picker',
      {
        photosPermission: 'Circlo lets you pick photos and videos to share with the people you choose. Location and camera details are removed first.',
        cameraPermission: 'Circlo uses the camera to scan friend invites and to take photos you share.',
        microphonePermission: false,
      },
    ],
    ['expo-video', { supportsPictureInPicture: false, supportsBackgroundPlayback: false }],
    // iPhone: content-free remote push (lib/background-check); TestFlight and App Store builds use Apple's production
    // service, development builds the sandbox. Android: local notifications from background checks (no FCM yet).
    [
      'expo-notifications',
      { icon: './assets/images/notification-icon.png', color: colors.brand.accent, enableRemoteNotifications: true, mode: isDev ? 'development' : 'production' },
    ],
    // Background checks for new activity (iOS BGTaskScheduler, Android WorkManager).
    'expo-background-task',
    // The wordmark: gray-900 with a sky-500 dot on white; white with a sky-400 dot on gray-950 in dark mode.
    [
      'expo-splash-screen',
      {
        backgroundColor: colors.brand.background,
        image: './assets/images/splash-wordmark.png',
        imageWidth: 180,
        resizeMode: 'contain',
        dark: { backgroundColor: colors.brand['background-dark'], image: './assets/images/splash-wordmark-dark.png' },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
