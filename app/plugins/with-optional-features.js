// Hardware features Circlo doesn't need a device to have. The app is portrait only (app.config.ts `orientation`), and
// Google Play reads screenOrientation="portrait" as an implied requirement for a portrait screen, which hides Circlo
// from some tablets, Chromebooks and Android XR headsets (Play Console warning on 1.1.1). Declared optional, every
// device can install it; it still opens in portrait.
const { withAndroidManifest } = require('expo/config-plugins');

const OPTIONAL_FEATURES = ['android.hardware.screen.portrait'];

/** Declares each of OPTIONAL_FEATURES with android:required="false". Pure; exported for tests. */
function optionalFeatures(manifest) {
  const others = (manifest['uses-feature'] ?? []).filter((f) => !OPTIONAL_FEATURES.includes(f.$['android:name']));
  manifest['uses-feature'] = [...others, ...OPTIONAL_FEATURES.map((name) => ({ $: { 'android:name': name, 'android:required': 'false' } }))];
  return manifest;
}

function withOptionalFeatures(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults.manifest = optionalFeatures(cfg.modResults.manifest);
    return cfg;
  });
}

module.exports = withOptionalFeatures;
module.exports.optionalFeatures = optionalFeatures;
module.exports.OPTIONAL_FEATURES = OPTIONAL_FEATURES;
