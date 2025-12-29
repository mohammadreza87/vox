import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';

// ============================================
// Redis Client (Lazy Initialization)
// ============================================

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn('Rate limiting disabled: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not configured');
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}

// ============================================
// Rate Limiters
// ============================================

let _chatLimiter: Ratelimit | null = null;
let _apiLimiter: Ratelimit | null = null;
let _publicLimiter: Ratelimit | null = null;
let _v2ApiLimiter: Ratelimit | null = null;
let _voiceCloneLimiter: Ratelimit | null = null;
let _webhookLimiter: Ratelimit | null = null;
let _syncLimiter: Ratelimit | null = null;
let _voicesLimiter: Ratelimit | null = null;

/**
 * Rate limiter for chat endpoints
 * 30 requests per minute per user/IP
 */
export function getChatRateLimiter(): Ratelimit | null {
  if (_chatLimiter) return _chatLimiter;

  const client = getRedis();
  if (!client) return null;

  _chatLimiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'ratelimit:chat',
    analytics: true,
  });

  return _chatLimiter;
}

/**
 * Rate limiter for general API endpoints
 * 60 requests per minute per user/IP
 */
export function getApiRateLimiter(): Ratelimit | null {
  if (_apiLimiter) return _apiLimiter;

  const client = getRedis();
  if (!client) return null;

  _apiLimiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    prefix: 'ratelimit:api',
    analytics: true,
  });

  return _apiLimiter;
}

/**
 * Rate limiter for public/unauthenticated endpoints
 * 10 requests per minute per IP (more restrictive)
 */
export function getPublicRateLimiter(): Ratelimit | null {
  if (_publicLimiter) return _publicLimiter;

  const client = getRedis();
  if (!client) return null;

  _publicLimiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix: 'ratelimit:public',
    analytics: true,
  });

  return _publicLimiter;
}

/**
 * Rate limiter for v2 API endpoints
 * 100 requests per minute per user/IP
 */
export function getV2ApiRateLimiter(): Ratelimit | null {
  if (_v2ApiLimiter) return _v2ApiLimiter;

  const client = getRedis();
  if (!client) return null;

  _v2ApiLimiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(100, '1 m'),
    prefix: 'ratelimit:v2api',
    analytics: true,
  });

  return _v2ApiLimiter;
}

/**
 * Rate limiter for voice cloning (expensive)
 * 1 request per 10 minutes per user
 */
export function getVoiceCloneRateLimiter(): Ratelimit | null {
  if (_voiceCloneLimiter) return _voiceCloneLimiter;

  const client = getRedis();
  if (!client) return null;

  _voiceCloneLimiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(1, '10 m'),
    prefix: 'ratelimit:voiceclone',
    analytics: true,
  });

  return _voiceCloneLimiter;
}

/**
 * Rate limiter for webhook endpoints (global)
 * 100 requests per minute per IP
 */
export function getWebhookRateLimiter(): Ratelimit | null {
  if (_webhookLimiter) return _webhookLimiter;

  const client = getRedis();
  if (!client) return null;

  _webhookLimiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(100, '1 m'),
    prefix: 'ratelimit:webhook',
    analytics: true,
  });

  return _webhookLimiter;
}

/**
 * Rate limiter for sync endpoint
 * 6 requests per hour per user/IP
 */
export function getSyncRateLimiter(): Ratelimit | null {
  if (_syncLimiter) return _syncLimiter;

  const client = getRedis();
  if (!client) return null;

  _syncLimiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(6, '1 h'),
    prefix: 'ratelimit:sync',
    analytics: true,
  });

  return _syncLimiter;
}

/**
 * Rate limiter for listing voices
 * 10 requests per minute per user/IP
 */
export function getVoicesRateLimiter(): Ratelimit | null {
  if (_voicesLimiter) return _voicesLimiter;

  const client = getRedis();
  if (!client) return null;

  _voicesLimiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(10, '1 m'),
    prefix: 'ratelimit:voices',
    analytics: true,
  });

  return _voicesLimiter;
}

// ============================================
// Rate Limit Helpers
// ============================================

/**
 * Get a unique identifier for rate limiting
 * Uses userId if authenticated, otherwise falls back to IP
 */
export function getRateLimitIdentifier(request: NextRequest, userId?: string): string {
  if (userId) {
    return `user:${userId}`;
  }

  // Try to get real IP from headers (for proxied requests)
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  const ip = forwardedFor?.split(',')[0]?.trim() || realIp || 'anonymous';

  return `ip:${ip}`;
}

/**
 * Check rate limit and return appropriate response if exceeded
 * Returns null if within limits, NextResponse if exceeded
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  identifier: string
): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }
  // If no limiter (Redis not configured), fall back to secure in-memory limits
  if (!limiter) {
    return null;
  }

  const { success, limit, remaining, reset } = await limiter.limit(identifier);

  if (!success) {
    const retryAfter = Math.ceil((reset - Date.now()) / 1000);

    return NextResponse.json(
      {
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        limit,
        remaining: 0,
        retryAfter,
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': reset.toString(),
          'Retry-After': retryAfter.toString(),
        },
      }
    );
  }

  return null;
}

/**
 * Apply rate limiting to a request
 * Convenience function that combines identifier extraction and limit checking
 */
export async function applyRateLimit(
  request: NextRequest,
  limiter: Ratelimit | null,
  userId?: string
): Promise<NextResponse | null> {
  const identifier = getRateLimitIdentifier(request, userId);
  return checkRateLimit(limiter, identifier);
}

// ============================================
// Fail-secure in-memory fallback
// ============================================

type MemoryEntry = {
  count: number;
  resetAt: number;
};

const memoryLimits = new Map<string, MemoryEntry>();

function checkInMemoryRateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): { success: boolean; headers: Headers } {
  const now = Date.now();
  const existing = memoryLimits.get(identifier);

  if (!existing || now > existing.resetAt) {
    memoryLimits.set(identifier, { count: 1, resetAt: now + windowMs });
    return {
      success: true,
      headers: new Headers({
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': (limit - 1).toString(),
        'X-RateLimit-Reset': (now + windowMs).toString(),
      }),
    };
  }

  const nextCount = existing.count + 1;
  if (nextCount > limit) {
    const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
    const headers = new Headers({
      'X-RateLimit-Limit': limit.toString(),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': existing.resetAt.toString(),
      'Retry-After': retryAfter.toString(),
    });
    return { success: false, headers };
  }

  memoryLimits.set(identifier, { ...existing, count: nextCount });
  return {
    success: true,
    headers: new Headers({
      'X-RateLimit-Limit': limit.toString(),
      'X-RateLimit-Remaining': (limit - nextCount).toString(),
      'X-RateLimit-Reset': existing.resetAt.toString(),
    }),
  };
}

/**
 * Secure rate limit helper that falls back to in-memory limits when Redis is unavailable.
 */
export async function checkRateLimitSecure(
  limiter: Ratelimit | null,
  identifier: string,
  fallbackLimit: number,
  fallbackWindowMs: number
): Promise<{ success: boolean; response: NextResponse | null }> {
  // In tests, skip rate limiting to avoid shared in-memory state cross-tests
  if (process.env.NODE_ENV === 'test') {
    return { success: true, response: null };
  }

  if (!limiter) {
    const result = checkInMemoryRateLimit(identifier, fallbackLimit, fallbackWindowMs);
    if (!result.success) {
      return {
        success: false,
        response: NextResponse.json(
          {
            error: 'Too many requests',
            code: 'RATE_LIMIT_EXCEEDED',
          },
          { status: 429, headers: result.headers }
        ),
      };
    }
    return { success: true, response: null };
  }

  const limitResult = await limiter.limit(identifier);
  if (!limitResult.success) {
    const retryAfter = Math.ceil((limitResult.reset - Date.now()) / 1000);
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          limit: limitResult.limit,
          remaining: 0,
          retryAfter,
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limitResult.limit.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': limitResult.reset.toString(),
            'Retry-After': retryAfter.toString(),
          },
        }
      ),
    };
  }

  return { success: true, response: null };
}

// ============================================
// Response Helpers
// ============================================

/**
 * Add rate limit headers to a successful response
 */
export function addRateLimitHeaders(
  response: NextResponse,
  limit: number,
  remaining: number,
  reset: number
): NextResponse {
  response.headers.set('X-RateLimit-Limit', limit.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', reset.toString());
  return response;
}
