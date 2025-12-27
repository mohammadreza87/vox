/**
 * Color Design Tokens
 * Central source of truth for all colors in the Vox application
 */

export const colors = {
  // Brand Colors
  primary: {
    DEFAULT: '#FF6D1F',
    light: '#ff8a4c',
    dark: '#e5621b',
    50: '#fff7ed',
    100: '#ffedd5',
    200: '#fed7aa',
    300: '#fdba74',
    400: '#fb923c',
    500: '#FF6D1F',
    600: '#ea580c',
    700: '#c2410c',
    800: '#9a3412',
    900: '#7c2d12',
  },

  // Neutral / Background Colors
  neutral: {
    cream: '#FAF3E1',
    beige: '#F5E7C6',
    sand: '#ffe4c4',
    white: '#FFFFFF',
    gray: {
      50: '#f9fafb',
      100: '#f3f4f6',
      200: '#e5e7eb',
      300: '#d1d5db',
      400: '#9ca3af',
      500: '#6b7280',
      600: '#4b5563',
      700: '#374151',
      800: '#1f2937',
      900: '#111827',
    },
    dark: '#222222',
    darker: '#1a1a1a',
    darkest: '#111111',
  },

  // Semantic Colors
  semantic: {
    success: {
      DEFAULT: '#10b981',
      light: '#34d399',
      dark: '#059669',
      bg: 'rgba(16, 185, 129, 0.1)',
    },
    error: {
      DEFAULT: '#ef4444',
      light: '#f87171',
      dark: '#dc2626',
      bg: 'rgba(239, 68, 68, 0.1)',
    },
    warning: {
      DEFAULT: '#f59e0b',
      light: '#fbbf24',
      dark: '#d97706',
      bg: 'rgba(245, 158, 11, 0.1)',
    },
    info: {
      DEFAULT: '#3b82f6',
      light: '#60a5fa',
      dark: '#2563eb',
      bg: 'rgba(59, 130, 246, 0.1)',
    },
  },

  // Glass Effect Colors - Light Theme
  glass: {
    light: {
      bg: 'rgba(255, 255, 255, 0.7)',
      bgSubtle: 'rgba(255, 255, 255, 0.5)',
      bgStrong: 'rgba(255, 255, 255, 0.85)',
      border: 'rgba(255, 255, 255, 0.3)',
      borderStrong: 'rgba(255, 255, 255, 0.5)',
      shadow: 'rgba(0, 0, 0, 0.1)',
      shadowStrong: 'rgba(0, 0, 0, 0.15)',
    },
    dark: {
      bg: 'rgba(30, 30, 30, 0.7)',
      bgSubtle: 'rgba(30, 30, 30, 0.5)',
      bgStrong: 'rgba(30, 30, 30, 0.85)',
      border: 'rgba(255, 255, 255, 0.1)',
      borderStrong: 'rgba(255, 255, 255, 0.2)',
      shadow: 'rgba(0, 0, 0, 0.3)',
      shadowStrong: 'rgba(0, 0, 0, 0.4)',
    },
  },

  // Gradient Backgrounds
  gradient: {
    light: {
      start: '#FAF3E1',
      mid: '#F5E7C6',
      end: '#ffe4c4',
    },
    dark: {
      start: '#1a1a1a',
      mid: '#2d2d2d',
      end: '#3d3d3d',
    },
  },

  // Message Bubble Colors
  message: {
    sent: {
      bg: 'linear-gradient(135deg, #FF6D1F 0%, #ff8a4c 100%)',
      text: '#FFFFFF',
    },
    received: {
      light: {
        bg: 'rgba(255, 255, 255, 0.8)',
        text: '#222222',
      },
      dark: {
        bg: 'rgba(50, 50, 50, 0.8)',
        text: '#FAF3E1',
      },
    },
  },

  // Text Colors
  text: {
    light: {
      primary: '#222222',
      secondary: 'rgba(34, 34, 34, 0.7)',
      tertiary: 'rgba(34, 34, 34, 0.5)',
      disabled: 'rgba(34, 34, 34, 0.3)',
    },
    dark: {
      primary: '#FAF3E1',
      secondary: 'rgba(250, 243, 225, 0.7)',
      tertiary: 'rgba(250, 243, 225, 0.5)',
      disabled: 'rgba(250, 243, 225, 0.3)',
    },
  },

  // Overlay Colors
  overlay: {
    light: 'rgba(0, 0, 0, 0.5)',
    dark: 'rgba(0, 0, 0, 0.7)',
    blur: 'rgba(0, 0, 0, 0.3)',
  },
} as const;

// Type exports for TypeScript support
export type ColorToken = typeof colors;
export type PrimaryColor = keyof typeof colors.primary;
export type SemanticColor = keyof typeof colors.semantic;
