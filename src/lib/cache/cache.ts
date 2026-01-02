/**
 * Cache Utilities
 * Provides high-level caching functions with automatic fallback
 */

import { getRedis, CACHE_TTL, CACHE_KEYS } from './redis';

/**
 * Cache key generators for backward compatibility with existing API routes
 * Usage: cacheKeys.subscription(userId) => 'subscription:abc123'
 */
export const cacheKeys = {
  user: (userId: string) => `${CACHE_KEYS.USER}${userId}`,
  chat: (chatId: string) => `${CACHE_KEYS.CHAT}${chatId}`,
  chatsList: (userId: string) => `${CACHE_KEYS.CHATS_LIST}${userId}`,
  subscription: (userId: string) => `${CACHE_KEYS.SUBSCRIPTION}${userId}`,
  usage: (userId: string) => `${CACHE_KEYS.USAGE}${userId}`,
  contacts: (userId: string) => `${CACHE_KEYS.CONTACTS}${userId}`,
  voices: (userId: string) => `${CACHE_KEYS.VOICES}${userId}`,
  userPreferences: (userId: string) => `${CACHE_KEYS.USER_PREFERENCES}${userId}`,
} as const;

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string;
}

/**
 * Get value from cache
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const value = await redis.get<T>(key);
    return value;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

/**
 * Set value in cache
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number = CACHE_TTL.MEDIUM
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    await redis.setex(key, ttlSeconds, value);
    return true;
  } catch (error) {
    console.error('Cache set error:', error);
    return false;
  }
}

/**
 * Delete value from cache
 */
export async function cacheDelete(key: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    await redis.del(key);
    return true;
  } catch (error) {
    console.error('Cache delete error:', error);
    return false;
  }
}

/**
 * Delete multiple keys matching a pattern
 */
export async function cacheDeletePattern(pattern: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    // Use SCAN to find matching keys
    let cursor = 0;
    const keysToDelete: string[] = [];

    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = Number(nextCursor);
      keysToDelete.push(...keys);
    } while (cursor !== 0);

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
    }

    return true;
  } catch (error) {
    console.error('Cache delete pattern error:', error);
    return false;
  }
}

/**
 * Get or set pattern - fetch from cache or execute function and cache result
 */
export async function cacheGetOrSet<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = CACHE_TTL.MEDIUM
): Promise<T> {
  // Try cache first
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  // Fetch fresh data
  const data = await fetchFn();

  // Cache the result (don't await, fire and forget)
  cacheSet(key, data, ttlSeconds).catch(console.error);

  return data;
}

/**
 * Invalidate user-related cache entries
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  await Promise.all([
    cacheDeletePattern(`user:${userId}*`),
    cacheDeletePattern(`chats:${userId}*`),
    cacheDeletePattern(`subscription:${userId}*`),
    cacheDeletePattern(`contacts:${userId}*`),
  ]);
}

/**
 * Invalidate chat-related cache entries
 */
export async function invalidateChatCache(userId: string, chatId?: string): Promise<void> {
  if (chatId) {
    await cacheDelete(`chat:${chatId}`);
  }
  await cacheDelete(`chats:${userId}`);
}

/**
 * Invalidate subscription-related cache entries
 */
export async function invalidateSubscriptionCache(userId: string): Promise<void> {
  await Promise.all([
    cacheDelete(`${CACHE_KEYS.SUBSCRIPTION}${userId}`),
    cacheDelete(`${CACHE_KEYS.USAGE}${userId}`),
  ]);
}

/**
 * Fetch with caching - wraps a fetch function with Redis caching
 * Usage: const data = await withCache(cacheKeys.subscription(userId), fetchFn, CACHE_TTL.SUBSCRIPTION);
 *
 * This is the primary API for caching in API routes.
 * Alias for cacheGetOrSet with a more descriptive name.
 */
export async function withCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = CACHE_TTL.MEDIUM
): Promise<T> {
  return cacheGetOrSet(key, fetchFn, ttlSeconds);
}

/**
 * Cache decorator factory for creating cached versions of functions
 * Usage: const cachedFn = createCachedFunction('key-prefix', originalFn, { ttl: 300 });
 */
export function createCachedFunction<TArgs extends unknown[], TResult>(
  keyGenerator: (...args: TArgs) => string,
  fn: (...args: TArgs) => Promise<TResult>,
  options: CacheOptions = {}
): (...args: TArgs) => Promise<TResult> {
  const { ttl = CACHE_TTL.MEDIUM, prefix = '' } = options;

  return async (...args: TArgs): Promise<TResult> => {
    const key = prefix + keyGenerator(...args);
    return cacheGetOrSet(key, () => fn(...args), ttl);
  };
}
