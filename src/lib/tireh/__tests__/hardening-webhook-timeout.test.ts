/**
 * F221: the legacy webhook's Telegram Bot API calls carry an 8 s deadline, so a hung call cannot hold the
 * route past Telegram's 10 s pre-checkout window. Offline: fetch is a stub, the deadline a controlled signal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest } from '@/test/utils';

const set = vi.fn(async () => undefined);
vi.mock('@/lib/firebase-admin', () => ({ getAdminDb: async () => ({ collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ set }) }) }) }) }) }));
vi.mock('@/lib/ratelimit', () => ({
  getWebhookRateLimiter: () => null,
  getRateLimitIdentifier: () => 'test',
  checkRateLimitSecure: async () => ({ success: true }),
}));

const { POST } = await import('@/app/api/telegram/webhook/route');
const SECRET = 'webhook-secret';

const post = (body: unknown) => POST(createMockRequest('POST', '/api/telegram/webhook', {
  body, headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
}));
const preCheckout = { pre_checkout_query: { id: 'q1', from: { id: 42 }, invoice_payload: JSON.stringify({ priceId: 'pro_monthly', userId: 'uid-1' }), total_amount: 999, currency: 'USD' } };
const payment = { message: { from: { id: 42 }, chat: { id: 42 }, successful_payment: {
  invoice_payload: JSON.stringify({ priceId: 'pro_monthly', userId: 'uid-1' }), total_amount: 999, currency: 'USD',
  telegram_payment_charge_id: 'tg-1', provider_payment_charge_id: 'pp-1',
} } };
const start = { message: { from: { id: 42 }, chat: { id: 42 }, text: '/start' } };

type FetchArgs = [string, RequestInit];

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('TELEGRAM_WEBHOOK_FAIL_CLOSED', '');
  set.mockClear();
  for (const level of ['log', 'info', 'warn'] as const) vi.spyOn(console, level).mockImplementation(() => undefined);
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('F221: webhook Telegram calls have a deadline', () => {
  it('passes an 8 s AbortSignal to answerPreCheckoutQuery and to both sendMessage calls', async () => {
    const fetchMock = vi.fn(async (..._args: FetchArgs) => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await post(preCheckout);
    await post(payment);
    await post(start);
    const calls = fetchMock.mock.calls.map(([url, init]) => ({ method: url.split('/').at(-1), signal: init.signal }));
    expect(calls.map((c) => c.method)).toEqual(['answerPreCheckoutQuery', 'sendMessage', 'sendMessage']);
    for (const call of calls) expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(timeout.mock.calls).toEqual([[8000], [8000], [8000]]);
    expect(set).toHaveBeenCalledTimes(1); // positive control: the payment was granted
  });

  it('a hung answerPreCheckoutQuery is abandoned at the deadline and the route still answers 200', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      expect(ms).toBe(8000);
      return deadline.signal;
    });
    // Telegram never answers: the fetch settles only when its signal aborts.
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    let settled = false;
    const response = post(preCheckout).then((r) => { settled = true; return r; });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    // AbortSignal.timeout's reason is a TimeoutError (an Error subclass in Node; jsdom's DOMException is not).
    deadline.abort(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    const result = await response;
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ success: true });
    // The existing content-free error path: a fixed code and the error name only.
    expect(errors.mock.calls).toEqual([['telegram_webhook:error', 'TimeoutError']]);
  });
});
