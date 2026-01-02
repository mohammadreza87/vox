/**
 * Redis Client Configuration
 * Uses Upstash Redis for serverless-friendly caching
 *
 * Setup:
 * 1. Create account at https://upstash.com
 * 2. Create a Redis database
 * 3. Add to .env.local:
 *    UPSTASH_REDIS_REST_URL=your-url
 *    UPSTASH_REDIS_REST_TOKEN=your-token
 */

import { Redis } from '@upstash/redis';

// Singleton Redis client
let redis: Redis | null = null;

/**
 * Get Redis client instance
 * Returns null if Redis is not configured (graceful degradation)
 */
export function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn('Redis not configured - caching disabled');
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Cache key prefixes for different data types
 */
export const CACHE_KEYS = {
  USER: 'user:',
  CHAT: 'chat:',
  CHATS_LIST: 'chats:',
  SUBSCRIPTION: 'subscription:',
  USAGE: 'usage:',
  VOICES: 'voices:',
  CONTACTS: 'contacts:',
  AI_RESPONSE: 'ai:',
  USER_PREFERENCES: 'user_prefs:',
} as const;

/**
 * Default TTL values (in seconds)
 */
export const CACHE_TTL = {
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 3600, // 1 hour
  VERY_LONG: 86400, // 24 hours
  SUBSCRIPTION: 1800, // 30 minutes
  AI_RESPONSE: 3600, // 1 hour (for identical prompts)
  USER_PREFERENCES: 600, // 10 minutes
} as const;
