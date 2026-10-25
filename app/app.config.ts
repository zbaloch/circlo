import type { ExpoConfig } from 'expo/config';

// Names and identifiers follow docs/PLAN.md section 0A. Secrets never go here: signing keys, push keys and
// google-services.json come from EAS credentials / EAS file environment variables.
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
