// eslint-disable-next-line @typescript-eslint/no-require-imports
const { iosPinnedDomains, networkSecurityXml, pinningFromEnv } = require('../../plugins/pinning');

const pin = (b: number) => btoa(String.fromCharCode(...new Array(32).fill(b)));
const PIN_A = pin(1);
const PIN_B = pin(2);

describe('certificate pinning config', () => {
  it('is off for development builds', () => {
    expect(pinningFromEnv({ APP_VARIANT: 'development', EXPO_PUBLIC_API_URL: 'http://10.0.2.2:8080' })).toBeNull();
  });

  it('pins the API host with a current and a backup key in production', () => {
    const p = pinningFromEnv({ APP_VARIANT: 'production', EXPO_PUBLIC_API_URL: 'https://api.example.test', CIRCLO_PIN_SHA256: `${PIN_A}, ${PIN_B}`, CIRCLO_PIN_EXPIRES: '2027-06-01' });
    expect(p).toEqual({ host: 'api.example.test', pins: [PIN_A, PIN_B], expires: '2027-06-01' });
  });

  it('refuses a production build without pins, with a single pin, or with malformed pins', () => {
    const base = { APP_VARIANT: 'production', EXPO_PUBLIC_API_URL: 'https://api.example.test' };
    expect(() => pinningFromEnv(base)).toThrow(/CIRCLO_PIN_SHA256/);
    expect(() => pinningFromEnv({ ...base, CIRCLO_PIN_SHA256: PIN_A })).toThrow(/backup/);
    expect(() => pinningFromEnv({ ...base, CIRCLO_PIN_SHA256: `${PIN_A},not-a-pin` })).toThrow(/SHA-256/);
    expect(() => pinningFromEnv({ ...base, CIRCLO_PIN_SHA256: `${PIN_A},${PIN_B}`, CIRCLO_PIN_EXPIRES: 'soon' })).toThrow(/YYYY-MM-DD/);
    expect(() => pinningFromEnv({ ...base, EXPO_PUBLIC_API_URL: 'http://api.example.test', CIRCLO_PIN_SHA256: `${PIN_A},${PIN_B}` })).toThrow(/https/);
  });

  it('can be skipped explicitly for an internal production test build', () => {
    expect(pinningFromEnv({ APP_VARIANT: 'production', EXPO_PUBLIC_API_URL: 'https://api.example.test', CIRCLO_ALLOW_UNPINNED: '1' })).toBeNull();
  });

  it('writes an Android pin-set and blocks cleartext', () => {
    const xml = networkSecurityXml({ allowAllCleartext: false, pinning: { host: 'api.example.test', pins: [PIN_A, PIN_B], expires: '2027-06-01' } });
    expect(xml).toContain('<base-config cleartextTrafficPermitted="false" />');
    expect(xml).not.toContain('127.0.0.1');
    expect(xml).toContain('<domain includeSubdomains="false">api.example.test</domain>');
    expect(xml).toContain('<pin-set expiration="2027-06-01">');
    expect(xml).toContain(`<pin digest="SHA-256">${PIN_A}</pin>`);
    expect(xml).toContain(`<pin digest="SHA-256">${PIN_B}</pin>`);
    expect(networkSecurityXml({ allowAllCleartext: true, pinning: null })).not.toContain('pin-set');
  });

  it('writes iOS pinned-domain identities for the API host', () => {
    expect(iosPinnedDomains({ host: 'api.example.test', pins: [PIN_A, PIN_B] })).toEqual({
      'api.example.test': {
        NSIncludesSubdomains: false,
        NSPinnedLeafIdentities: [{ 'SPKI-SHA256-BASE64': PIN_A }, { 'SPKI-SHA256-BASE64': PIN_B }],
      },
    });
  });
});
