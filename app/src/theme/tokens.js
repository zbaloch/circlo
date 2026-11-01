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
  // Letter avatars (components/avatar.tsx): one pair per person, picked from their user id. Light: Tailwind 100
  // background with a 700/800 letter; dark: 950 background with a 300 letter. Every pair is at least 4.5:1.
  avatar: {
    '1': '#FFE4E6', '1-ink': '#BE123C', '1-dark': '#4C0519', '1-ink-dark': '#FDA4AF', // rose-100/700, rose-950/300
    '2': '#FFEDD5', '2-ink': '#9A3412', '2-dark': '#431407', '2-ink-dark': '#FDBA74', // orange-100/800, orange-950/300
    '3': '#FEF3C7', '3-ink': '#92400E', '3-dark': '#451A03', '3-ink-dark': '#FCD34D', // amber-100/800, amber-950/300
    '4': '#ECFCCB', '4-ink': '#3F6212', '4-dark': '#1A2E05', '4-ink-dark': '#BEF264', // lime-100/800, lime-950/300
    '5': '#D1FAE5', '5-ink': '#047857', '5-dark': '#022C22', '5-ink-dark': '#6EE7B7', // emerald-100/700, emerald-950/300
    '6': '#CCFBF1', '6-ink': '#0F766E', '6-dark': '#042F2E', '6-ink-dark': '#5EEAD4', // teal-100/700, teal-950/300
    '7': '#CFFAFE', '7-ink': '#0E7490', '7-dark': '#083344', '7-ink-dark': '#67E8F9', // cyan-100/700, cyan-950/300
    '8': '#DBEAFE', '8-ink': '#1D4ED8', '8-dark': '#172554', '8-ink-dark': '#93C5FD', // blue-100/700, blue-950/300
    '9': '#EDE9FE', '9-ink': '#6D28D9', '9-dark': '#2E1065', '9-ink-dark': '#C4B5FD', // violet-100/700, violet-950/300
    '10': '#FAE8FF', '10-ink': '#A21CAF', '10-dark': '#4A044E', '10-ink-dark': '#F0ABFC', // fuchsia-100/700, fuchsia-950/300
  },
};

module.exports = { colors };
