import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthenticatedRequest, createMockRequest, parseResponse } from '@/test/utils';

// Mock dependencies
vi.mock('@/lib/firebase-admin', () => ({
  verifyIdToken: vi.fn(async (token: string) => (token === 'mock-valid-token' ? { uid: 'user-123' } : null)),
  extractBearerToken: (header: string | null) => (header?.startsWith('Bearer ') ? header.slice(7) : null),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Set environment variables
vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot-token');
vi.stubEnv('TELEGRAM_PAYMENT_TOKEN', 'test-payment-token');

// Import after mocks
const { POST } = await import('./route');
const ctx = { params: Promise.resolve({}) };

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

        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        const response = await freshPOST(request, ctx);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data).toHaveProperty('error', 'Telegram payments not configured');

        // Restore
        vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot-token');
      });
    });

    describe('Validation', () => {
      it('returns 400 for invalid priceId', async () => {
        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'invalid_price', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request, ctx);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(400);
        expect(data).toHaveProperty('error', 'Invalid price ID');
      });

      it('rejects a request without a Firebase ID token before calling Telegram', async () => {
        const request = createMockRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request, ctx);
        expect(response.status).toBe(401);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('rejects an invalid ID token before calling Telegram', async () => {
        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          token: 'forged', body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request, ctx);
        expect(response.status).toBe(401);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('refuses an invoice for a different user than the signed-in one', async () => {
        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'someone-else', telegramId: 123456 },
        });

        const response = await POST(request, ctx);
        expect(response.status).toBe(403);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('takes the invoice user from the ID token when the body omits it', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true, result: 'https://t.me/invoice/1' }) });
        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', telegramId: 123456 },
        });

        const response = await POST(request, ctx);
        expect(response.status).toBe(200);
        expect(JSON.parse(JSON.parse(mockFetch.mock.calls[0][1].body).payload)).toEqual({ priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 });
      });

      it('returns 400 when telegramId is missing', async () => {
        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123' },
        });

        const response = await POST(request, ctx);
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

        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request, ctx);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data).toHaveProperty('invoiceLink', 'https://t.me/invoice/123');
      });

      it('creates invoice link for max_annual', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: 'https://t.me/invoice/456' }),
        });

        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'max_annual', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request, ctx);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(200);
        expect(data).toHaveProperty('invoiceLink');
      });

      it('calls Telegram API with correct parameters', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: 'https://t.me/invoice/123' }),
        });

        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        await POST(request, ctx);

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

        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request, ctx);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data).toHaveProperty('error', 'API error');
      });

      it('returns 500 on network error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const request = createAuthenticatedRequest('POST', '/api/telegram/payments', {
          body: { priceId: 'pro_monthly', userId: 'user-123', telegramId: 123456 },
        });

        const response = await POST(request, ctx);
        const { status, data } = await parseResponse(response);

        expect(status).toBe(500);
        expect(data).toHaveProperty('error', 'Failed to create payment');
      });
    });
  });

  describe('Payment updates', () => {
    it('exposes no PUT handler: payment updates go only through the verified /api/telegram/webhook', async () => {
      const route = await import('./route');
      expect(Object.keys(route).sort()).toEqual(['POST']);
      expect((route as Record<string, unknown>).PUT).toBeUndefined();
    });
  });
});
