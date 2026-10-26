import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const offline = vi.hoisted(() => ({
  fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>(),
  initialize: vi.fn(),
}));

// Exercise the installed SDK's real serialization and headers. Only its transport
// is replaced, so these tests cannot open a socket or reach a payment provider.
vi.mock('stripe', async (importOriginal) => {
  const { default: Stripe } = await importOriginal<typeof import('stripe')>();
  return {
    default: class extends Stripe {
      constructor(key: string, config: Stripe.StripeConfig) {
        super(key, { ...config, httpClient: Stripe.createFetchHttpClient(offline.fetch) });
        offline.initialize(config);
      }
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_offline_synthetic');
  offline.fetch.mockReset();
  offline.initialize.mockReset();
  offline.fetch.mockImplementation(async () => new Response(JSON.stringify({ id: 'synthetic_id', object: 'customer' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe('Stripe SDK compatibility with the pinned wire API', () => {
  it('stays lazy, reuses its client and preserves the API version on actual serialized requests', async () => {
    const { getStripe, getOrCreateCustomer, stripe } = await import('./stripe');
    expect(offline.initialize).not.toHaveBeenCalled();
    expect(offline.fetch).not.toHaveBeenCalled();
    expect(getStripe()).toBe(getStripe());
    expect(offline.initialize).toHaveBeenCalledExactlyOnceWith({ apiVersion: '2025-11-17.clover', typescript: true });

    expect(await getOrCreateCustomer('synthetic_user', 'synthetic@example.invalid')).toBe('synthetic_id');
    await stripe.checkout.sessions.create({
      customer: 'cus_synthetic', mode: 'subscription',
      payment_method_types: ['card'], line_items: [{ price: 'price_synthetic', quantity: 1 }],
      success_url: 'https://example.invalid/success', cancel_url: 'https://example.invalid/cancel',
      metadata: { firebaseUserId: 'synthetic_user' },
      subscription_data: { metadata: { firebaseUserId: 'synthetic_user' } },
      allow_promotion_codes: true,
    });
    await stripe.billingPortal.sessions.create({ customer: 'cus_synthetic', return_url: 'https://example.invalid/return' });
    await stripe.subscriptions.retrieve('sub_synthetic');

    expect(offline.fetch).toHaveBeenCalledTimes(4);
    const requests = offline.fetch.mock.calls.map(([url, init]) => ({
      url, init, headers: new Headers(init.headers), body: new URLSearchParams(String(init.body ?? '')),
    }));
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/v1/customers', '/v1/checkout/sessions', '/v1/billing_portal/sessions', '/v1/subscriptions/sub_synthetic',
    ]);
    for (const { headers } of requests) {
      expect(headers.get('stripe-version')).toBe('2025-11-17.clover');
    }
    expect(requests.map(({ init }) => init.method)).toEqual(['POST', 'POST', 'POST', 'GET']);
    expect(requests[0].body.get('metadata[firebaseUserId]')).toBe('synthetic_user');
    expect(requests[1].body.get('line_items[0][price]')).toBe('price_synthetic');
    expect(requests[1].body.get('subscription_data[metadata][firebaseUserId]')).toBe('synthetic_user');
    expect(requests[2].body.get('return_url')).toBe('https://example.invalid/return');
  });

  it('reuses an existing customer without a provider request', async () => {
    const { getOrCreateCustomer } = await import('./stripe');
    expect(await getOrCreateCustomer('synthetic_user', 'synthetic@example.invalid', 'cus_existing')).toBe('cus_existing');
    expect(offline.fetch).not.toHaveBeenCalled();
  });
});
