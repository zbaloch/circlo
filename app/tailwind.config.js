const { colors } = require('./src/theme/tokens');

/**
 * NativeWind palette from src/theme/tokens.js (docs/PLAN.md section 2A).
 * Every token has a `dark` variant; use them as `bg-surface dark:bg-surface-dark`.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 'class', not 'media': NativeWind's web runtime throws on 'media'. Phones still follow the OS theme;
  // on web src/theme/color-scheme.web.ts sets the class from the OS setting.
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      // Inter, bundled with the app; components/ui/text.tsx maps font-weight classes to these families.
      fontFamily: {
        sans: ['Inter_400Regular'],
        'sans-medium': ['Inter_500Medium'],
        'sans-semibold': ['Inter_600SemiBold'],
        'sans-bold': ['Inter_700Bold'],
        'sans-extrabold': ['Inter_800ExtraBold'],
        // Arabic-script text (lib/script): Lateef for Sindhi, Naskh for Arabic, Nastaliq for Urdu and Persian. Bundled.
        lateef: ['Lateef_400Regular'],
        'lateef-medium': ['Lateef_500Medium'],
        'lateef-semibold': ['Lateef_600SemiBold'],
        'lateef-bold': ['Lateef_700Bold'],
        'lateef-extrabold': ['Lateef_800ExtraBold'],
        naskh: ['NotoNaskhArabic_400Regular'],
        'naskh-medium': ['NotoNaskhArabic_500Medium'],
        'naskh-semibold': ['NotoNaskhArabic_600SemiBold'],
        'naskh-bold': ['NotoNaskhArabic_700Bold'],
        nastaliq: ['NotoNastaliqUrdu_400Regular'],
        'nastaliq-medium': ['NotoNastaliqUrdu_500Medium'],
        'nastaliq-semibold': ['NotoNastaliqUrdu_600SemiBold'],
        'nastaliq-bold': ['NotoNastaliqUrdu_700Bold'],
      },
    },
  },
  plugins: [],
};
