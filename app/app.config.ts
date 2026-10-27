import type { ExpoConfig } from 'expo/config';

// Names and identifiers follow docs/PLAN.md section 0A. Secrets never go here: signing keys, push keys and
// google-services.json come from EAS credentials / EAS file environment variables.
// Development builds talk to the local server over plain HTTP (LAN / emulator). Release builds are HTTPS-only.
const isDev = process.env.APP_VARIANT !== 'production';
// Release builds pin the API host's keys; host and pins come from EAS environment variables (plugins/pinning.js).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pinning = require('./plugins/pinning').pinningFromEnv(process.env);

const config: ExpoConfig = {
  name: 'Halqo',
  slug: 'halqo',
  scheme: 'halqo',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.halqo.app',
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
    // Loopback is needed in every build: encrypted video plays through the core's 127.0.0.1 server.
    infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
  },
  android: {
    package: 'com.halqo.app',
    adaptiveIcon: {
      backgroundColor: '#0B3B36',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
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
    ['expo-camera', { cameraPermission: 'Halqo uses the camera to scan friend invites and safety numbers, and to take photos you share.', microphonePermission: false, recordAudioAndroid: false }],
    [
      'expo-image-picker',
      {
        photosPermission: 'Halqo lets you pick photos and videos to share. They are encrypted on your phone before upload.',
        cameraPermission: 'Halqo uses the camera to scan friend invites and safety numbers, and to take photos you share.',
        microphonePermission: false,
      },
    ],
    ['expo-video', { supportsPictureInPicture: false, supportsBackgroundPlayback: false }],
    // Push carries no content; FCM/APNs credentials come from EAS, never the repo.
    ['expo-notifications', { color: '#0E8C7F' }],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#0B3B36',
        image: './assets/images/splash-icon.png',
        imageWidth: 96,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
