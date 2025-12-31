/**
 * Datadog Configuration for LLM Observability
 *
 * This module provides centralized configuration for Datadog integration
 * including APM, logs, metrics, and LLM-specific observability.
 */

export interface DatadogConfig {
  // Core Datadog settings
  apiKey: string;
  appKey: string;
  site: string; // e.g., 'datadoghq.com', 'datadoghq.eu'
  service: string;
  env: string;
  version: string;

  // LLM Observability settings
  llm: {
    enabled: boolean;
    trackTokenUsage: boolean;
    trackCost: boolean;
    trackLatency: boolean;
    sampleRate: number; // 0-1, percentage of requests to trace
    sensitiveDataRedaction: boolean;
  };

  // APM settings
  apm: {
    enabled: boolean;
    traceEnabled: boolean;
    profileEnabled: boolean;
  };

  // RUM settings (browser)
  rum: {
    enabled: boolean;
    applicationId: string;
    clientToken: string;
    sessionSampleRate: number;
    sessionReplaySampleRate: number;
    trackUserInteractions: boolean;
    trackResources: boolean;
    trackLongTasks: boolean;
  };

  // Log settings
  logs: {
    enabled: boolean;
    forwardErrorsToLogs: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
}

// Default configuration
const defaultConfig: DatadogConfig = {
  apiKey: process.env.DD_API_KEY || '',
  appKey: process.env.DD_APP_KEY || '',
  site: process.env.DD_SITE || 'datadoghq.com',
  service: 'vox',
  env: process.env.NODE_ENV || 'development',
  version: process.env.DD_VERSION || '1.0.0',

  llm: {
    enabled: true,
    trackTokenUsage: true,
    trackCost: true,
    trackLatency: true,
    sampleRate: 1.0, // 100% in development, reduce in production
    sensitiveDataRedaction: true,
  },

  apm: {
    enabled: true,
    traceEnabled: true,
    profileEnabled: process.env.NODE_ENV === 'production',
  },

  rum: {
    enabled: process.env.NEXT_PUBLIC_DD_RUM_ENABLED === 'true',
    applicationId: process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID || '',
    clientToken: process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN || '',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 20,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
  },

  logs: {
    enabled: true,
    forwardErrorsToLogs: true,
    logLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
};

// Configuration singleton
let config: DatadogConfig = { ...defaultConfig };

/**
 * Get current Datadog configuration
 */
export function getDatadogConfig(): DatadogConfig {
  return config;
}

/**
 * Update Datadog configuration
 */
export function updateDatadogConfig(updates: Partial<DatadogConfig>): void {
  config = { ...config, ...updates };
}

/**
 * Check if Datadog is properly configured
 */
export function isDatadogConfigured(): boolean {
  return !!(config.apiKey && config.site);
}

/**
 * Check if LLM observability is enabled
 */
export function isLLMObservabilityEnabled(): boolean {
  return isDatadogConfigured() && config.llm.enabled;
}

/**
 * LLM Provider pricing per 1M tokens (USD)
 * Used for cost tracking
 */
export const LLM_PRICING = {
  // Gemini models
  'gemini-2.0-flash-001': { input: 0.075, output: 0.30 },
  'gemini-2.0-pro-001': { input: 1.25, output: 5.00 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },

  // Claude models
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },

  // OpenAI models
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },

  // DeepSeek models
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
} as const;

/**
 * Get pricing for a model
 */
export function getModelPricing(model: string): { input: number; output: number } {
  return LLM_PRICING[model as keyof typeof LLM_PRICING] || { input: 0.10, output: 0.30 };
}

export default config;
