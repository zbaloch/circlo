// Network security for both platforms: HTTPS-only in release builds; development builds also allow plain HTTP to the
// local server on the LAN. Release builds pin the API host's keys (see pinning.js).
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, withInfoPlist } = require('expo/config-plugins');

const { iosPinnedDomains, networkSecurityXml } = require('./pinning');

module.exports = function withNetworkSecurity(config, { allowAllCleartext = false, pinning = null } = {}) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'network_security_config.xml'), networkSecurityXml({ allowAllCleartext, pinning }));
      return cfg;
    },
  ]);
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application[0];
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });
  if (!pinning) return config;
  return withInfoPlist(config, (cfg) => {
    const ats = cfg.modResults.NSAppTransportSecurity ?? {};
    cfg.modResults.NSAppTransportSecurity = { ...ats, NSPinnedDomains: { ...(ats.NSPinnedDomains ?? {}), ...iosPinnedDomains(pinning) } };
    return cfg;
  });
};
