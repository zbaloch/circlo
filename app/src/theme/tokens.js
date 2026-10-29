/**
 * Circlo design tokens (docs/PLAN.md section 2A): the single source for colours.
 * tailwind.config.js builds the NativeWind palette from this; navigation options that need raw values import it.
 * Primary is Tailwind sky, per the wordmark brand pack (brand/colors.json):
 * - light: sky-600 for buttons, links and accent text (white text on it is 4.1:1; sky-500 would be 2.8:1)
 * - dark: sky-400 (8.5:1 on ink), with dark sky-950 text on it, since white on sky-400 is only 2.1:1
 */
const colors = {
  primary: {
    DEFAULT: '#0284C7', // sky-600
    dark: '#38BDF8', // sky-400
    pressed: '#0369A1', // sky-700
    'pressed-dark': '#7DD3FC', // sky-300
    soft: '#E0F2FE', // sky-100
    'soft-dark': '#082F49', // sky-950
  },
  // Text and icons drawn on a primary background.
  'on-primary': { DEFAULT: '#FFFFFF', dark: '#082F49' },
  surface: { DEFAULT: '#FFFFFF', dark: '#0B0F14', raised: '#F7F9F9', 'raised-dark': '#151B22' },
  ink: { DEFAULT: '#0F1419', dark: '#E7E9EA' },
  muted: { DEFAULT: '#536471', dark: '#8B98A5' },
  border: { DEFAULT: '#E1E8ED', dark: '#2F3336' },
  danger: { DEFAULT: '#D92D20', dark: '#F97066' },
  // Logo colours (brand pack): gray-900 letters and ring with a sky-500 dot on light; white with a sky-400 dot on
  // dark. Icons and splash sit on white, or gray-950 in dark mode; sky is never a background.
  brand: { ink: '#101828', accent: '#0EA5E9', 'accent-dark': '#38BDF8', background: '#FFFFFF', 'background-dark': '#030712' },
};

module.exports = { colors };
