/**
 * Feature Flags Module
 * Provides feature flag management for gradual rollouts and A/B testing
 *
 * Server-side usage:
 *   import { getFeatureFlags, isFeatureEnabled } from '@/lib/features';
 *
 * Client-side usage:
 *   import { useFeatureFlags, useFeatureFlag, FeatureGate } from '@/lib/features';
 */

// Types
export type { FeatureFlags, UserFeatureOverrides, FlagSource, FlagResult } from './types';
export { DEFAULT_FLAGS } from './types';

// Server-side functions
export {
  getFeatureFlags,
  getFeatureFlagsCached,
  isFeatureEnabled,
  getFeatureFlag,
  clearFeatureFlagsCache,
  getEnabledAIModels,
  isAIModelEnabled,
} from './flags';

// Client-side hooks
export {
  FeatureFlagsProvider,
  useFeatureFlags,
  useFeatureFlag,
  useIsFeatureEnabled,
  useFeatureEnabled,
  FeatureGate,
} from './hooks';
