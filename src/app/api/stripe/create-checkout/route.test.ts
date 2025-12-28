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
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
  },
  getOrCreateCustomer: vi.fn(),
}));

vi.mock('@/lib/firestore', () => ({
  getUserDocument: vi.fn(),
  setStripeCustomerId: vi.fn(),
}));

// Import after mocks
const { POST } = await import('./route');
const { verifyIdToken } = await import('@/lib/firebase-admin');
const { stripe, getOrCreateCustomer } = await import('@/lib/stripe');
const { getUserDocument, setStripeCustomerId } = await import('@/lib/firestore');

describe('POST /api/stripe/create-checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when no authorization header', async () => {
      const request = createMockRequest('POST', '/api/stripe/create-checkout', {
        body: { priceId: 'price_123' },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(401);
      expect(data).toHaveProperty('error', 'Unauthorized');
    });

    it('returns 401 when token is invalid', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce(null as never);

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-checkout', {
        body: { priceId: 'price_123' },
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
        email: 'test@example.com',
      } as never);
    });

    it('returns 400 when user has no email', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: null,
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-checkout', {
        body: { priceId: 'price_123' },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data).toHaveProperty('error', 'User email not found');
    });

    it('returns 400 when priceId is missing', async () => {
      const request = createAuthenticatedRequest('POST', '/api/stripe/create-checkout', {
        body: {},
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(400);
      expect(data).toHaveProperty('error', 'Price ID is required');
    });
  });

  describe('Success Cases', () => {
    beforeEach(() => {
      vi.mocked(verifyIdToken).mockResolvedValue({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValue({
        subscription: { stripeCustomerId: null },
      } as never);
      vi.mocked(getOrCreateCustomer).mockResolvedValue('cus_new123' as never);
      vi.mocked(setStripeCustomerId).mockResolvedValue(undefined as never);
    });

    it('creates checkout session for new customer', async () => {
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/session',
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-checkout', {
        body: { priceId: 'price_pro_monthly' },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data).toHaveProperty('sessionId', 'cs_test_123');
      expect(data).toHaveProperty('url', 'https://checkout.stripe.com/session');
      expect(setStripeCustomerId).toHaveBeenCalledWith('test-user-123', 'cus_new123');
    });

    it('uses existing customer ID', async () => {
      vi.mocked(getUserDocument).mockResolvedValueOnce({
        subscription: { stripeCustomerId: 'cus_existing123' },
      } as never);
      vi.mocked(getOrCreateCustomer).mockResolvedValueOnce('cus_existing123' as never);
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/session',
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-checkout', {
        body: { priceId: 'price_pro_monthly' },
      });

      await POST(request);

      expect(getOrCreateCustomer).toHaveBeenCalledWith(
        'test-user-123',
        'test@example.com',
        'cus_existing123'
      );
      expect(setStripeCustomerId).not.toHaveBeenCalled();
    });

    it('creates session with correct parameters', async () => {
      vi.mocked(stripe.checkout.sessions.create).mockResolvedValueOnce({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/session',
      } as never);

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-checkout', {
        body: {
          priceId: 'price_pro_monthly',
          successUrl: 'https://app.example.com/success',
          cancelUrl: 'https://app.example.com/cancel',
        },
      });

      await POST(request);

      expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_new123',
          mode: 'subscription',
          line_items: [{ price: 'price_pro_monthly', quantity: 1 }],
          success_url: 'https://app.example.com/success',
          cancel_url: 'https://app.example.com/cancel',
          metadata: { firebaseUserId: 'test-user-123' },
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('returns 500 on Stripe error', async () => {
      vi.mocked(verifyIdToken).mockResolvedValueOnce({
        uid: 'test-user-123',
        email: 'test@example.com',
      } as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({} as never);
      vi.mocked(getOrCreateCustomer).mockRejectedValueOnce(new Error('Stripe error'));

      const request = createAuthenticatedRequest('POST', '/api/stripe/create-checkout', {
        body: { priceId: 'price_123' },
      });

      const response = await POST(request);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(500);
      expect(data).toHaveProperty('error', 'Failed to create checkout session');
    });
  });
});
