/**
 * Dark Theme Configuration
 * Maps design tokens to CSS variable values for dark mode
 */

import { colors } from '../tokens/colors';
import { shadows } from '../tokens/shadows';

export const darkTheme = {
  // Core colors
  '--color-primary': colors.primary.DEFAULT,
  '--color-primary-light': colors.primary.light,
  '--color-primary-dark': colors.primary.dark,

  // Background colors
  '--color-background': 'transparent',
  '--color-background-primary': colors.neutral.darker,
  '--color-background-secondary': colors.neutral.dark,
  '--color-background-tertiary': colors.neutral.gray[800],

  // Gradient
  '--gradient-start': colors.gradient.dark.start,
  '--gradient-mid': colors.gradient.dark.mid,
  '--gradient-end': colors.gradient.dark.end,

  // Text colors
  '--color-foreground': colors.text.dark.primary,
  '--color-text-primary': colors.text.dark.primary,
  '--color-text-secondary': colors.text.dark.secondary,
  '--color-text-tertiary': colors.text.dark.tertiary,
  '--color-text-disabled': colors.text.dark.disabled,

  // Neutral colors (inverted for dark mode)
  '--color-cream': colors.neutral.dark,
  '--color-beige': colors.neutral.gray[800],
  '--color-dark': colors.neutral.cream,

  // Glass morphism
  '--glass-bg': colors.glass.dark.bg,
  '--glass-bg-subtle': colors.glass.dark.bgSubtle,
  '--glass-bg-strong': colors.glass.dark.bgStrong,
  '--glass-border': colors.glass.dark.border,
  '--glass-border-strong': colors.glass.dark.borderStrong,
  '--glass-shadow': colors.glass.dark.shadow,
  '--glass-shadow-strong': colors.glass.dark.shadowStrong,

  // Shadows
  '--shadow-sm': shadows.glass.dark.sm,
  '--shadow-default': shadows.glass.dark.DEFAULT,
  '--shadow-md': shadows.glass.dark.md,
  '--shadow-lg': shadows.glass.dark.lg,
  '--shadow-xl': shadows.glass.dark.xl,
  '--shadow-inner': shadows.glass.dark.inner,
  '--shadow-glow': shadows.glass.dark.glow,

  // Card shadows
  '--shadow-card': shadows.card.dark.DEFAULT,
  '--shadow-card-hover': shadows.card.dark.hover,
  '--shadow-card-active': shadows.card.dark.active,

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
  '--shadow-modal': shadows.modal.dark,
  '--shadow-floating': shadows.floating.dark,

  // Message bubbles
  '--msg-sent-bg': colors.message.sent.bg,
  '--msg-sent-text': colors.message.sent.text,
  '--msg-received-bg': colors.message.received.dark.bg,
  '--msg-received-text': colors.message.received.dark.text,

  // Semantic colors (same as light - they work in both themes)
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
  '--color-overlay': colors.overlay.dark,
  '--color-overlay-blur': colors.overlay.blur,
} as const;

export type DarkTheme = typeof darkTheme;
