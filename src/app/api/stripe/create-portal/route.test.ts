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

vi.mock('@/lib/stripe', () => ({
  stripe: {
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
    },
  },
}));

vi.mock('@/lib/firestore', () => ({
  getUserDocument: vi.fn(),
}));

// Import after mocks
const { POST } = await import('./route');
const { verifyIdToken } = await import('@/lib/firebase-admin');
const { stripe } = await import('@/lib/stripe');
const { getUserDocument } = await import('@/lib/firestore');

describe('POST /api/stripe/create-portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no authorization header', async () => {
      const request = createMockRequest('POST', '/api/stripe/create-portal', {
        body: {},
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(401);
      expect(data).toHaveProperty('error', 'Unauthorized');
    });

    it('returns 401 when token is invalid', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-portal', {
        body: {},
        token: 'invalid-token',
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(401);
      expect(data).toHaveProperty('error', 'Invalid token');
    });
  });

  describe('Validation', () => {
    beforeEach(() => {
      vi.mocked(verifyIdToken).mockResolvedValue({
        uid: 'test-user-123',
      } as never);
    });

    it('returns 400 when user has no subscription', async () => {
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: {},
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-portal', {
        body: {},
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data).toHaveProperty('error', 'No subscription found');
    });

    it('returns 400 when no Stripe customer ID', async () => {
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { tier: 'pro', stripeCustomerId: null },
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-portal', {
        body: {},
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data).toHaveProperty('error', 'No subscription found');
    });
  });

  describe('Success Cases', () => {
    beforeEach(() => {
      vi.mocked(verifyIdToken).mockResolvedValue({
        uid: 'test-user-123',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValue({
        subscription: { stripeCustomerId: 'cus_123' },
      } as never);
    });

    it('creates portal session and returns URL', async () => {
      vi.mocked(stripe.billingPortal.sessions.create).mockResolvedValueOnce({
        url: 'https://billing.stripe.com/session',
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-portal', {
        body: {},
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data).toHaveProperty('url', 'https://billing.stripe.com/session');
    });

    it('uses custom return URL', async () => {
      vi.mocked(stripe.billingPortal.sessions.create).mockResolvedValueOnce({
        url: 'https://billing.stripe.com/session',
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-portal', {
        body: { returnUrl: 'https://app.example.com/settings' },
      });

      await POST(request);

      expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_123',
          return_url: 'https://app.example.com/settings',
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('returns 500 on Stripe error', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { stripeCustomerId: 'cus_123' },
      } as never);
      vi.mocked(stripe.billingPortal.sessions.create).mockRejectedValueOnce(
        new Error('Stripe error')
      );

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-portal', {
        body: {},
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data).toHaveProperty('error', 'Failed to create portal session');
    });
  });
});
