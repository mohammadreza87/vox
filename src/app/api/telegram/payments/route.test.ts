import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRequest, parseResponse } from '@/test/utils';

// Mock dependencies
vi.mock('@/lib/firebase-admin', () => ({
  getAdminDb: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Set environment variables
vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot-token');
vi.stubEnv('TELEGRAM_PAYMENT_TOKEN', 'test-payment-token');

// Import after mocks
const { POST, PUT } = await import('./route');
const { getAdminDb } = await import('@/lib/firebase-admin');

describe('/api/telegram/payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('POST /api/telegram/payments', () => {
    describe('Configuration', () => {
      it('returns 500 when Telegram tokens not configured', async () => {
        vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
        vi.resetModules();

        const { POST: freshPOST } = await import('./route');

        const request = createMockRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        const response = await freshPOST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data).toHaveProperty('error', 'Telegram payments not configured');

        // Restore
        vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot-token');
      });
    });

    describe('Validation', () => {
      it('returns 400 for invalid priceId', async () => {
        const request = createMockRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'invalid_price', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(400);
        expect(data).toHaveProperty('error', 'Invalid price ID');
      });

      it('returns 400 when userId is missing', async () => {
        const request = createMockRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', telegramId: 123456 },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(400);
        expect(data).toHaveProperty('error', 'Missing user ID or Telegram ID');
      });

      it('returns 400 when telegramId is missing', async () => {
        const request = createMockRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123' },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(400);
        expect(data).toHaveProperty('error', 'Missing user ID or Telegram ID');
      });
    });

    describe('Success Cases', () => {
      it('creates invoice link for pro_monthly', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: 'https://t.me/invoice/123' }),
        });

        const request = createMockRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data).toHaveProperty('invoiceLink', 'https://t.me/invoice/123');
      });

      it('creates invoice link for max_annual', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: 'https://t.me/invoice/456' }),
        });

        const request = createMockRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'max_annual', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data).toHaveProperty('invoiceLink');
      });

      it('calls Telegram API with correct parameters', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: 'https://t.me/invoice/123' }),
        });

        const request = createMockRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        await POST(request);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('createInvoiceLink'),
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        );

        const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(callBody).toHaveProperty('title', 'Vox Pro - Monthly');
        expect(callBody).toHaveProperty('currency', 'USD');
        expect(callBody.prices[0]).toHaveProperty('amount', 999);
      });
    });

    describe('Error Handling', () => {
      it('returns 500 when Telegram API returns error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: false, description: 'API error' }),
        });

        const request = createMockRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data).toHaveProperty('error', 'API error');
      });

      it('returns 500 on network error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const request = createMockRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data).toHaveProperty('error', 'Failed to create payment');
      });
    });
  });

  describe('PUT /api/telegram/payments (Webhook)', () => {
    const mockDb = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      set: vi.fn(),
    };

    beforeEach(() => {
      vi.mocked(getAdminDb).mockResolvedValue(mockDb as never);
      mockDb.collection.mockReturnThis();
      mockDb.doc.mockReturnThis();
      mockDb.set.mockResolvedValue(undefined);
    });

    describe('Pre-checkout Query', () => {
      it('accepts pre-checkout query', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        });

        const request = createMockRequest('PUT', '/api/telegram/payments', {
          body: {
            pre_checkout_query: {
              id: 'query-123',
              from: { id: 123456 },
            },
          },
        });

        const response = await PUT(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data).toEqual({ success: true });
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('answerPreCheckoutQuery'),
          expect.objectContaining({
            method: 'POST',
          })
        );
      });
    });

    describe('Successful Payment', () => {
      it('updates user subscription on successful payment', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        });

        const request = createMockRequest('PUT', '/api/telegram/payments', {
          body: {
            message: {
              from: { id: 123456 },
              successful_payment: {
                telegram_payment_charge_id: 'tg_charge_123',
                provider_payment_charge_id: 'provider_123',
                total_amount: 999,
                currency: 'USD',
                invoice_payload: JSON.stringify({
                  priceId: 'pro_monthly',
                  userId: 'user-123',
                }),
              },
            },
          },
        });

        const response = await PUT(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data).toEqual({ success: true });
        expect(mockDb.set).toHaveBeenCalledWith(
          expect.objectContaining({
            tier: 'pro',
            status: 'active',
            provider: 'telegram',
          }),
          { merge: true }
        );
      });

      it('sets correct tier for max plan', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        });

        const request = createMockRequest('PUT', '/api/telegram/payments', {
          body: {
            message: {
              from: { id: 123456 },
              successful_payment: {
                telegram_payment_charge_id: 'tg_charge_123',
                provider_payment_charge_id: 'provider_123',
                total_amount: 2999,
                currency: 'USD',
                invoice_payload: JSON.stringify({
                  priceId: 'max_monthly',
                  userId: 'user-123',
                }),
              },
            },
          },
        });

        await PUT(request);

        expect(mockDb.set).toHaveBeenCalledWith(
          expect.objectContaining({
            tier: 'max',
          }),
          { merge: true }
        );
      });

      it('sends confirmation message to user', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        });

        const request = createMockRequest('PUT', '/api/telegram/payments', {
          body: {
            message: {
              from: { id: 123456 },
              successful_payment: {
                telegram_payment_charge_id: 'tg_charge_123',
                provider_payment_charge_id: 'provider_123',
                total_amount: 999,
                currency: 'USD',
                invoice_payload: JSON.stringify({
                  priceId: 'pro_monthly',
                  userId: 'user-123',
                }),
              },
            },
          },
        });

        await PUT(request);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('sendMessage'),
          expect.objectContaining({
            method: 'POST',
          })
        );
      });
    });

    describe('Empty Webhook', () => {
      it('returns success for empty webhook', async () => {
        const request = createMockRequest('PUT', '/api/telegram/payments', {
          body: {},
        });

        const response = await PUT(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data).toEqual({ success: true });
      });
    });

    describe('Error Handling', () => {
      it('returns 500 on processing error', async () => {
        vi.mocked(getAdminDb).mockRejectedValueOnce(new Error('DB error'));

        const request = createMockRequest('PUT', '/api/telegram/payments', {
          body: {
            message: {
              from: { id: 123456 },
              successful_payment: {
                invoice_payload: JSON.stringify({
                  priceId: 'pro_monthly',
                  userId: 'user-123',
                }),
              },
            },
          },
        });

        const response = await PUT(request);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data).toHaveProperty('error', 'Webhook processing failed');
      });
    });
  });
});
