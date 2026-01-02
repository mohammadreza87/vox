import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getFeatureFlags,
  isFeatureEnabled,
  getFeatureFlag,
  clearFeatureFlagsCache,
  getEnabledAIModels,
  isAIModelEnabled,
} from '../flags';
import { DEFAULT_FLAGS } from '../types';

// Mock the cache module
vi.mock('@/lib/cache', () => ({
  cacheGetOrSet: vi.fn(async (key, fn) => fn()),
  CACHE_TTL: { MEDIUM: 300 },
}));

describe('Feature Flags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    // Clear cached flags
    clearFeatureFlagsCache();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getFeatureFlags', () => {
    it('returns default flags when no environment variables set', async () => {
      const flags = await getFeatureFlags();
      expect(flags).toEqual(expect.objectContaining(DEFAULT_FLAGS));
    });

    it('overrides defaults with environment variables', async () => {
      process.env.FEATURE_ENABLE_VOICE_CLONING = 'false';
      process.env.FEATURE_MAX_MESSAGES_PER_DAY = '50';

      clearFeatureFlagsCache();
      const flags = await getFeatureFlags();

      expect(flags.enableVoiceCloning).toBe(false);
      expect(flags.maxMessagesPerDay).toBe(50);
    });

    it('handles boolean environment variables correctly', async () => {
      process.env.FEATURE_ENABLE_DEBUG_MODE = 'true';
      process.env.FEATURE_ENABLE_NEW_CHAT_U_I = 'false';

      clearFeatureFlagsCache();
      const flags = await getFeatureFlags();

      expect(flags.enableDebugMode).toBe(true);
      expect(flags.enableNewChatUI).toBe(false);
    });

    it('handles numeric environment variables correctly', async () => {
      process.env.FEATURE_MAX_VOICE_CLONES_PER_USER = '10';
      process.env.FEATURE_MAX_CHATS_PER_USER = '100';

      clearFeatureFlagsCache();
      const flags = await getFeatureFlags();

      expect(flags.maxVoiceClonesPerUser).toBe(10);
      expect(flags.maxChatsPerUser).toBe(100);
    });

    it('returns default for invalid numeric values', async () => {
      process.env.FEATURE_MAX_MESSAGES_PER_DAY = 'not-a-number';

      clearFeatureFlagsCache();
      const flags = await getFeatureFlags();

      expect(flags.maxMessagesPerDay).toBe(DEFAULT_FLAGS.maxMessagesPerDay);
    });

    it('caches flags for subsequent calls', async () => {
      const flags1 = await getFeatureFlags();

      // Modify env after first call
      process.env.FEATURE_ENABLE_VOICE_CLONING = 'false';

      const flags2 = await getFeatureFlags();

      // Should return cached value
      expect(flags2.enableVoiceCloning).toBe(flags1.enableVoiceCloning);
    });

    it('returns fresh flags after cache cleared', async () => {
      await getFeatureFlags();

      process.env.FEATURE_ENABLE_VOICE_CLONING = 'false';
      clearFeatureFlagsCache();

      const flags = await getFeatureFlags();
      expect(flags.enableVoiceCloning).toBe(false);
    });
  });

  describe('isFeatureEnabled', () => {
    it('returns true for enabled boolean feature', async () => {
      const result = await isFeatureEnabled('enableVoiceCloning');
      expect(result).toBe(true);
    });

    it('returns false for disabled boolean feature', async () => {
      process.env.FEATURE_ENABLE_VOICE_CLONING = 'false';
      clearFeatureFlagsCache();

      const result = await isFeatureEnabled('enableVoiceCloning');
      expect(result).toBe(false);
    });

    it('returns true for positive numeric limit', async () => {
      const result = await isFeatureEnabled('maxMessagesPerDay');
      expect(result).toBe(true);
    });

    it('returns false for zero numeric limit', async () => {
      process.env.FEATURE_MAX_MESSAGES_PER_DAY = '0';
      clearFeatureFlagsCache();

      const result = await isFeatureEnabled('maxMessagesPerDay');
      expect(result).toBe(false);
    });
  });

  describe('getFeatureFlag', () => {
    it('returns specific flag value', async () => {
      const value = await getFeatureFlag('maxMessagesPerDay');
      expect(value).toBe(DEFAULT_FLAGS.maxMessagesPerDay);
    });

    it('returns overridden flag value', async () => {
      process.env.FEATURE_MAX_MESSAGES_PER_DAY = '200';
      clearFeatureFlagsCache();

      const value = await getFeatureFlag('maxMessagesPerDay');
      expect(value).toBe(200);
    });
  });

  describe('getEnabledAIModels', () => {
    it('returns all models when all flags enabled', async () => {
      const models = await getEnabledAIModels();

      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
      expect(models).toContain('deepseek-chat');
      expect(models).toContain('claude-3-5-sonnet');
      expect(models).toContain('gemini-2.0-flash');
      expect(models).toContain('llama-3.3-70b');
    });

    it('excludes DeepSeek models when disabled', async () => {
      process.env.FEATURE_ENABLE_DEEP_SEEK_MODEL = 'false';
      clearFeatureFlagsCache();

      const models = await getEnabledAIModels();

      expect(models).not.toContain('deepseek-chat');
      expect(models).not.toContain('deepseek-reasoner');
    });

    it('excludes Claude models when disabled', async () => {
      process.env.FEATURE_ENABLE_CLAUDE_MODEL = 'false';
      clearFeatureFlagsCache();

      const models = await getEnabledAIModels();

      expect(models).not.toContain('claude-3-5-sonnet');
      expect(models).not.toContain('claude-3-5-haiku');
    });

    it('always includes OpenAI base models', async () => {
      // Disable all optional models
      process.env.FEATURE_ENABLE_DEEP_SEEK_MODEL = 'false';
      process.env.FEATURE_ENABLE_CLAUDE_MODEL = 'false';
      process.env.FEATURE_ENABLE_GEMINI_MODEL = 'false';
      process.env.FEATURE_ENABLE_LLAMA_MODEL = 'false';
      clearFeatureFlagsCache();

      const models = await getEnabledAIModels();

      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4o-mini');
      expect(models.length).toBe(2);
    });
  });

  describe('isAIModelEnabled', () => {
    it('returns true for enabled model', async () => {
      const result = await isAIModelEnabled('gpt-4o');
      expect(result).toBe(true);
    });

    it('returns false for disabled model', async () => {
      process.env.FEATURE_ENABLE_DEEP_SEEK_MODEL = 'false';
      clearFeatureFlagsCache();

      const result = await isAIModelEnabled('deepseek-chat');
      expect(result).toBe(false);
    });

    it('returns false for unknown model', async () => {
      const result = await isAIModelEnabled('unknown-model');
      expect(result).toBe(false);
    });
  });

  describe('clearFeatureFlagsCache', () => {
    it('clears the cached flags', async () => {
      // Warm the cache
      await getFeatureFlags();

      // Set new env value
      process.env.FEATURE_MAX_MESSAGES_PER_DAY = '999';

      // Before clear - still cached
      const before = await getFeatureFlags();
      expect(before.maxMessagesPerDay).toBe(DEFAULT_FLAGS.maxMessagesPerDay);

      // Clear and refetch
      clearFeatureFlagsCache();
      const after = await getFeatureFlags();
      expect(after.maxMessagesPerDay).toBe(999);
    });
  });
});
