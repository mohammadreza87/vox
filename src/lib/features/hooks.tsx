'use client';

/**
 * Feature Flags React Hooks
 * Provides hooks for using feature flags in React components
 *
 * Usage:
 *   import { useFeatureFlags, useFeatureFlag } from '@/lib/features';
 *
 *   function MyComponent() {
 *     const { enableVoiceCloning } = useFeatureFlags();
 *     const isEnabled = useFeatureFlag('enableNewChatUI');
 *
 *     if (!enableVoiceCloning) return null;
 *     return <VoiceCloneButton />;
 *   }
 */

import { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { FeatureFlags, DEFAULT_FLAGS } from './types';

// Context for feature flags
const FeatureFlagsContext = createContext<FeatureFlags>(DEFAULT_FLAGS);

interface FeatureFlagsProviderProps {
  children: ReactNode;
  initialFlags?: Partial<FeatureFlags>;
}

/**
 * Feature Flags Provider
 * Wraps the app to provide feature flags to all components
 */
export function FeatureFlagsProvider({
  children,
  initialFlags,
}: FeatureFlagsProviderProps) {
  const [flags, setFlags] = useState<FeatureFlags>({
    ...DEFAULT_FLAGS,
    ...initialFlags,
  });

  // Fetch flags from API on mount if not provided
  useEffect(() => {
    if (!initialFlags) {
      fetch('/api/features')
        .then((res) => res.json())
        .then((data) => {
          if (data.flags) {
            setFlags((prev) => ({ ...prev, ...data.flags }));
          }
        })
        .catch(() => {
          // Use defaults on error
          console.warn('Failed to fetch feature flags, using defaults');
        });
    }
  }, [initialFlags]);

  return (
    <FeatureFlagsContext.Provider value={flags}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

/**
 * Get all feature flags
 */
export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagsContext);
}

/**
 * Get a specific feature flag value
 */
export function useFeatureFlag<K extends keyof FeatureFlags>(
  flagName: K
): FeatureFlags[K] {
  const flags = useFeatureFlags();
  return flags[flagName];
}

/**
 * Check if a feature is enabled
 * Works for both boolean flags and numeric limits (> 0 means enabled)
 */
export function useIsFeatureEnabled(flagName: keyof FeatureFlags): boolean {
  const value = useFeatureFlag(flagName);
  return typeof value === 'boolean' ? value : value > 0;
}

/**
 * Conditionally render children based on feature flag
 */
interface FeatureGateProps {
  flag: keyof FeatureFlags;
  children: ReactNode;
  fallback?: ReactNode;
}

export function FeatureGate({ flag, children, fallback = null }: FeatureGateProps) {
  const isEnabled = useIsFeatureEnabled(flag);
  return isEnabled ? <>{children}</> : <>{fallback}</>;
}

/**
 * Hook for checking multiple features at once
 */
export function useFeatureEnabled(
  ...flags: (keyof FeatureFlags)[]
): Record<string, boolean> {
  const allFlags = useFeatureFlags();

  return flags.reduce((acc, flag) => {
    const value = allFlags[flag];
    acc[flag] = typeof value === 'boolean' ? value : value > 0;
    return acc;
  }, {} as Record<string, boolean>);
}
