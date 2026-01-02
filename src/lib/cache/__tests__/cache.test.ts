import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheGetOrSet,
  withCache,
  invalidateUserCache,
  invalidateChatCache,
  invalidateSubscriptionCache,
  cacheKeys,
  CACHE_TTL,
} from '../index';

// Mock Redis
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  del: vi.fn(),
  scan: vi.fn(),
};

vi.mock('../redis', () => ({
  getRedis: () => mockRedis,
  isRedisAvailable: () => true,
  CACHE_KEYS: {
    USER: 'user:',
    CHAT: 'chat:',
    CHATS_LIST: 'chats:',
    SUBSCRIPTION: 'subscription:',
    USAGE: 'usage:',
    VOICES: 'voices:',
    CONTACTS: 'contacts:',
    AI_RESPONSE: 'ai:',
    USER_PREFERENCES: 'user_prefs:',
  },
  CACHE_TTL: {
    SHORT: 60,
    MEDIUM: 300,
    LONG: 3600,
    VERY_LONG: 86400,
    SUBSCRIPTION: 1800,
    AI_RESPONSE: 3600,
    USER_PREFERENCES: 600,
  },
}));

describe('Cache Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cacheGet', () => {
    it('returns cached value when exists', async () => {
      mockRedis.get.mockResolvedValue({ name: 'test' });

      const result = await cacheGet('test-key');

      expect(result).toEqual({ name: 'test' });
      expect(mockRedis.get).toHaveBeenCalledWith('test-key');
    });

    it('returns null when cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await cacheGet('missing-key');

      expect(result).toBeNull();
    });

    it('returns null on error', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis error'));

      const result = await cacheGet('error-key');

      expect(result).toBeNull();
    });
  });

  describe('cacheSet', () => {
    it('sets value with default TTL', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      const result = await cacheSet('key', { data: 'value' });

      expect(result).toBe(true);
      expect(mockRedis.setex).toHaveBeenCalledWith('key', 300, { data: 'value' });
    });

    it('sets value with custom TTL', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      const result = await cacheSet('key', 'value', 3600);

      expect(result).toBe(true);
      expect(mockRedis.setex).toHaveBeenCalledWith('key', 3600, 'value');
    });

    it('returns false on error', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Redis error'));

      const result = await cacheSet('key', 'value');

      expect(result).toBe(false);
    });
  });

  describe('cacheDelete', () => {
    it('deletes key successfully', async () => {
      mockRedis.del.mockResolvedValue(1);

      const result = await cacheDelete('key');

      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('key');
    });

    it('returns false on error', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));

      const result = await cacheDelete('key');

      expect(result).toBe(false);
    });
  });

  describe('cacheGetOrSet', () => {
    it('returns cached value when exists', async () => {
      mockRedis.get.mockResolvedValue({ cached: true });

      const fetchFn = vi.fn().mockResolvedValue({ fresh: true });
      const result = await cacheGetOrSet('key', fetchFn);

      expect(result).toEqual({ cached: true });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('fetches and caches when cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockResolvedValue('OK');

      const fetchFn = vi.fn().mockResolvedValue({ fresh: true });
      const result = await cacheGetOrSet('key', fetchFn, 600);

      expect(result).toEqual({ fresh: true });
      expect(fetchFn).toHaveBeenCalled();
      // setex is fire-and-forget, so we just check it was called
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockRedis.setex).toHaveBeenCalledWith('key', 600, { fresh: true });
    });
  });

  describe('withCache', () => {
    it('works as alias for cacheGetOrSet', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockResolvedValue('OK');

      const fetchFn = vi.fn().mockResolvedValue('result');
      const result = await withCache('key', fetchFn, 300);

      expect(result).toBe('result');
      expect(fetchFn).toHaveBeenCalled();
    });
  });

  describe('cacheKeys', () => {
    it('generates correct cache keys', () => {
      expect(cacheKeys.user('user123')).toBe('user:user123');
      expect(cacheKeys.chat('chat456')).toBe('chat:chat456');
      expect(cacheKeys.chatsList('user123')).toBe('chats:user123');
      expect(cacheKeys.subscription('user123')).toBe('subscription:user123');
      expect(cacheKeys.usage('user123')).toBe('usage:user123');
      expect(cacheKeys.contacts('user123')).toBe('contacts:user123');
      expect(cacheKeys.voices('user123')).toBe('voices:user123');
      expect(cacheKeys.userPreferences('user123')).toBe('user_prefs:user123');
    });
  });

  describe('invalidateUserCache', () => {
    it('deletes all user-related cache patterns', async () => {
      mockRedis.scan.mockResolvedValue([0, ['key1', 'key2']]);
      mockRedis.del.mockResolvedValue(2);

      await invalidateUserCache('user123');

      // Should scan for multiple patterns
      expect(mockRedis.scan).toHaveBeenCalledTimes(4);
    });
  });

  describe('invalidateChatCache', () => {
    it('deletes chat and chats list cache', async () => {
      mockRedis.del.mockResolvedValue(1);

      await invalidateChatCache('user123', 'chat456');

      expect(mockRedis.del).toHaveBeenCalledWith('chat:chat456');
      expect(mockRedis.del).toHaveBeenCalledWith('chats:user123');
    });

    it('only deletes chats list when no chatId', async () => {
      mockRedis.del.mockResolvedValue(1);

      await invalidateChatCache('user123');

      expect(mockRedis.del).toHaveBeenCalledTimes(1);
      expect(mockRedis.del).toHaveBeenCalledWith('chats:user123');
    });
  });

  describe('invalidateSubscriptionCache', () => {
    it('deletes subscription and usage cache', async () => {
      mockRedis.del.mockResolvedValue(1);

      await invalidateSubscriptionCache('user123');

      expect(mockRedis.del).toHaveBeenCalledWith('subscription:user123');
      expect(mockRedis.del).toHaveBeenCalledWith('usage:user123');
    });
  });

  describe('CACHE_TTL', () => {
    it('exports correct TTL values', () => {
      expect(CACHE_TTL.SHORT).toBe(60);
      expect(CACHE_TTL.MEDIUM).toBe(300);
      expect(CACHE_TTL.LONG).toBe(3600);
      expect(CACHE_TTL.SUBSCRIPTION).toBe(1800);
    });
  });
});
