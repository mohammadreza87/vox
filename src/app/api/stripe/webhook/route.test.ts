import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  },
  getTierFromPriceId: vi.fn(),
}));

vi.mock('@/lib/firestore', () => ({
  updateUserSubscription: vi.fn(),
  createUserDocument: vi.fn(),
  getUserDocument: vi.fn(),
}));

// Set environment variables
vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test123');

// Import after mocks
const { POST } = await import('./route');
const { stripe, getTierFromPriceId } = await import('@/lib/stripe');
const { updateUserSubscription, getUserDocument } = await import('@/lib/firestore');

describe('POST /api/stripe/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createWebhookRequest = (body: string, signature?: string) => {
    const headers = new Headers();
    if (signature) {
      headers.set('stripe-signature', signature);
    }
    return new Request('http://localhost:3000/api/stripe/webhook', {
      method: 'POST',
      headers,
      body,
    });
  };

  describe('Signature Validation', () => {
    it('returns 400 when signature header is missing', async () => {
      const request = createWebhookRequest('{}');

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'Missing stripe-signature header');
    });

    it('returns 400 when signature is invalid', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockImplementationOnce(() => {
        throw new Error('Invalid signature');
      });

      const request = createWebhookRequest('{}', 'invalid-sig');

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'Invalid signature');
    });
  });

  describe('Event Handling - checkout.session.completed', () => {
    it('handles successful checkout completion', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            customer: 'cus_123',
            customer_email: 'test@example.com',
            subscription: 'sub_123',
            metadata: { firebaseUserId: 'user-123' },
          },
        },
      } as never);

      vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
        id: 'sub_123',
        items: {
          data: [{ price: { id: 'price_pro' } }],
        },
        cancel_at_period_end: false,
        current_period_start: 1704067200,
        current_period_end: 1706745600,
      } as never);

      vi.mocked(getTierFromPriceId).mockReturnValueOnce('pro' as never);
      vi.mocked(getUserDocument).mockResolvedValueOnce({} as never);

      const request = createWebhookRequest('{}', 'valid-sig');

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });
      expect(updateUserSubscription).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          tier: 'pro',
          status: 'active',
          stripeCustomerId: 'cus_123',
          stripeSubscriptionId: 'sub_123',
        })
      );
    });

    it('skips processing when no user ID in metadata', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            subscription: 'sub_123',
            metadata: {},
          },
        },
      } as never);

      const request = createWebhookRequest('{}', 'valid-sig');

      const response = await POST(request as never);

      expect(response.status).toBe(200);
      expect(updateUserSubscription).not.toHaveBeenCalled();
    });
  });

  describe('Event Handling - customer.subscription.updated', () => {
    it('updates subscription status', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            status: 'active',
            items: {
              data: [{ price: { id: 'price_max' } }],
            },
            cancel_at_period_end: true,
            current_period_start: 1704067200,
            current_period_end: 1706745600,
            metadata: { firebaseUserId: 'user-123' },
          },
        },
      } as never);

      vi.mocked(getTierFromPriceId).mockReturnValueOnce('max' as never);

      const request = createWebhookRequest('{}', 'valid-sig');

      const response = await POST(request as never);

      expect(response.status).toBe(200);
      expect(updateUserSubscription).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          tier: 'max',
          status: 'active',
          cancelAtPeriodEnd: true,
        })
      );
    });

    it('downgrades to free when tier is unknown', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            status: 'active',
            items: {
              data: [{ price: { id: 'price_unknown' } }],
            },
            metadata: { firebaseUserId: 'user-123' },
          },
        },
      } as never);

      vi.mocked(getTierFromPriceId).mockReturnValueOnce(null as never);

      const request = createWebhookRequest('{}', 'valid-sig');

      const response = await POST(request as never);

      expect(response.status).toBe(200);
      expect(updateUserSubscription).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          tier: 'free',
          status: null,
        })
      );
    });
  });

  describe('Event Handling - customer.subscription.deleted', () => {
    it('downgrades user to free tier', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_123',
            metadata: { firebaseUserId: 'user-123' },
          },
        },
      } as never);

      const request = createWebhookRequest('{}', 'valid-sig');

      const response = await POST(request as never);

      expect(response.status).toBe(200);
      expect(updateUserSubscription).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          tier: 'free',
          status: null,
          stripeSubscriptionId: null,
        })
      );
    });
  });

  describe('Event Handling - invoice.payment_failed', () => {
    it('sets subscription status to past_due', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: 'invoice.payment_failed',
        data: {
          object: {
            subscription: 'sub_123',
          },
        },
      } as never);

      vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
        metadata: { firebaseUserId: 'user-123' },
      } as never);

      const request = createWebhookRequest('{}', 'valid-sig');

      const response = await POST(request as never);

      expect(response.status).toBe(200);
      expect(updateUserSubscription).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          status: 'past_due',
        })
      );
    });
  });

  describe('Event Handling - invoice.paid', () => {
    it('updates subscription to active and renews period', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: 'invoice.paid',
        data: {
          object: {
            subscription: 'sub_123',
          },
        },
      } as never);

      vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
        metadata: { firebaseUserId: 'user-123' },
        current_period_start: 1704067200,
        current_period_end: 1706745600,
      } as never);

      const request = createWebhookRequest('{}', 'valid-sig');

      const response = await POST(request as never);

      expect(response.status).toBe(200);
      expect(updateUserSubscription).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          status: 'active',
        })
      );
    });
  });

  describe('Unhandled Events', () => {
    it('returns 200 for unhandled event types', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: 'unknown.event',
        data: { object: {} },
      } as never);

      const request = createWebhookRequest('{}', 'valid-sig');

      const response = await POST(request as never);

      expect(response.status).toBe(200);
      expect(updateUserSubscription).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('returns 500 when processing fails', async () => {
      vi.mocked(stripe.webhooks.constructEvent).mockReturnValueOnce({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            items: { data: [{ price: { id: 'price_pro' } }] },
            metadata: { firebaseUserId: 'user-123' },
          },
        },
      } as never);

      vi.mocked(getTierFromPriceId).mockReturnValueOnce('pro' as never);
      vi.mocked(updateUserSubscription).mockRejectedValueOnce(new Error('DB error'));

      const request = createWebhookRequest('{}', 'valid-sig');

      const response = await POST(request as never);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toHaveProperty('error', 'Webhook processing failed');
    });
  });
});
