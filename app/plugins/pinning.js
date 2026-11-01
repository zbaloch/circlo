// Certificate pinning for release builds (PLAN.md Phase 12). The pinned host is taken from EXPO_PUBLIC_API_URL and
// the pins from CIRCLO_PIN_SHA256 (EAS environment variables), so no production hostname or key is in the repo.
// Pins are base64 SHA-256 hashes of the server's SubjectPublicKeyInfo: the current key plus at least one backup key
// kept offline, so a key change never locks users out. Renew certificates with the same key (e.g. certbot
// --reuse-key). Only the API host is pinned: media in the bucket is end-to-end encrypted and checked by AEAD.

function fail(msg) {
  throw new Error(`Certificate pinning: ${msg}`);
}

/** Pinning settings for this build, or null when pinning is off (development, or explicitly skipped). */
function pinningFromEnv(env) {
  if (env.APP_VARIANT !== 'production') return null;
  if (env.CIRCLO_ALLOW_UNPINNED === '1') return null;
  let url;
  try {
    url = new URL(env.EXPO_PUBLIC_API_URL ?? '');
  } catch {
    fail('EXPO_PUBLIC_API_URL must be set for production builds.');
  }
  if (url.protocol !== 'https:') fail('EXPO_PUBLIC_API_URL must be https in production builds.');
  const pins = (env.CIRCLO_PIN_SHA256 ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (pins.length === 0) fail('set CIRCLO_PIN_SHA256 (comma-separated SPKI pins), or CIRCLO_ALLOW_UNPINNED=1 for an internal test build.');
  for (const p of pins) {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(p) || Buffer.from(p, 'base64').length !== 32) fail(`"${p}" is not a base64 SHA-256 pin.`);
  }
  if (new Set(pins).size < 2) fail('add a backup pin (a second key kept offline) so a key change can’t lock users out.');
  const expires = env.CIRCLO_PIN_EXPIRES;
  if (expires !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) fail('CIRCLO_PIN_EXPIRES must be YYYY-MM-DD.');
  return { host: url.hostname, pins, ...(expires ? { expires } : {}) };
}

/** Android network_security_config.xml: HTTPS only (plus cleartext to the dev server in development builds). */
function networkSecurityXml({ allowAllCleartext, pinning }) {
  const pinned = pinning
    ? `
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="false">${pinning.host}</domain>
        <pin-set${pinning.expires ? ` expiration="${pinning.expires}"` : ''}>
${pinning.pins.map((p) => `            <pin digest="SHA-256">${p}</pin>`).join('\n')}
        </pin-set>
    </domain-config>`
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="${allowAllCleartext}" />${pinned}
</network-security-config>
`;
}

/** iOS NSAppTransportSecurity.NSPinnedDomains entry (iOS 14+). */
function iosPinnedDomains(pinning) {
  return {
    [pinning.host]: {
      NSIncludesSubdomains: false,
      NSPinnedLeafIdentities: pinning.pins.map((p) => ({ 'SPKI-SHA256-BASE64': p })),
    },
  };
}

module.exports = { pinningFromEnv, networkSecurityXml, iosPinnedDomains };
