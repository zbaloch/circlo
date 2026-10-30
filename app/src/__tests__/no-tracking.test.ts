// eslint-disable-next-line @typescript-eslint/no-require-imports
const { blockPermissions, BLOCKED_PERMISSIONS, IOS_PRIVACY_MANIFEST } = require('../../plugins/with-no-tracking');

describe('no tracking', () => {
  it('removes install-referrer and advertising-id permissions from the merged Android manifest', () => {
    const manifest = blockPermissions({ $: {}, 'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }, { $: { 'android:name': 'com.google.android.gms.permission.AD_ID' } }] });
    const perms = manifest['uses-permission'].map((p: { $: Record<string, string> }) => p.$);
    expect(perms).toContainEqual({ 'android:name': 'android.permission.INTERNET' });
    expect(perms).not.toContainEqual({ 'android:name': 'com.google.android.gms.permission.AD_ID' });
    for (const name of BLOCKED_PERMISSIONS) expect(perms).toContainEqual({ 'android:name': name, 'tools:node': 'remove' });
    expect(BLOCKED_PERMISSIONS).toContain('com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE');
    expect(BLOCKED_PERMISSIONS).toContain('com.google.android.c2dm.permission.RECEIVE'); // no remote push
    expect(manifest.$['xmlns:tools']).toBe('http://schemas.android.com/tools');
  });

  it('declares no tracking and no collected data in the iOS privacy manifest', () => {
    expect(IOS_PRIVACY_MANIFEST).toEqual({ NSPrivacyTracking: false, NSPrivacyTrackingDomains: [], NSPrivacyCollectedDataTypes: [] });
  });
});
