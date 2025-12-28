import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthenticatedRequest, createMockRequest, parseResponse } from '@/test/utils';

// Mock dependencies
vi.mock('@/lib/firebase-admin', () => ({
  verifyIdToken: vi.fn(),
  extractBearerToken: vi.fn((header: string | null) => {
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }),
}));

vi.mock('@/lib/firestore', () => ({
  getUserDocument: vi.fn(),
  createUserDocument: vi.fn(),
  resetDailyUsageIfNeeded: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/cache', () => ({
  withCache: vi.fn((key: string, fn: () => Promise<unknown>) => fn()),
  cacheKeys: {
    subscription: (userId: string) => `subscription:${userId}`,
  },
  CACHE_TTL: {
    SUBSCRIPTION: 300,
  },
  invalidateSubscriptionCache: vi.fn(),
}));

// Import after mocks
const { GET } = await import('./route');
const { verifyIdToken } = await import('@/lib/firebase-admin');
const { getUserDocument, createUserDocument, resetDailyUsageIfNeeded } = await import(
  '@/lib/firestore'
);

describe('GET /api/user/subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resetDailyUsageIfNeeded).mockResolvedValue(undefined as never);
  });

  describe('Authentication', () => {
    it('returns 401 when no authorization header', async () => {
      const request = createMockRequest('GET', '/api/user/subscription');

      const response = await GET(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Authentication required');
    });

    it('returns 401 when token is invalid', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

      const request = createAuthenticatedRequest('GET', '/api/user/subscription', {
        token: 'invalid-token',
      });

      const response = await GET(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Invalid token');
    });

    it('verifies token from Authorization header', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValue({
        subscription: { tier: 'free' },
        usage: { messagesUsedToday: 0 },
      } as never);

      const request = createAuthenticatedRequest('GET', '/api/user/subscription', {
        token: 'valid-token',
      });

      await GET(request);

      expect(verifyIdToken).toHaveBeenCalledWith('valid-token');
    });
  });

  describe('User Document Handling', () => {
    it('creates user document if it does not exist', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
        name: 'Test User',
      } as never);

      // First call returns null (no user), second call returns created user
      vi.mocked(getUserDocument)
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce({
          subscription: { tier: 'free' },
          usage: { messagesUsedToday: 0 },
        } as never);

      const request = createAuthenticatedRequest('GET', '/api/user/subscription');

      const response = await GET(request);
      const { status } = await parseResponse(response);

      expect(status).toBe(200);
      expect(createUserDocument).toHaveBeenCalledWith(
        'test-user-123',
        'test@example.com',
        'Test User'
      );
    });

    it('returns 500 when user document cannot be created', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);

      // Returns null even after creation attempt - throws inside cache callback
      vi.mocked(getUserDocument)
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(null as never);

      const request = createAuthenticatedRequest('GET', '/api/user/subscription');

      const response = await GET(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Failed to get subscription data');
    });
  });

  describe('Daily Usage Reset', () => {
    it('calls resetDailyUsageIfNeeded', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValue({
        subscription: { tier: 'free' },
        usage: { messagesUsedToday: 0 },
      } as never);

      const request = createAuthenticatedRequest('GET', '/api/user/subscription');

      await GET(request);

      expect(resetDailyUsageIfNeeded).toHaveBeenCalledWith('test-user-123');
    });

    it('re-fetches user document after potential reset', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);

      // Reset returns true to trigger re-fetch
      vi.mocked(resetDailyUsageIfNeeded).mockResolvedValueOnce(true as never);

      // First call: high usage, second call after reset: reset usage
      vi.mocked(getUserDocument)
        .mockResolvedValueOnce({
          subscription: { tier: 'free' },
          usage: { messagesUsedToday: 100 },
        } as never)
        .mockResolvedValueOnce({
          subscription: { tier: 'free' },
          usage: { messagesUsedToday: 0 }, // After reset
        } as never);

      const request = createAuthenticatedRequest('GET', '/api/user/subscription');

      const response = await GET(request);
      const { data } = await parseResponse(response);

      // Should return the refreshed data
      expect(data.data.usage.messagesUsedToday).toBe(0);
    });
  });

  describe('Success Cases', () => {
    it('returns subscription and usage for free tier', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValue({
        subscription: {
          tier: 'free',
          messagesLimit: 50,
          voiceClonesLimit: 0,
        },
        usage: {
          messagesUsedToday: 10,
          voiceClonesUsed: 0,
          lastResetDate: '2024-01-15',
        },
      } as never);

      const request = createAuthenticatedRequest('GET', '/api/user/subscription');

      const response = await GET(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('subscription');
      expect(data.data.subscription.tier).toBe('free');
      expect(data.data).toHaveProperty('usage');
      expect(data.data.usage.messagesUsedToday).toBe(10);
    });

    it('returns subscription and usage for pro tier', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValue({
        subscription: {
          tier: 'pro',
          messagesLimit: 500,
          voiceClonesLimit: 3,
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
        },
        usage: {
          messagesUsedToday: 50,
          voiceClonesUsed: 1,
        },
      } as never);

      const request = createAuthenticatedRequest('GET', '/api/user/subscription');

      const response = await GET(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.subscription.tier).toBe('pro');
      expect(data.data.subscription.stripeSubscriptionId).toBe('sub_123');
      expect(data.data.usage.voiceClonesUsed).toBe(1);
    });

    it('returns subscription and usage for max tier', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValue({
        subscription: {
          tier: 'max',
          messagesLimit: -1, // Unlimited
          voiceClonesLimit: 10,
        },
        usage: {
          messagesUsedToday: 500,
          voiceClonesUsed: 5,
        },
      } as never);

      const request = createAuthenticatedRequest('GET', '/api/user/subscription');

      const response = await GET(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.subscription.tier).toBe('max');
      expect(data.data.subscription.messagesLimit).toBe(-1);
    });
  });

  describe('Error Handling', () => {
    it('returns 500 on verifyIdToken error', async () => {
      vi.mocked(verifyIdToken).mockRejectedValueOnce(new Error('Token verification failed'));

      const request = createAuthenticatedRequest('GET', '/api/user/subscription');

      const response = await GET(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Failed to get subscription data');
    });

    it('returns 500 on getUserDocument error', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockRejectedValueOnce(new Error('Firestore error'));

      const request = createAuthenticatedRequest('GET', '/api/user/subscription');

      const response = await GET(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Failed to get subscription data');
    });

    it('returns 500 on resetDailyUsageIfNeeded error', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'free' },
        usage: {},
      } as never);
      vi.mocked(resetDailyUsageIfNeeded).mockRejectedValueOnce(new Error('Reset error'));

      const request = createAuthenticatedRequest('GET', '/api/user/subscription');

      const response = await GET(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error.message).toBe('Failed to get subscription data');
    });
  });
});
