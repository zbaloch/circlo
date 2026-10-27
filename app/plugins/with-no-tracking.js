// No tracking (owner rule: nothing about a user is collected except what they post for others to see).
// Android: strips permissions that only serve install attribution or advertising, even when a library declares them
// (expo-application, pulled in by expo-notifications, declares the Play install-referrer permission; Halqo never
// calls it). iOS: the privacy manifest says Halqo does no tracking and collects no data types.
const { withAndroidManifest } = require('expo/config-plugins');

const BLOCKED_PERMISSIONS = [
  'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
  'com.google.android.gms.permission.AD_ID',
  'android.permission.ACCESS_ADSERVICES_AD_ID',
  'android.permission.ACCESS_ADSERVICES_ATTRIBUTION',
  'android.permission.ACCESS_ADSERVICES_TOPICS',
];

/** Adds tools:node="remove" entries so the merged manifest drops these permissions. Pure; exported for tests. */
function blockPermissions(manifest) {
  manifest.$ = { ...manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
  const kept = (manifest['uses-permission'] ?? []).filter((p) => !BLOCKED_PERMISSIONS.includes(p.$['android:name']));
  manifest['uses-permission'] = [...kept, ...BLOCKED_PERMISSIONS.map((name) => ({ $: { 'android:name': name, 'tools:node': 'remove' } }))];
  return manifest;
}

const IOS_PRIVACY_MANIFEST = { NSPrivacyTracking: false, NSPrivacyTrackingDomains: [], NSPrivacyCollectedDataTypes: [] };

function withNoTracking(config) {
  config.ios = { ...config.ios, privacyManifests: { ...config.ios?.privacyManifests, ...IOS_PRIVACY_MANIFEST } };
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults.manifest = blockPermissions(cfg.modResults.manifest);
    return cfg;
  });
}

module.exports = withNoTracking;
module.exports.blockPermissions = blockPermissions;
module.exports.BLOCKED_PERMISSIONS = BLOCKED_PERMISSIONS;
module.exports.IOS_PRIVACY_MANIFEST = IOS_PRIVACY_MANIFEST;
