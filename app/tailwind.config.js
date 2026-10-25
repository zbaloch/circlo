const { colors } = require('./src/theme/tokens');

/**
 * NativeWind palette from src/theme/tokens.js (docs/PLAN.md section 2A).
 * Every token has a `dark` variant; use them as `bg-surface dark:bg-surface-dark`.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'media',
  theme: {
    extend: { colors },
  },
  plugins: [],
};
