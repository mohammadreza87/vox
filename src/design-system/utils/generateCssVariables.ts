/**
 * CSS Variable Generator Utility
 * Generates CSS custom properties from design tokens
 */

import { colors } from '../tokens/colors';
import { spacing, spacingAliases } from '../tokens/spacing';
import { typography } from '../tokens/typography';
import { shadows } from '../tokens/shadows';
import { radii, radiusAliases } from '../tokens/radii';
import { animations } from '../tokens/animations';

/**
 * Flatten nested object to dot-notation keys
 */
function flattenObject(
  obj: Record<string, unknown>,
  prefix = ''
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}-${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else if (typeof value === 'string' || typeof value === 'number') {
      result[newKey] = String(value);
    }
  }

  return result;
}

/**
 * Convert camelCase to kebab-case
 */
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Generate CSS variables for colors
 */
export function generateColorVariables(): string {
  const flattened = flattenObject(colors);
  return Object.entries(flattened)
    .map(([key, value]) => `--color-${toKebabCase(key)}: ${value};`)
    .join('\n  ');
}

/**
 * Generate CSS variables for spacing
 */
export function generateSpacingVariables(): string {
  const spacingVars = Object.entries(spacing)
    .map(([key, value]) => `--spacing-${key}: ${value};`)
    .join('\n  ');

  const aliasVars = Object.entries(spacingAliases)
    .map(([key, value]) => `--spacing-${toKebabCase(key)}: ${value};`)
    .join('\n  ');

  return `${spacingVars}\n  ${aliasVars}`;
}

/**
 * Generate CSS variables for typography
 */
export function generateTypographyVariables(): string {
  const fontFamilyVars = Object.entries(typography.fontFamily)
    .map(([key, value]) => `--font-${key}: ${value};`)
    .join('\n  ');

  const fontWeightVars = Object.entries(typography.fontWeight)
    .map(([key, value]) => `--font-weight-${key}: ${value};`)
    .join('\n  ');

  const lineHeightVars = Object.entries(typography.lineHeight)
    .map(([key, value]) => `--line-height-${key}: ${value};`)
    .join('\n  ');

  const letterSpacingVars = Object.entries(typography.letterSpacing)
    .map(([key, value]) => `--letter-spacing-${key}: ${value};`)
    .join('\n  ');

  return `${fontFamilyVars}\n  ${fontWeightVars}\n  ${lineHeightVars}\n  ${letterSpacingVars}`;
}

/**
 * Generate CSS variables for shadows
 */
export function generateShadowVariables(): string {
  const standardShadows = ['none', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', 'inner']
    .filter((key) => typeof shadows[key as keyof typeof shadows] === 'string')
    .map((key) => {
      const varName = key === 'DEFAULT' ? 'shadow' : `shadow-${key}`;
      return `--${varName}: ${shadows[key as keyof typeof shadows]};`;
    })
    .join('\n  ');

  return standardShadows;
}

/**
 * Generate CSS variables for border radii
 */
export function generateRadiiVariables(): string {
  const radiiVars = Object.entries(radii)
    .map(([key, value]) => {
      const varName = key === 'DEFAULT' ? 'radius' : `radius-${key}`;
      return `--${varName}: ${value};`;
    })
    .join('\n  ');

  const aliasVars = Object.entries(radiusAliases)
    .map(([key, value]) => `--radius-${toKebabCase(key)}: ${value};`)
    .join('\n  ');

  return `${radiiVars}\n  ${aliasVars}`;
}

/**
 * Generate CSS variables for animations
 */
export function generateAnimationVariables(): string {
  const durationVars = Object.entries(animations.duration)
    .map(([key, value]) => `--duration-${toKebabCase(key)}: ${value};`)
    .join('\n  ');

  const easingVars = Object.entries(animations.easing)
    .map(([key, value]) => `--easing-${toKebabCase(key)}: ${value};`)
    .join('\n  ');

  return `${durationVars}\n  ${easingVars}`;
}

/**
 * Generate all CSS variables as a complete CSS string
 */
export function generateAllCssVariables(): string {
  return `
:root {
  /* Colors */
  ${generateColorVariables()}

  /* Spacing */
  ${generateSpacingVariables()}

  /* Typography */
  ${generateTypographyVariables()}

  /* Shadows */
  ${generateShadowVariables()}

  /* Border Radii */
  ${generateRadiiVariables()}

  /* Animations */
  ${generateAnimationVariables()}
}
`.trim();
}

/**
 * CSS variable accessor helper
 * Usage: cssVar('color-primary') => 'var(--color-primary)'
 */
export function cssVar(name: string, fallback?: string): string {
  return fallback ? `var(--${name}, ${fallback})` : `var(--${name})`;
}

/**
 * Create a CSS variable reference for use in Tailwind classes
 * Usage: twVar('color-primary') => '[var(--color-primary)]'
 */
export function twVar(name: string): string {
  return `[var(--${name})]`;
}
