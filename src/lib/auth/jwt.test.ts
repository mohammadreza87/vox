import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock jose library
vi.mock('jose', () => ({
  SignJWT: class MockSignJWT {
    private payload: Record<string, unknown> = {};
    private header: Record<string, unknown> = {};

    constructor(payload: Record<string, unknown>) {
      this.payload = payload;
    }

    setProtectedHeader(header: Record<string, unknown>) {
      this.header = header;
      return this;
    }

    setIssuedAt(iat: number) {
      this.payload.iat = iat;
      return this;
    }

    setExpirationTime(exp: number) {
      this.payload.exp = exp;
      return this;
    }

    setIssuer(iss: string) {
      this.payload.iss = iss;
      return this;
    }

    setAudience(aud: string) {
      this.payload.aud = aud;
      return this;
    }

    async sign() {
      // Return a fake JWT token
      const headerB64 = Buffer.from(JSON.stringify(this.header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(this.payload)).toString('base64url');
      return `${headerB64}.${payloadB64}.fake-signature`;
    }
  },

  jwtVerify: vi.fn().mockImplementation(async (token: string) => {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid token');
      if (parts[2] !== 'fake-signature') throw new Error('Invalid signature');

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

      // Check expiration
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('Token expired');
      }

      return { payload };
    } catch {
      throw new Error('Invalid token');
    }
  }),
}));

// Set environment before importing
vi.stubEnv('JWT_SECRET', 'test-secret-key-that-is-at-least-32-characters-long');

// Import after mocks
const {
  createSessionToken,
  verifySessionToken,
  extractBearerToken,
  isTokenExpiringSoon,
  getTokenRemainingTime,
} = await import('./jwt');

import type { SessionPayload } from './jwt';

describe('JWT Utilities', () => {
  describe('createSessionToken', () => {
    it('creates a valid JWT token', async () => {
      const token = await createSessionToken({
        userId: 'telegram_123456',
        telegramId: 123456,
        platform: 'telegram_miniapp',
      });

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      // JWT format: header.payload.signature
      expect(token.split('.')).toHaveLength(3);
    });

    it('includes correct payload fields', async () => {
      const token = await createSessionToken({
        userId: 'telegram_789',
        telegramId: 789,
        platform: 'telegram_widget',
        expiresIn: 3600,
      });

      const payload = await verifySessionToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('telegram_789');
      expect(payload!.telegramId).toBe(789);
      expect(payload!.platform).toBe('telegram_widget');
    });

    it('respects custom expiration time', async () => {
      const expiresIn = 60; // 60 seconds
      const token = await createSessionToken({
        userId: 'telegram_123',
        telegramId: 123,
        platform: 'telegram_miniapp',
        expiresIn,
      });

      const payload = await verifySessionToken(token);
      expect(payload).not.toBeNull();

      const expectedExp = Math.floor(Date.now() / 1000) + expiresIn;
      // Allow 2 second tolerance for test execution time
      expect(payload!.exp).toBeGreaterThanOrEqual(expectedExp - 2);
      expect(payload!.exp).toBeLessThanOrEqual(expectedExp + 2);
    });
  });

  describe('verifySessionToken', () => {
    it('returns null for invalid token', async () => {
      const result = await verifySessionToken('invalid-token');
      expect(result).toBeNull();
    });

    it('returns null for tampered token', async () => {
      const token = await createSessionToken({
        userId: 'telegram_123',
        telegramId: 123,
        platform: 'telegram_miniapp',
      });

      // Tamper with the signature
      const tamperedToken = token.slice(0, -5) + 'XXXXX';
      const result = await verifySessionToken(tamperedToken);
      expect(result).toBeNull();
    });

    it('returns null for expired token', async () => {
      const token = await createSessionToken({
        userId: 'telegram_123',
        telegramId: 123,
        platform: 'telegram_miniapp',
        expiresIn: -1, // Already expired
      });

      const result = await verifySessionToken(token);
      expect(result).toBeNull();
    });

    it('verifies valid token correctly', async () => {
      const token = await createSessionToken({
        userId: 'telegram_456',
        telegramId: 456,
        platform: 'telegram_widget',
      });

      const payload = await verifySessionToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe('telegram_456');
      expect(payload!.telegramId).toBe(456);
      expect(payload!.platform).toBe('telegram_widget');
    });
  });

  describe('extractBearerToken', () => {
    it('extracts token from valid Bearer header', () => {
      const token = extractBearerToken('Bearer abc123');
      expect(token).toBe('abc123');
    });

    it('returns null for null header', () => {
      const token = extractBearerToken(null);
      expect(token).toBeNull();
    });

    it('returns null for non-Bearer header', () => {
      const token = extractBearerToken('Basic abc123');
      expect(token).toBeNull();
    });

    it('returns null for empty Bearer header', () => {
      const token = extractBearerToken('Bearer ');
      expect(token).toBe('');
    });

    it('handles complex tokens', () => {
      const complexToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.sig';
      const token = extractBearerToken(`Bearer ${complexToken}`);
      expect(token).toBe(complexToken);
    });
  });

  describe('isTokenExpiringSoon', () => {
    it('returns true when token is expiring soon', () => {
      const payload: SessionPayload = {
        userId: 'test',
        telegramId: 123,
        platform: 'telegram_miniapp',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
      };

      // Token expires in 30 mins, threshold is 1 hour
      expect(isTokenExpiringSoon(payload, 3600)).toBe(true);
    });

    it('returns false when token has plenty of time', () => {
      const payload: SessionPayload = {
        userId: 'test',
        telegramId: 123,
        platform: 'telegram_miniapp',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
      };

      // Token expires in 24 hours, threshold is 1 hour
      expect(isTokenExpiringSoon(payload, 3600)).toBe(false);
    });

    it('uses default 1 hour threshold', () => {
      const payload: SessionPayload = {
        userId: 'test',
        telegramId: 123,
        platform: 'telegram_miniapp',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
      };

      expect(isTokenExpiringSoon(payload)).toBe(true);
    });
  });

  describe('getTokenRemainingTime', () => {
    it('returns correct remaining time', () => {
      const remaining = 3600; // 1 hour
      const payload: SessionPayload = {
        userId: 'test',
        telegramId: 123,
        platform: 'telegram_miniapp',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + remaining,
      };

      const result = getTokenRemainingTime(payload);
      // Allow 1 second tolerance
      expect(result).toBeGreaterThanOrEqual(remaining - 1);
      expect(result).toBeLessThanOrEqual(remaining + 1);
    });

    it('returns 0 for expired token', () => {
      const payload: SessionPayload = {
        userId: 'test',
        telegramId: 123,
        platform: 'telegram_miniapp',
        iat: Math.floor(Date.now() / 1000) - 3600,
        exp: Math.floor(Date.now() / 1000) - 1800, // Expired 30 mins ago
      };

      expect(getTokenRemainingTime(payload)).toBe(0);
    });
  });
});

describe('JWT Secret Validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws error when JWT_SECRET is not set', async () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.resetModules();

    // Re-import the module with empty JWT_SECRET
    const { createSessionToken: createToken } = await import('./jwt');

    await expect(
      createToken({
        userId: 'test',
        telegramId: 123,
        platform: 'telegram_miniapp',
      })
    ).rejects.toThrow('JWT_SECRET environment variable is not set');
  });

  it('throws error when JWT_SECRET is too short', async () => {
    vi.stubEnv('JWT_SECRET', 'short');
    vi.resetModules();

    const { createSessionToken: createToken } = await import('./jwt');

    await expect(
      createToken({
        userId: 'test',
        telegramId: 123,
        platform: 'telegram_miniapp',
      })
    ).rejects.toThrow('JWT_SECRET must be at least 32 characters');
  });
});
