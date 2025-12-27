/**
 * Shadow Design Tokens
 * Box shadows for elevation and depth effects
 */

export const shadows = {
  // Standard shadows
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',

  // Glass morphism shadows - Light theme
  glass: {
    light: {
      sm: '0 2px 8px rgba(0, 0, 0, 0.08)',
      DEFAULT: '0 4px 15px rgba(0, 0, 0, 0.1)',
      md: '0 8px 25px rgba(0, 0, 0, 0.12)',
      lg: '0 15px 35px rgba(0, 0, 0, 0.15)',
      xl: '0 20px 40px rgba(0, 0, 0, 0.18)',
      inner: 'inset 0 1px 1px rgba(255, 255, 255, 0.4)',
      glow: '0 0 40px rgba(255, 109, 31, 0.15)',
    },
    dark: {
      sm: '0 2px 8px rgba(0, 0, 0, 0.2)',
      DEFAULT: '0 4px 15px rgba(0, 0, 0, 0.25)',
      md: '0 8px 25px rgba(0, 0, 0, 0.3)',
      lg: '0 15px 35px rgba(0, 0, 0, 0.35)',
      xl: '0 20px 40px rgba(0, 0, 0, 0.4)',
      inner: 'inset 0 1px 1px rgba(255, 255, 255, 0.1)',
      glow: '0 0 40px rgba(255, 109, 31, 0.25)',
    },
  },

  // Card shadows
  card: {
    light: {
      DEFAULT: '0 4px 20px rgba(0, 0, 0, 0.08)',
      hover: '0 8px 30px rgba(0, 0, 0, 0.12)',
      active: '0 2px 10px rgba(0, 0, 0, 0.1)',
    },
    dark: {
      DEFAULT: '0 4px 20px rgba(0, 0, 0, 0.3)',
      hover: '0 8px 30px rgba(0, 0, 0, 0.4)',
      active: '0 2px 10px rgba(0, 0, 0, 0.35)',
    },
  },

  // Button shadows
  button: {
    primary: '0 4px 14px rgba(255, 109, 31, 0.4)',
    primaryHover: '0 6px 20px rgba(255, 109, 31, 0.5)',
    primaryActive: '0 2px 8px rgba(255, 109, 31, 0.4)',
    secondary: '0 2px 8px rgba(0, 0, 0, 0.08)',
    secondaryHover: '0 4px 12px rgba(0, 0, 0, 0.12)',
  },

  // Input shadows
  input: {
    focus: '0 0 0 3px rgba(255, 109, 31, 0.2)',
    error: '0 0 0 3px rgba(239, 68, 68, 0.2)',
    success: '0 0 0 3px rgba(16, 185, 129, 0.2)',
  },

  // Modal/Overlay shadows
  modal: {
    light: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    dark: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },

  // Floating elements (FAB, dropdown)
  floating: {
    light: '0 10px 40px rgba(0, 0, 0, 0.15)',
    dark: '0 10px 40px rgba(0, 0, 0, 0.4)',
  },
} as const;

// Type exports
export type ShadowToken = keyof typeof shadows;
export type GlassShadow = keyof typeof shadows.glass.light;
