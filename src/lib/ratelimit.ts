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
  // If no limiter (Redis not configured), allow request
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
