/**
 * Feature Flags Types
 * Defines all available feature flags and their configuration
 */

/**
 * All available feature flags
 */
export interface FeatureFlags {
  // AI Features
  enableDeepSeekModel: boolean;
  enableClaudeModel: boolean;
  enableGeminiModel: boolean;
  enableLlamaModel: boolean;

  // Voice Features
  enableVoiceCloning: boolean;
  enableLiveTranslation: boolean;

  // UI Features
  enableNewChatUI: boolean;
  enableDarkMode: boolean;

  // Payment Features
  enableTelegramPayments: boolean;
  enableStripePayments: boolean;

  // Limits
  maxMessagesPerDay: number;
  maxVoiceClonesPerUser: number;
  maxChatsPerUser: number;

  // Debug
  enableDebugMode: boolean;
  enablePerformanceMetrics: boolean;
}

/**
 * Default feature flag values
 */
export const DEFAULT_FLAGS: FeatureFlags = {
  // AI Features - enabled by default
  enableDeepSeekModel: true,
  enableClaudeModel: true,
  enableGeminiModel: true,
  enableLlamaModel: true,

  // Voice Features - enabled by default
  enableVoiceCloning: true,
  enableLiveTranslation: true,

  // UI Features
  enableNewChatUI: false,
  enableDarkMode: true,

  // Payment Features
  enableTelegramPayments: false,
  enableStripePayments: true,

  // Limits
  maxMessagesPerDay: 100,
  maxVoiceClonesPerUser: 5,
  maxChatsPerUser: 50,

  // Debug - disabled by default in production
  enableDebugMode: false,
  enablePerformanceMetrics: false,
};

/**
 * User-specific feature flag overrides
 */
export interface UserFeatureOverrides {
  userId: string;
  flags: Partial<FeatureFlags>;
}

/**
 * Feature flag source
 */
export type FlagSource = 'default' | 'env' | 'edge-config' | 'user-override';

/**
 * Feature flag result with metadata
 */
export interface FlagResult<T> {
  value: T;
  source: FlagSource;
}
