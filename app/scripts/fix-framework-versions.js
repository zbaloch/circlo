// App Store uploads reject an embedded framework whose CFBundleShortVersionString isn't "x", "x.y" or "x.y.z" of
// non-negative integers. Prebuilt frameworks from pre-release packages carry the npm version verbatim
// (@ubjs/react-native ships UniffiRuntimeJsi.xcframework as "0.31.0-6"), so after install this rewrites such versions
// to their numeric part ("0.31.0"). Xcode re-signs embedded frameworks with the app, so editing Info.plist is safe.
// Runs as the app's postinstall; prints what it changed.
const fs = require('fs');
const path = require('path');

const VALID = /^\d+(\.\d+){0,2}$/;
const SHORT_VERSION = /(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]*)(<\/string>)/;

/** Pure: a version App Store Connect accepts, or null when it already does (or there's no number to keep). */
function storeVersion(version) {
  if (VALID.test(version)) return null;
  return version.match(/^\d+(\.\d+){0,2}/)?.[0] ?? null;
}

/** Pure: the plist with a fixed short version, or null if nothing needs changing (XML plists only). */
function fixPlist(xml) {
  const m = xml.match(SHORT_VERSION);
  const fixed = m && storeVersion(m[2]);
  return fixed ? xml.replace(SHORT_VERSION, `$1${fixed}$3`) : null;
}

/** Every Info.plist of a framework inside an .xcframework under `dir`, a few levels deep (prebuilt/ios/...). */
function* frameworkPlists(dir, depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    if (e.name.endsWith('.xcframework')) {
      for (const slice of fs.readdirSync(full, { withFileTypes: true }).filter((s) => s.isDirectory())) {
        for (const fw of fs.readdirSync(path.join(full, slice.name)).filter((n) => n.endsWith('.framework'))) {
          const plist = path.join(full, slice.name, fw, 'Info.plist');
          if (fs.existsSync(plist)) yield plist;
        }
      }
    } else if (depth < 3 && e.name !== 'node_modules') {
      yield* frameworkPlists(full, depth + 1);
    }
  }
}

function main() {
  const root = path.join(__dirname, '..', 'node_modules');
  // Packages that ship prebuilt iOS frameworks; scoped packages live one level down.
  for (const pkg of ['@ubjs/react-native']) {
    for (const plist of frameworkPlists(path.join(root, pkg))) {
      const xml = fs.readFileSync(plist, 'utf8');
      const fixed = fixPlist(xml);
      if (fixed) {
        fs.writeFileSync(plist, fixed);
        console.log(`fix-framework-versions: ${path.relative(root, plist)} -> ${fixed.match(SHORT_VERSION)[2]}`);
      }
    }
  }
}

if (require.main === module) main();

module.exports = { storeVersion, fixPlist };
