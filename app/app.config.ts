import type { ExpoConfig } from 'expo/config';

// Names and identifiers follow docs/PLAN.md section 0A. Secrets never go here: signing keys, push keys and
// google-services.json come from EAS credentials / EAS file environment variables.
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
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.circlo.app',
    ...(buildNumber ? { buildNumber } : {}),
    // Brand pack (ios/AppIcon.appiconset): the dotted "o" on white, plus dark and tinted (iOS 18) variants.
    icon: {
      light: './assets/images/icon.png',
      dark: './assets/images/icon-ios-dark.png',
      tinted: './assets/images/icon-ios-tinted.png',
    },
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    // Loopback is needed in every build: encrypted video plays through the core's 127.0.0.1 server.
    infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
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
  },
  plugins: [
    'expo-router',
    './plugins/with-android-cmake',
    // No install attribution, advertising ids or tracking on either platform.
    './plugins/with-no-tracking',
    // Keys live in the Android Keystore / iOS Keychain; excluded from Android Auto Backup.
    ['expo-secure-store', { configureAndroidBackup: true }],
    ['./plugins/with-network-security', { allowAllCleartext: isDev, pinning }],
    ['expo-camera', { cameraPermission: 'Circlo uses the camera to scan friend invites and safety numbers, and to take photos you share.', microphonePermission: false, recordAudioAndroid: false }],
    [
      'expo-image-picker',
      {
        photosPermission: 'Circlo lets you pick photos and videos to share. They are encrypted on your phone before upload.',
        cameraPermission: 'Circlo uses the camera to scan friend invites and safety numbers, and to take photos you share.',
        microphonePermission: false,
      },
    ],
    ['expo-video', { supportsPictureInPicture: false, supportsBackgroundPlayback: false }],
    // Push carries no content; FCM/APNs credentials come from EAS, never the repo.
    ['expo-notifications', { icon: './assets/images/notification-icon.png', color: colors.brand.accent }],
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
