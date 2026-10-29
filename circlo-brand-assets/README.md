# Circlo brand assets: wordmark with the dotted "o"

Instructions for Claude Code: install these assets into the Circlo monorepo
(the website plus the React Native app for iOS and Android). Work out which setup
the repo uses (bare React Native with `ios/` and `android/` folders, or Expo
config via `app.json` / `app.config.*`) and follow the matching section. Replace
the existing icons, logos and splash screens, including any earlier Circlo "Halo",
"Fan", plain-"c" or sky-background versions, and don't keep the old ones side by side.

## The identity

- **Logo:** the word "circlo". The final "o" is a ring with a dot inside.
- **Colours:** the letters and the ring are near-black (gray-900) on light backgrounds
  and white on dark ones. **Only the dot is sky:** sky-500 in light mode, sky-400 in
  dark mode.
- **Symbol:** the dotted "o" on its own, used for the app icon, favicon, notification
  icon and avatar placeholder.
- **Backgrounds:** icons and splash screens are white in light mode and near-black
  (gray-950) in dark mode. Sky is never used as a background.

| Token | Hex | Tailwind | Use |
|---|---|---|---|
| ink | `#101828` | `gray-900` | Letters and ring on light backgrounds; body text |
| white | `#FFFFFF` | `white` | Letters and ring on dark backgrounds; light backgrounds and icon tile |
| dark background | `#030712` | `gray-950` | Dark-mode splash and dark backgrounds |
| dot (light) | `#0EA5E9` | `sky-500` | The dot on light backgrounds; filled buttons |
| dot (dark) | `#38BDF8` | `sky-400` | The dot on dark backgrounds; accents in dark mode |
| link text | `#0284C7` | `sky-600` | Links and accent text on white (4.1:1); use `sky-400` in dark mode |

These tokens are in `brand/colors.css`, which switches automatically with
`prefers-color-scheme`, and in `brand/colors.json`. In Tailwind:
`text-gray-900 dark:text-white` for the wordmark's colour logic,
`bg-sky-500 dark:bg-sky-400` for the dot or accent, and
`text-sky-600 dark:text-sky-400` for links.

### Which file to use
| File | Use |
|---|---|
| `circlo-wordmark-color.svg` | Light backgrounds: gray-900 letters and ring, sky-500 dot |
| `circlo-wordmark-on-dark.svg` | Dark backgrounds: white letters and ring, sky-400 dot |
| `circlo-wordmark-auto.svg` | The website, if inlined: switches between the two above via `prefers-color-scheme` |
| `circlo-wordmark-black.svg` / `-white.svg` | One-colour use only (print, stamps); the dot matches the letters |
| `circlo-symbol-*.svg` | The dotted "o" alone, in the same variants |

The letters "circl" are outlined from Inter Display SemiBold (SIL Open Font License),
so the SVGs don't need the font installed. The dotted "o" is a drawn ring and dot matched
to the approved design. Always use the files; never retype the logo in a font. If the
website or app uses a class-based dark mode (`.dark` on `<html>`) rather than the system
setting, render `-color` and `-on-dark` with `dark:hidden` / `hidden dark:block` instead
of relying on the `-auto` file.

## What's in the pack

```
logo/svg/        circlo-wordmark-{color,on-dark,auto,black,white}.svg
                 circlo-symbol-{color,on-dark,black,white}.svg
                 circlo-app-icon.svg                              1024 app icon master
logo/png/        wordmarks (320 px high) and symbols (1024 px), transparent background
web/             favicon.ico (16/32/48), icon.svg (adapts to light/dark),
                 favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png (180),
                 icon-192.png, icon-512.png, icon-maskable-512.png, site.webmanifest,
                 og-image.png (1200×630, white)
ios/             AppIcon.appiconset (1024 light / dark / tinted + Contents.json)
                 SplashWordmark.imageset (160 pt wide, light + dark appearance, @1x/2x/3x)
                 SplashBackground.colorset (white / gray-950)
android/res/     adaptive icon (white background, vector foreground, monochrome layer),
                 legacy mipmap PNGs (mdpi → xxxhdpi, square + round),
                 splash_icon.xml (follows light/dark via colour resources),
                 ic_stat_circlo.xml (notification icon),
                 values/circlo_colors.xml + values-night/circlo_colors.xml
android/play-store/  playstore-icon-512.png, feature-graphic-1024x500.png
expo/            icon.png, adaptive-icon-foreground.png, adaptive-icon-monochrome.png,
                 splash-wordmark.png, splash-wordmark-dark.png, notification-icon.png,
                 favicon.png
brand/           colors.css, colors.json
```

## 1. Website

### Next.js (App Router)
- Copy `web/favicon.ico` to `app/favicon.ico`, `web/icon.svg` to `app/icon.svg`, and
  `web/apple-touch-icon.png` to `app/apple-icon.png`. Next.js generates the `<link>` tags
  from these file names. `icon.svg` switches its colours with the browser's light/dark
  setting.
- Copy `web/og-image.png` to `app/opengraph-image.png` (and to `app/twitter-image.png` if
  you want a separate Twitter card).
- Copy `web/icon-192.png`, `web/icon-512.png` and `web/icon-maskable-512.png` to `public/`.
  Copy `web/site.webmanifest` to `app/manifest.webmanifest`; Next.js links it
  automatically.
- In the `viewport` export, set
  `themeColor: [{ media: "(prefers-color-scheme: light)", color: "#FFFFFF" }, { media: "(prefers-color-scheme: dark)", color: "#030712" }]`.
- Header and nav: show the wordmark at roughly 24–32 px tall, using
  `circlo-wordmark-color.svg` in light mode and `circlo-wordmark-on-dark.svg` in dark mode
  (or the `-auto` file inlined; see "Which file to use"). Inline the SVG or import it as a
  component, and give it an accessible name ("Circlo"). Remove any old symbol or logo next
  to it; the wordmark alone is the logo.
- Remove the old favicon and icon files so they don't override the new ones.

### Static HTML / other frameworks
Put everything from `web/` in the site root and add these tags to `<head>`:
```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FFFFFF">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#030712">
<meta property="og:image" content="/og-image.png">
```

## 2. React Native: bare workflow (`ios/` and `android/` folders exist)

### iOS
1. Replace `ios/<AppName>/Images.xcassets/AppIcon.appiconset/` with
   `ios/AppIcon.appiconset/`, removing the old PNGs first. The light icon is the dotted
   "o" on white. The dark icon (iOS 18) is a white ring with a sky-400 dot on the system's
   dark background, and there's a tinted variant too.
2. Splash: copy `ios/SplashWordmark.imageset/` and `ios/SplashBackground.colorset/` into
   the same `Images.xcassets`. In `LaunchScreen.storyboard`, set the view background to
   the `SplashBackground` named colour (white in light mode, gray-950 in dark mode), centre
   an image view using `SplashWordmark` (about 160 pt wide), and remove the old launch
   artwork, any sky background and any earlier `SplashLogo` imageset. Both assets switch
   with the system appearance automatically.
   If the project uses `react-native-bootsplash`, generate its assets from
   `logo/png/circlo-wordmark-color-h320.png` on `#FFFFFF`, plus a dark variant from
   `circlo-wordmark-on-dark-h320.png` on `#030712`, instead.
3. The 1024 light icon has no alpha channel, so App Store validation won't reject it.

### Android
1. Merge `android/res/` into `android/app/src/main/res/`, overwriting files with the same
   name, and include `values-night/`. Delete any old `mipmap-*/ic_launcher_foreground.png`
   or `.webp` files that would now clash with the vector `drawable/ic_launcher_foreground.xml`.
2. In `AndroidManifest.xml`, check that `android:icon="@mipmap/ic_launcher"` and
   `android:roundIcon="@mipmap/ic_launcher_round"` are set.
3. If `values/ic_launcher_background.xml` already defines `ic_launcher_background`, delete
   it; `values/circlo_colors.xml` now defines it (white), and a duplicate breaks the build.
   Also remove colour resources from earlier Circlo packs (`circlo_violet*`,
   `circlo_accent*`, `circlo_ink`) and point references to the new names.
4. Splash on Android 12+: in the launch theme, set `windowSplashScreenBackground` to
   `@color/splash_background` and `windowSplashScreenAnimatedIcon` to
   `@drawable/splash_icon`. Both follow dark mode through `values-night`: white
   background with a gray-900 ring and sky-500 dot, or gray-950 background with a white
   ring and sky-400 dot. Use `androidx.core:core-splashscreen` for older versions.
   Android's system splash only shows an icon, not a wordmark; that's expected.
5. Notifications: use `@drawable/ic_stat_circlo` as the small icon and
   `@color/circlo_sky_500` as the accent colour, for example as the default
   notification icon and colour meta-data in Firebase Messaging or Notifee.
6. For an in-app native logo, `@color/circlo_logo_ink` and `@color/circlo_logo_dot` switch
   automatically between light and dark.
7. Upload `android/play-store/playstore-icon-512.png` and
   `feature-graphic-1024x500.png` in the Play Console.

## 3. React Native: Expo config (`app.json` / `app.config.*`)

Copy `expo/*` to `assets/images/` (or wherever the config points), then set:
```json
{
  "expo": {
    "icon": "./assets/images/icon.png",
    "userInterfaceStyle": "automatic",
    "ios": { "icon": "./assets/images/icon.png" },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon-foreground.png",
        "monochromeImage": "./assets/images/adaptive-icon-monochrome.png",
        "backgroundColor": "#FFFFFF"
      }
    },
    "web": { "favicon": "./assets/images/favicon.png" },
    "plugins": [
      ["expo-splash-screen", {
        "image": "./assets/images/splash-wordmark.png",
        "imageWidth": 180,
        "resizeMode": "contain",
        "backgroundColor": "#FFFFFF",
        "dark": {
          "image": "./assets/images/splash-wordmark-dark.png",
          "backgroundColor": "#030712"
        }
      }],
      ["expo-notifications", {
        "icon": "./assets/images/notification-icon.png",
        "color": "#0EA5E9"
      }]
    ]
  }
}
```
Only add the `expo-notifications` entry if that plugin is already in use. Afterwards,
run `npx expo prebuild --clean` if the repo keeps generated native folders. The iOS dark
and tinted icons are in `ios/AppIcon.appiconset/`. If the Expo SDK in use supports
`ios.icon` as an object with `light` / `dark` / `tinted` keys, point those at the three
PNGs in that folder.

## 4. In-app logo and accent colour

- Top bar, sign-in screen, About page: render `circlo-wordmark-color.svg` in light mode
  and `circlo-wordmark-on-dark.svg` in dark mode (switch on `useColorScheme()`), through
  `react-native-svg` (with `react-native-svg-transformer` if SVGs are imported as
  components). If you'd rather not add SVG support, use the PNGs in `logo/png/`. Where
  only a square fits (avatar placeholder, empty states, pull-to-refresh), use
  `circlo-symbol-color` / `circlo-symbol-on-dark`.
- If the app uses an indigo or violet accent in NativeWind/Tailwind classes or theme
  tokens, switch it to sky: `sky-600` for text and links on light backgrounds,
  `sky-500` for filled buttons and highlights, and `sky-400` in dark mode (for example
  `text-sky-600 dark:text-sky-400`, `bg-sky-500 dark:bg-sky-400`).

## Checks after installing
- The web favicon, Apple touch icon and manifest load without 404s. The header shows
  the gray-900 wordmark with a sky dot in light mode, and the white wordmark with a sky
  dot in dark mode.
- iOS: a clean build shows the dotted "o" on white on the home screen, and the dark
  variant in dark mode. The launch screen is white with the dark wordmark in light mode,
  and gray-950 with the white wordmark in dark mode. There's no sky background anywhere.
- Android: the launcher icon is correct on API 26+ (adaptive and themed icons) and on
  older devices (legacy mipmaps). The splash follows the system light/dark setting.
- No old icon or logo files (Halo, Fan, plain "c", violet, sky backgrounds) are left
  behind.

Note: this pack only changes artwork and colour tokens. The app's display name, bundle
IDs and any "Halqo" text are not changed.
