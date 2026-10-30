// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fixPlist, storeVersion } = require('../../scripts/fix-framework-versions');

describe('framework versions for App Store uploads', () => {
  it('keeps valid versions and trims pre-release ones to their numbers', () => {
    expect(storeVersion('0.31.0')).toBeNull();
    expect(storeVersion('1')).toBeNull();
    expect(storeVersion('0.31.0-6')).toBe('0.31.0');
    expect(storeVersion('2.1.0-beta.3')).toBe('2.1.0');
    expect(storeVersion('next')).toBeNull(); // nothing numeric to keep: leave it for a human
  });

  it('rewrites only CFBundleShortVersionString in a framework Info.plist', () => {
    const plist = '<dict>\n\t<key>CFBundleShortVersionString</key><string>0.31.0-6</string>\n\t<key>CFBundleVersion</key><string>1</string>\n</dict>';
    expect(fixPlist(plist)).toBe(plist.replace('0.31.0-6', '0.31.0'));
    expect(fixPlist(plist.replace('0.31.0-6', '0.31.0'))).toBeNull();
  });
});
