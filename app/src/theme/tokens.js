/**
 * Halqo design tokens (docs/PLAN.md section 2A): the single source for colours.
 * tailwind.config.js builds the NativeWind palette from this; navigation options that need raw values import it.
 * Our own palette: deep teal, not X's blue.
 */
const colors = {
  primary: { DEFAULT: '#0E8C7F', dark: '#2BC4B1', pressed: '#0B7368', soft: '#E3F4F2', 'soft-dark': '#0F2A28' },
  surface: { DEFAULT: '#FFFFFF', dark: '#0B0F14', raised: '#F7F9F9', 'raised-dark': '#151B22' },
  ink: { DEFAULT: '#0F1419', dark: '#E7E9EA' },
  muted: { DEFAULT: '#536471', dark: '#8B98A5' },
  border: { DEFAULT: '#E1E8ED', dark: '#2F3336' },
  danger: { DEFAULT: '#D92D20', dark: '#F97066' },
  brand: { night: '#0B3B36' },
};

module.exports = { colors };
