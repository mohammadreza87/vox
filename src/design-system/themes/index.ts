/**
 * Theme Exports
 * Central export for all theme configurations
 */

export { lightTheme } from './light';
export type { LightTheme } from './light';

export { darkTheme } from './dark';
export type { DarkTheme } from './dark';

import { lightTheme, LightTheme } from './light';
import { darkTheme, DarkTheme } from './dark';

export type Theme = 'light' | 'dark';
export type ThemeVariables = LightTheme | DarkTheme;

export const themes = {
  light: lightTheme,
  dark: darkTheme,
} as const;

/**
 * Get theme variables by theme name
 */
export function getThemeVariables(theme: Theme): ThemeVariables {
  return themes[theme];
}

/**
 * Generate CSS string from theme variables
 */
export function generateThemeCss(theme: Theme): string {
  const variables = getThemeVariables(theme);
  return Object.entries(variables)
    .map(([key, value]) => `${key}: ${value};`)
    .join('\n  ');
}
