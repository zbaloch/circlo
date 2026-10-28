// Pins the CMake used for every native build (the app and each library with C++, e.g. reanimated). CMake 4.x ships
// a ninja that understands Windows long paths; the default (3.22, ninja 1.10) fails on object paths longer than 260
// characters (React Native codegen in the app, reanimated's CSS sources for arm64-v8a).
// Requires Windows long paths enabled (docs/DEV_SETUP.md). No effect on macOS/Linux beyond the version pin.
const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const CMAKE_VERSION = '4.1.2';

module.exports = function withAndroidCmake(config) {
  config = withAppBuildGradle(config, (cfg) => {
    const marker = '// circlo: cmake version';
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
  return withProjectBuildGradle(config, (cfg) => {
    const marker = '// circlo: cmake version for libraries';
    if (!cfg.modResults.contents.includes(marker)) {
      cfg.modResults.contents += `
${marker}
subprojects { sub ->
    // Set while the library is being configured (afterEvaluate is too late); ignored by modules without CMake.
    sub.plugins.withId('com.android.library') {
        sub.android.externalNativeBuild.cmake.version = "${CMAKE_VERSION}"
    }
}
`;
    }
    return cfg;
  });
};
