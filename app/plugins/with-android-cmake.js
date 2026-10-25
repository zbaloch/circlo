// Pins the CMake used for the app's native build. CMake 4.x ships a ninja that understands Windows long paths;
// the default (3.22, ninja 1.10) fails on React Native codegen object paths longer than 260 characters.
// Requires Windows long paths enabled (docs/DEV_SETUP.md). No effect on macOS/Linux beyond the version pin.
const { withAppBuildGradle } = require('expo/config-plugins');

const CMAKE_VERSION = '4.1.2';

module.exports = function withAndroidCmake(config) {
  return withAppBuildGradle(config, (cfg) => {
    const marker = '// halqo: cmake version';
    if (!cfg.modResults.contents.includes(marker)) {
      cfg.modResults.contents += `
${marker}
android {
    externalNativeBuild {
        cmake {
            version "${CMAKE_VERSION}"
        }
    }
}
`;
    }
    return cfg;
  });
};
