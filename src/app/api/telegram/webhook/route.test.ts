import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest } from '@/test/utils';

const set = vi.fn(async () => undefined);
const doc = vi.fn(() => ({ collection: () => ({ doc: () => ({ set }) }) }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminDb: async () => ({ collection: () => ({ doc }) }) }));
vi.mock('@/lib/ratelimit', () => ({
  getWebhookRateLimiter: () => null,
  getRateLimitIdentifier: () => 'test',
  checkRateLimitSecure: async () => ({ success: true }),
}));

const mockFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
global.fetch = mockFetch as unknown as typeof fetch;

const { POST } = await import('./route');
const SECRET = 'webhook-secret';
const CANARY = 'WEBHOOKCANARY private message text';

const post = (body: unknown, secret: string | null = SECRET) => POST(createMockRequest('POST', '/api/telegram/webhook', {
  body, headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {},
}));
const payment = (payload: unknown, total_amount: number, currency = 'USD') => ({
  message: { from: { id: 42 }, chat: { id: 42 }, successful_payment: {
    invoice_payload: typeof payload === 'string' ? payload : JSON.stringify(payload), total_amount, currency,
    telegram_payment_charge_id: 'tg-1', provider_payment_charge_id: 'pp-1',
  } },
});
const preCheckout = (payload: unknown, total_amount: number, currency = 'USD') => ({
  pre_checkout_query: { id: 'q1', from: { id: 42 }, invoice_payload: JSON.stringify(payload), total_amount, currency },
});
const answered = () => JSON.parse(String((mockFetch.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body));

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('TELEGRAM_WEBHOOK_FAIL_CLOSED', '');
  set.mockClear(); doc.mockClear(); mockFetch.mockClear();
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('POST /api/telegram/webhook payments', () => {
  it('grants the plan a known price paid in full', async () => {
    await post(payment({ priceId: 'max_annual', userId: 'uid-1' }, 29999));
    expect(doc).toHaveBeenCalledWith('uid-1');
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ tier: 'max', priceId: 'max_annual', status: 'active', amount: 29999, currency: 'USD' }), { merge: true });
  });

  it('grants nothing when the amount, currency or price does not match the price table', async () => {
    await post(payment({ priceId: 'max_annual', userId: 'uid-1' }, 1, 'XTR'));
    await post(payment({ priceId: 'max_annual', userId: 'uid-1' }, 999));
    await post(payment({ priceId: 'max_annual', userId: 'uid-1' }, 29999, 'EUR'));
    await post(payment({ priceId: 'max_lifetime', userId: 'uid-1' }, 29999));
    await post(payment({ priceId: 'pro_monthly' }, 999));
    await post(payment({ priceId: 'pro_monthly', userId: 'uid-1/data' }, 999));
    await post(payment('not json', 999));
    expect(set).not.toHaveBeenCalled();
  });

  it('declines a pre-checkout query whose amount does not match its price, and approves one that does', async () => {
    await post(preCheckout({ priceId: 'max_annual', userId: 'uid-1' }, 1));
    expect(answered()).toMatchObject({ pre_checkout_query_id: 'q1', ok: false });
    await post(preCheckout({ priceId: 'pro_monthly', userId: 'uid-1' }, 999));
    expect(answered()).toEqual({ pre_checkout_query_id: 'q1', ok: true });
  });

  it('rejects a request with the wrong secret before reading it', async () => {
    const response = await post(payment({ priceId: 'pro_monthly', userId: 'uid-1' }, 999), 'wrong');
    expect(response.status).toBe(403);
    expect(set).not.toHaveBeenCalled();
  });

  it('never logs the update body, its message text or the invoice payload', async () => {
    await post({ message: { from: { id: 42 }, chat: { id: 42 }, text: CANARY } });
    await post(payment({ priceId: 'pro_monthly', userId: 'uid-1', note: CANARY }, 999));
    await post(payment(CANARY, 999));
    await post(preCheckout({ priceId: 'pro_monthly', userId: 'uid-1', note: CANARY }, 999));
    const logged = JSON.stringify(logs.map((spy) => spy.mock.calls));
    expect(logged).toContain('telegram_webhook:'); // positive control: the route did log
    expect(logged).not.toContain('WEBHOOKCANARY');
    expect(logged).not.toContain('uid-1');
  });
});
