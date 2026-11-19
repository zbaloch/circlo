type Shade = Record<string, string>;

export declare const colors: {
  primary: Shade & { DEFAULT: string; dark: string };
  'on-primary': Shade & { DEFAULT: string; dark: string };
  surface: Shade & { DEFAULT: string; dark: string };
  ink: Shade & { DEFAULT: string; dark: string };
  muted: Shade & { DEFAULT: string; dark: string };
  border: Shade & { DEFAULT: string; dark: string };
  danger: Shade & { DEFAULT: string; dark: string };
  brand: { ink: string; accent: string; 'accent-dark': string };
};

type Neutrals = { surface: string; 'surface-raised': string; ink: string; muted: string; border: string };

/** The neutrals of the two dark themes (Settings → Display). */
export declare const darkNeutrals: { dark: Neutrals; dim: Neutrals };

/** CSS variables for one dark theme's neutrals, e.g. `{ '--circlo-surface-dark': '#15202B' }`. */
export declare function neutralVars(theme: 'dark' | 'dim'): Record<string, string>;
