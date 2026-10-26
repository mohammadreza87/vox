/**
 * H3 (F180): POST /api/telegram/payments accepts only an own price id of the
 * shared table. Prototype keys ('constructor', 'toString', ...) and non-strings
 * get 400 before any Telegram call. The route's auth model is product decision
 * (a) and is unchanged here. No network: fetch is a mock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthenticatedRequest, parseResponse } from '@/test/utils';

vi.mock('@/lib/firebase-admin', () => ({
  verifyIdToken: vi.fn(async (token: string) => (token === 'mock-valid-token' ? { uid: 'user-123' } : null)),
  extractBearerToken: (header: string | null) => (header?.startsWith('Bearer ') ? header.slice(7) : null),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;
vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot-token');
vi.stubEnv('TELEGRAM_PAYMENT_TOKEN', 'test-payment-token');

const { POST } = await import('./route');
const ctx = { params: Promise.resolve({}) };

const post = (priceId: unknown) => POST(createAuthenticatedRequest('POST', '/api/telegram/payments', {
  body: { priceId, userId: 'user-123', telegramId: 123456 },
}), ctx);

describe('POST /api/telegram/payments priceId', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])('%s gets 400 with no Telegram call', async (priceId) => {
    const { status, data } = await parseResponse(await post(priceId));
    expect(status).toBe(400);
    expect(data).toHaveProperty('error', 'Invalid price ID');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([[123], [null], [['pro_monthly']], [{ toString: 'pro_monthly' }]])('a non-string priceId %j gets 400 with no Telegram call', async (priceId) => {
    expect((await post(priceId)).status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('positive control: a real price id reaches createInvoiceLink with its amount and label', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: 'https://t.me/invoice/synthetic' })));
    const { status, data } = await parseResponse(await post('pro_monthly'));
    expect(status).toBe(200);
    expect(data).toEqual({ invoiceLink: 'https://t.me/invoice/synthetic' });
    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(String((mockFetch.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({ title: 'Vox Pro - Monthly', currency: 'USD', prices: [{ label: 'Vox Pro - Monthly', amount: 999 }] });
  });
});
