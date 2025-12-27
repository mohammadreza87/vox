/**
 * Light Theme Configuration
 * Maps design tokens to CSS variable values for light mode
 */

import { colors } from '../tokens/colors';
import { shadows } from '../tokens/shadows';

export const lightTheme = {
  // Core colors
  '--color-primary': colors.primary.DEFAULT,
  '--color-primary-light': colors.primary.light,
  '--color-primary-dark': colors.primary.dark,

  // Background colors
  '--color-background': 'transparent',
  '--color-background-primary': colors.neutral.cream,
  '--color-background-secondary': colors.neutral.beige,
  '--color-background-tertiary': colors.neutral.sand,

  // Gradient
  '--gradient-start': colors.gradient.light.start,
  '--gradient-mid': colors.gradient.light.mid,
  '--gradient-end': colors.gradient.light.end,

  // Text colors
  '--color-foreground': colors.text.light.primary,
  '--color-text-primary': colors.text.light.primary,
  '--color-text-secondary': colors.text.light.secondary,
  '--color-text-tertiary': colors.text.light.tertiary,
  '--color-text-disabled': colors.text.light.disabled,

  // Neutral colors
  '--color-cream': colors.neutral.cream,
  '--color-beige': colors.neutral.beige,
  '--color-dark': colors.neutral.dark,

  // Glass morphism
  '--glass-bg': colors.glass.light.bg,
  '--glass-bg-subtle': colors.glass.light.bgSubtle,
  '--glass-bg-strong': colors.glass.light.bgStrong,
  '--glass-border': colors.glass.light.border,
  '--glass-border-strong': colors.glass.light.borderStrong,
  '--glass-shadow': colors.glass.light.shadow,
  '--glass-shadow-strong': colors.glass.light.shadowStrong,

  // Shadows
  '--shadow-sm': shadows.glass.light.sm,
  '--shadow-default': shadows.glass.light.DEFAULT,
  '--shadow-md': shadows.glass.light.md,
  '--shadow-lg': shadows.glass.light.lg,
  '--shadow-xl': shadows.glass.light.xl,
  '--shadow-inner': shadows.glass.light.inner,
  '--shadow-glow': shadows.glass.light.glow,

  // Card shadows
  '--shadow-card': shadows.card.light.DEFAULT,
  '--shadow-card-hover': shadows.card.light.hover,
  '--shadow-card-active': shadows.card.light.active,

  // Button shadows
  '--shadow-button-primary': shadows.button.primary,
  '--shadow-button-primary-hover': shadows.button.primaryHover,
  '--shadow-button-primary-active': shadows.button.primaryActive,
  '--shadow-button-secondary': shadows.button.secondary,
  '--shadow-button-secondary-hover': shadows.button.secondaryHover,

  // Input shadows
  '--shadow-input-focus': shadows.input.focus,
  '--shadow-input-error': shadows.input.error,
  '--shadow-input-success': shadows.input.success,

  // Modal & floating
  '--shadow-modal': shadows.modal.light,
  '--shadow-floating': shadows.floating.light,

  // Message bubbles
  '--msg-sent-bg': colors.message.sent.bg,
  '--msg-sent-text': colors.message.sent.text,
  '--msg-received-bg': colors.message.received.light.bg,
  '--msg-received-text': colors.message.received.light.text,

  // Semantic colors
  '--color-success': colors.semantic.success.DEFAULT,
  '--color-success-light': colors.semantic.success.light,
  '--color-success-dark': colors.semantic.success.dark,
  '--color-success-bg': colors.semantic.success.bg,

  '--color-error': colors.semantic.error.DEFAULT,
  '--color-error-light': colors.semantic.error.light,
  '--color-error-dark': colors.semantic.error.dark,
  '--color-error-bg': colors.semantic.error.bg,

  '--color-warning': colors.semantic.warning.DEFAULT,
  '--color-warning-light': colors.semantic.warning.light,
  '--color-warning-dark': colors.semantic.warning.dark,
  '--color-warning-bg': colors.semantic.warning.bg,

  '--color-info': colors.semantic.info.DEFAULT,
  '--color-info-light': colors.semantic.info.light,
  '--color-info-dark': colors.semantic.info.dark,
  '--color-info-bg': colors.semantic.info.bg,

  // Overlay
  '--color-overlay': colors.overlay.light,
  '--color-overlay-blur': colors.overlay.blur,
} as const;

export type LightTheme = typeof lightTheme;
