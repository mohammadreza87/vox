/**
 * Typography Design Tokens
 * Font families, sizes, weights, and line heights
 */

export const typography = {
  // Font Families
  fontFamily: {
    sans: 'var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },

  // Font Sizes (with line heights)
  fontSize: {
    xs: ['0.75rem', { lineHeight: '1rem' }],        // 12px
    sm: ['0.875rem', { lineHeight: '1.25rem' }],    // 14px
    base: ['1rem', { lineHeight: '1.5rem' }],       // 16px
    lg: ['1.125rem', { lineHeight: '1.75rem' }],    // 18px
    xl: ['1.25rem', { lineHeight: '1.75rem' }],     // 20px
    '2xl': ['1.5rem', { lineHeight: '2rem' }],      // 24px
    '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 30px
    '4xl': ['2.25rem', { lineHeight: '2.5rem' }],   // 36px
    '5xl': ['3rem', { lineHeight: '1' }],           // 48px
    '6xl': ['3.75rem', { lineHeight: '1' }],        // 60px
    '7xl': ['4.5rem', { lineHeight: '1' }],         // 72px
  },

  // Font Weights
  fontWeight: {
    thin: '100',
    extralight: '200',
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
    black: '900',
  },

  // Line Heights
  lineHeight: {
    none: '1',
    tight: '1.25',
    snug: '1.375',
    normal: '1.5',
    relaxed: '1.625',
    loose: '2',
  },

  // Letter Spacing
  letterSpacing: {
    tighter: '-0.05em',
    tight: '-0.025em',
    normal: '0',
    wide: '0.025em',
    wider: '0.05em',
    widest: '0.1em',
  },
} as const;

// Semantic typography presets
export const textStyles = {
  // Headings
  h1: {
    fontSize: typography.fontSize['4xl'][0],
    lineHeight: typography.fontSize['4xl'][1].lineHeight,
    fontWeight: typography.fontWeight.bold,
    letterSpacing: typography.letterSpacing.tight,
  },
  h2: {
    fontSize: typography.fontSize['3xl'][0],
    lineHeight: typography.fontSize['3xl'][1].lineHeight,
    fontWeight: typography.fontWeight.bold,
    letterSpacing: typography.letterSpacing.tight,
  },
  h3: {
    fontSize: typography.fontSize['2xl'][0],
    lineHeight: typography.fontSize['2xl'][1].lineHeight,
    fontWeight: typography.fontWeight.semibold,
  },
  h4: {
    fontSize: typography.fontSize.xl[0],
    lineHeight: typography.fontSize.xl[1].lineHeight,
    fontWeight: typography.fontWeight.semibold,
  },
  h5: {
    fontSize: typography.fontSize.lg[0],
    lineHeight: typography.fontSize.lg[1].lineHeight,
    fontWeight: typography.fontWeight.medium,
  },
  h6: {
    fontSize: typography.fontSize.base[0],
    lineHeight: typography.fontSize.base[1].lineHeight,
    fontWeight: typography.fontWeight.medium,
  },

  // Body text
  bodyLarge: {
    fontSize: typography.fontSize.lg[0],
    lineHeight: typography.fontSize.lg[1].lineHeight,
    fontWeight: typography.fontWeight.normal,
  },
  body: {
    fontSize: typography.fontSize.base[0],
    lineHeight: typography.fontSize.base[1].lineHeight,
    fontWeight: typography.fontWeight.normal,
  },
  bodySmall: {
    fontSize: typography.fontSize.sm[0],
    lineHeight: typography.fontSize.sm[1].lineHeight,
    fontWeight: typography.fontWeight.normal,
  },

  // Labels and captions
  label: {
    fontSize: typography.fontSize.sm[0],
    lineHeight: typography.fontSize.sm[1].lineHeight,
    fontWeight: typography.fontWeight.medium,
  },
  caption: {
    fontSize: typography.fontSize.xs[0],
    lineHeight: typography.fontSize.xs[1].lineHeight,
    fontWeight: typography.fontWeight.normal,
  },

  // Special text
  button: {
    fontSize: typography.fontSize.sm[0],
    lineHeight: typography.fontSize.sm[1].lineHeight,
    fontWeight: typography.fontWeight.medium,
  },
  buttonLarge: {
    fontSize: typography.fontSize.base[0],
    lineHeight: typography.fontSize.base[1].lineHeight,
    fontWeight: typography.fontWeight.medium,
  },
  code: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.sm[0],
  },
} as const;

// Type exports
export type FontSize = keyof typeof typography.fontSize;
export type FontWeight = keyof typeof typography.fontWeight;
export type TextStyle = keyof typeof textStyles;
