// eslint-disable-next-line @typescript-eslint/no-require-imports
const { optionalFeatures, OPTIONAL_FEATURES } = require('../../plugins/with-optional-features');

/**
 * Circlo is portrait only, which Google Play reads as "needs a portrait screen" and so hides it from some tablets,
 * Chromebooks and Android XR headsets (Play Console, 1.1.1). Declaring the feature optional keeps every device in.
 */
describe('optional hardware features', () => {
  it('declares a portrait screen as not required, once, keeping other features', () => {
    const manifest = { $: {}, 'uses-feature': [{ $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } }] };
    const out = optionalFeatures(optionalFeatures(manifest));
    expect(OPTIONAL_FEATURES).toContain('android.hardware.screen.portrait');
    expect(out['uses-feature']).toEqual([
      { $: { 'android:name': 'android.hardware.camera', 'android:required': 'false' } },
      { $: { 'android:name': 'android.hardware.screen.portrait', 'android:required': 'false' } },
    ]);
  });

  it('turns a required declaration into an optional one', () => {
    const manifest = { $: {}, 'uses-feature': [{ $: { 'android:name': 'android.hardware.screen.portrait' } }] };
    expect(optionalFeatures(manifest)['uses-feature']).toEqual([
      { $: { 'android:name': 'android.hardware.screen.portrait', 'android:required': 'false' } },
    ]);
  });
});
