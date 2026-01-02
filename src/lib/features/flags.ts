/**
 * Feature Flags Service
 * Provides feature flag values from environment variables or edge config
 *
 * Usage:
 *   import { getFeatureFlags, isFeatureEnabled } from '@/lib/features';
 *
 *   const flags = await getFeatureFlags();
 *   if (flags.enableVoiceCloning) { ... }
 *
 *   // Or check a single flag
 *   if (await isFeatureEnabled('enableVoiceCloning')) { ... }
 */

import { FeatureFlags, DEFAULT_FLAGS, FlagSource } from './types';
import { cacheGetOrSet, CACHE_TTL } from '@/lib/cache';

// Environment variable prefix for feature flags
const ENV_PREFIX = 'FEATURE_';

// Cache key for flags
const FLAGS_CACHE_KEY = 'feature_flags:global';

/**
 * Parse a feature flag value from environment variable
 */
function parseEnvValue(value: string | undefined, defaultValue: boolean | number): boolean | number {
  if (value === undefined) return defaultValue;

  // Handle boolean values
  if (typeof defaultValue === 'boolean') {
    return value.toLowerCase() === 'true' || value === '1';
  }

  // Handle numeric values
  if (typeof defaultValue === 'number') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  return defaultValue;
}

/**
 * Convert feature flag name to environment variable name
 * e.g., 'enableVoiceCloning' -> 'FEATURE_ENABLE_VOICE_CLONING'
 */
function toEnvName(flagName: string): string {
  return ENV_PREFIX + flagName.replace(/([A-Z])/g, '_$1').toUpperCase();
}

/**
 * Load feature flags from environment variables
 */
function loadFromEnv(): Partial<FeatureFlags> {
  const flags: Partial<FeatureFlags> = {};

  for (const [key, defaultValue] of Object.entries(DEFAULT_FLAGS)) {
    const envName = toEnvName(key);
    const envValue = process.env[envName];

    if (envValue !== undefined) {
      // @ts-expect-error - dynamic key assignment
      flags[key] = parseEnvValue(envValue, defaultValue);
    }
  }

  return flags;
}

/**
 * Cached flag values (server-side)
 * Avoids re-reading environment variables on every request
 */
let cachedFlags: FeatureFlags | null = null;

/**
 * Get all feature flags
 * Merges defaults with environment overrides
 */
export async function getFeatureFlags(userId?: string): Promise<FeatureFlags> {
  // Use cached values if available (for same process)
  if (cachedFlags && !userId) {
    return cachedFlags;
  }

  // Start with defaults
  let flags: FeatureFlags = { ...DEFAULT_FLAGS };

  // Apply environment variable overrides
  const envFlags = loadFromEnv();
  flags = { ...flags, ...envFlags };

  // Apply development mode defaults
  if (process.env.NODE_ENV === 'development') {
    flags.enableDebugMode = flags.enableDebugMode || true;
    flags.enablePerformanceMetrics = flags.enablePerformanceMetrics || true;
  }

  // TODO: If userId provided, fetch user-specific overrides from database
  // This allows A/B testing or beta features for specific users

  // Cache for subsequent calls
  if (!userId) {
    cachedFlags = flags;
  }

  return flags;
}

/**
 * Check if a specific feature is enabled
 */
export async function isFeatureEnabled(
  flagName: keyof FeatureFlags,
  userId?: string
): Promise<boolean> {
  const flags = await getFeatureFlags(userId);
  const value = flags[flagName];
  return typeof value === 'boolean' ? value : value > 0;
}

/**
 * Get a specific feature flag value
 */
export async function getFeatureFlag<K extends keyof FeatureFlags>(
  flagName: K,
  userId?: string
): Promise<FeatureFlags[K]> {
  const flags = await getFeatureFlags(userId);
  return flags[flagName];
}

/**
 * Get feature flags with caching (for API routes)
 * Uses Redis cache if available, otherwise returns directly
 */
export async function getFeatureFlagsCached(userId?: string): Promise<FeatureFlags> {
  const cacheKey = userId ? `feature_flags:${userId}` : FLAGS_CACHE_KEY;

  return cacheGetOrSet(
    cacheKey,
    () => getFeatureFlags(userId),
    CACHE_TTL.MEDIUM // 5 minutes
  );
}

/**
 * Clear cached feature flags (useful after admin updates)
 */
export function clearFeatureFlagsCache(): void {
  cachedFlags = null;
}

/**
 * Get available AI models based on feature flags
 */
export async function getEnabledAIModels(): Promise<string[]> {
  const flags = await getFeatureFlags();
  const models: string[] = [];

  // Always include OpenAI models as base
  models.push('gpt-4o', 'gpt-4o-mini');

  if (flags.enableDeepSeekModel) {
    models.push('deepseek-chat', 'deepseek-reasoner');
  }

  if (flags.enableClaudeModel) {
    models.push('claude-3-5-sonnet', 'claude-3-5-haiku');
  }

  if (flags.enableGeminiModel) {
    models.push('gemini-2.0-flash', 'gemini-2.0-flash-thinking');
  }

  if (flags.enableLlamaModel) {
    models.push('llama-3.3-70b');
  }

  return models;
}

/**
 * Check if a specific AI model is enabled
 */
export async function isAIModelEnabled(modelId: string): Promise<boolean> {
  const enabledModels = await getEnabledAIModels();
  return enabledModels.includes(modelId);
}
