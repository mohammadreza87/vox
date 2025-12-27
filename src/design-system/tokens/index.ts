/**
 * Design System Tokens - Central Export
 * Import all design tokens from this file
 */

export { colors } from './colors';
export type { ColorToken, PrimaryColor, SemanticColor } from './colors';

export { spacing, spacingAliases } from './spacing';
export type { SpacingToken, SpacingAlias } from './spacing';

export { typography, textStyles } from './typography';
export type { FontSize, FontWeight, TextStyle } from './typography';

export { shadows } from './shadows';
export type { ShadowToken, GlassShadow } from './shadows';

export { radii, radiusAliases } from './radii';
export type { RadiusToken, RadiusAlias } from './radii';

export { animations } from './animations';
export type { DurationToken, EasingToken, TransitionPreset } from './animations';

// Unified tokens object for convenience
import { colors } from './colors';
import { spacing, spacingAliases } from './spacing';
import { typography, textStyles } from './typography';
import { shadows } from './shadows';
import { radii, radiusAliases } from './radii';
import { animations } from './animations';

export const tokens = {
  colors,
  spacing,
  spacingAliases,
  typography,
  textStyles,
  shadows,
  radii,
  radiusAliases,
  animations,
} as const;

export type Tokens = typeof tokens;
