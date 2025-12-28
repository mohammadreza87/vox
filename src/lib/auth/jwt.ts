import { SignJWT, jwtVerify, JWTPayload } from 'jose';

/**
 * JWT Session Token Utilities for Vox
 * Uses the jose library for secure JWT handling
 */

// Get the secret key (must be at least 32 characters)
function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Session token payload structure
 */
export interface SessionPayload extends JWTPayload {
  /** User ID (e.g., "telegram_123456") */
  userId: string;
  /** Telegram user ID (numeric) */
  telegramId: number;
  /** Authentication platform */
  platform: 'telegram_miniapp' | 'telegram_widget' | 'firebase';
  /** Token issued at (Unix timestamp) */
  iat: number;
  /** Token expiration (Unix timestamp) */
  exp: number;
}

/**
 * Options for creating a session token
 */
export interface CreateSessionOptions {
  userId: string;
  telegramId: number;
  platform: SessionPayload['platform'];
  /** Token expiration in seconds (default: 24 hours) */
  expiresIn?: number;
}

/**
 * Create a signed JWT session token
 * @param options Session options
 * @returns Signed JWT string
 */
export async function createSessionToken(options: CreateSessionOptions): Promise<string> {
  const { userId, telegramId, platform, expiresIn = 24 * 60 * 60 } = options;

  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresIn;

  const token = await new SignJWT({
    userId,
    telegramId,
    platform,
  } as SessionPayload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer('vox')
    .setAudience('vox-client')
    .sign(getSecretKey());

  return token;
}

/**
 * Verify and decode a JWT session token
 * @param token JWT string
 * @returns Decoded payload or null if invalid
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      issuer: 'vox',
      audience: 'vox-client',
    });

    // Validate required fields
    if (!payload.userId || !payload.telegramId || !payload.platform) {
      return null;
    }

    return payload as SessionPayload;
  } catch (error) {
    // Token is invalid, expired, or tampered with
    if (process.env.NODE_ENV === 'development') {
      console.error('JWT verification failed:', error);
    }
    return null;
  }
}

/**
 * Extract bearer token from Authorization header
 * @param authHeader Authorization header value
 * @returns Token string or null
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7); // Remove "Bearer " prefix
}

/**
 * Check if a token is about to expire (within threshold)
 * Useful for implementing token refresh
 * @param payload Token payload
 * @param thresholdSeconds Seconds before expiry to consider "expiring" (default: 1 hour)
 * @returns true if token is expiring soon
 */
export function isTokenExpiringSoon(
  payload: SessionPayload,
  thresholdSeconds: number = 60 * 60
): boolean {
  const now = Math.floor(Date.now() / 1000);
  return payload.exp - now < thresholdSeconds;
}

/**
 * Get remaining token lifetime in seconds
 * @param payload Token payload
 * @returns Remaining seconds, or 0 if expired
 */
export function getTokenRemainingTime(payload: SessionPayload): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, payload.exp - now);
}
