/**
 * Caching layer using Upstash Redis
 *
 * Provides a simple caching interface for frequently accessed data
 * to reduce database load and improve response times.
 */

import { Redis } from '@upstash/redis';
import { logger } from '../logger';

// ============================================
// Redis Client (Lazy Initialization)
// ============================================

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    logger.warn('Caching disabled: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not configured');
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

// ============================================
// Cache Configuration
// ============================================

/**
 * Default TTL values in seconds
 */
export const CACHE_TTL = {
  /** User subscription data - 5 minutes */
  SUBSCRIPTION: 5 * 60,
  /** Voice list - 1 hour */
  VOICES: 60 * 60,
  /** User preferences - 10 minutes */
  USER_PREFERENCES: 10 * 60,
  /** Short-lived cache - 1 minute */
  SHORT: 60,
  /** Medium-lived cache - 15 minutes */
  MEDIUM: 15 * 60,
  /** Long-lived cache - 1 hour */
  LONG: 60 * 60,
} as const;

/**
 * Cache key prefixes for namespacing
 */
export const CACHE_PREFIX = {
  SUBSCRIPTION: 'subscription',
  VOICES: 'voices',
  USER: 'user',
} as const;

// ============================================
// Core Cache Functions
// ============================================

/**
 * Get a value from the cache
 *
 * @param key - The cache key
 * @returns The cached value or null if not found
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedis();
  if (!client) return null;

  try {
    const value = await client.get<T>(key);
    if (value !== null) {
      logger.debug({ key }, 'Cache hit');
    }
    return value;
  } catch (error) {
    logger.error({ key, error }, 'Cache get error');
    return null;
  }
}

/**
 * Set a value in the cache
 *
 * @param key - The cache key
 * @param value - The value to cache (must be JSON serializable)
 * @param ttl - Time to live in seconds
 */
export async function cacheSet<T>(key: string, value: T, ttl: number): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    await client.set(key, value, { ex: ttl });
    logger.debug({ key, ttl }, 'Cache set');
  } catch (error) {
    logger.error({ key, error }, 'Cache set error');
  }
}

/**
 * Delete a value from the cache
 *
 * @param key - The cache key to delete
 */
export async function cacheDelete(key: string): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    await client.del(key);
    logger.debug({ key }, 'Cache delete');
  } catch (error) {
    logger.error({ key, error }, 'Cache delete error');
  }
}

/**
 * Delete multiple keys matching a pattern
 *
 * @param pattern - The pattern to match (e.g., "user:*:preferences")
 */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    let cursor = '0';
    const keysToDelete: string[] = [];

    // Scan for matching keys
    do {
      const result = await client.scan(cursor, { match: pattern, count: 100 });
      cursor = result[0] as string;
      keysToDelete.push(...(result[1] as string[]));
    } while (cursor !== '0');

    // Delete all matching keys
    if (keysToDelete.length > 0) {
      await Promise.all(keysToDelete.map((key) => client.del(key)));
      logger.debug({ pattern, deletedCount: keysToDelete.length }, 'Cache delete pattern');
    }
  } catch (error) {
    logger.error({ pattern, error }, 'Cache delete pattern error');
  }
}

/**
 * Get a value from cache, or compute and cache it if not found
 *
 * @param key - The cache key
 * @param fn - Function to compute the value if not cached
 * @param ttl - Time to live in seconds
 * @returns The cached or computed value
 *
 * @example
 * ```typescript
 * const subscription = await withCache(
 *   `subscription:${userId}`,
 *   async () => {
 *     return await getSubscriptionFromDatabase(userId);
 *   },
 *   CACHE_TTL.SUBSCRIPTION
 * );
 * ```
 */
export async function withCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttl: number
): Promise<T> {
  // Try to get from cache first
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  // Compute the value
  const value = await fn();

  // Cache it for next time (don't await, do it in background)
  cacheSet(key, value, ttl).catch((error) => {
    logger.error({ key, error }, 'Failed to cache value');
  });

  return value;
}

// ============================================
// Specialized Cache Functions
// ============================================

/**
 * Cache key builders for common use cases
 */
export const cacheKeys = {
  subscription: (userId: string) => `${CACHE_PREFIX.SUBSCRIPTION}:${userId}`,
  voices: () => `${CACHE_PREFIX.VOICES}:list`,
  userPreferences: (userId: string) => `${CACHE_PREFIX.USER}:${userId}:preferences`,
};

/**
 * Get cached subscription data
 */
export async function getCachedSubscription<T>(userId: string): Promise<T | null> {
  return cacheGet<T>(cacheKeys.subscription(userId));
}

/**
 * Cache subscription data
 */
export async function cacheSubscription<T>(userId: string, subscription: T): Promise<void> {
  await cacheSet(cacheKeys.subscription(userId), subscription, CACHE_TTL.SUBSCRIPTION);
}

/**
 * Invalidate cached subscription data
 */
export async function invalidateSubscriptionCache(userId: string): Promise<void> {
  await cacheDelete(cacheKeys.subscription(userId));
}

/**
 * Get cached voice list
 */
export async function getCachedVoices<T>(): Promise<T | null> {
  return cacheGet<T>(cacheKeys.voices());
}

/**
 * Cache voice list
 */
export async function cacheVoices<T>(voices: T): Promise<void> {
  await cacheSet(cacheKeys.voices(), voices, CACHE_TTL.VOICES);
}

/**
 * Invalidate all user-related caches
 * Call this on logout or account changes
 */
export async function invalidateUserCaches(userId: string): Promise<void> {
  await Promise.all([
    cacheDelete(cacheKeys.subscription(userId)),
    cacheDelete(cacheKeys.userPreferences(userId)),
  ]);
}

// ============================================
// Cache Health Check
// ============================================

/**
 * Check if Redis cache is available and working
 */
export async function isCacheAvailable(): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;

  try {
    await client.ping();
    return true;
  } catch {
    return false;
  }
}
