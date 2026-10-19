import { describe, expect, it, vi } from 'vitest';
import { isPublicAddress, SafeProviderTransport } from '../transport';

describe('independent transport adversarial checks (injected DNS/wire only)', () => {
  it('does not transmit an external effect after its total deadline expires during DNS', async () => {
    vi.useFakeTimers();
    try {
      let resolveDns!: (addresses: { address: string; family: number }[]) => void;
      const dns = new Promise<{ address: string; family: number }[]>(resolve => { resolveDns = resolve; });
      const send = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, bytes: new TextEncoder().encode('{}') }));
      const transport = new SafeProviderTransport({ resolve: () => dns, send });
      const request = transport.request({ profileId: 'github-api', method: 'POST', path: '/repos/qa/fixture/issues', body: { title: 'synthetic' }, timeoutMs: 100 },
        { providerId: 'github', endpointProfileId: 'github-api', accessToken: 'SYNTHETIC_NO_PROVIDER_CREDENTIAL' });
      const rejected = expect(request).rejects.toMatchObject({ code: 'provider_timeout' });
      await vi.advanceTimersByTimeAsync(101); await rejected;
      resolveDns([{ address: '93.184.216.34', family: 4 }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(send).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::'])
    ('refuses special-use address %s before credential-bearing transmission', address => {
      expect(isPublicAddress(address)).toBe(false);
    });

  it.each(['2001::1', '2001:2::1', '2001:10::1', '2001:20::1', '3fff::1', '192.88.99.1'])
    ('denies transition/benchmark/ORCHID/documentation special-use destination %s', address => {
      expect(isPublicAddress(address)).toBe(false);
    });

  it('checks every DNS answer and never follows a provider redirect with credentials', async () => {
    const send = vi.fn(async () => ({ status: 302, headers: { location: 'https://unreviewed.example.invalid' }, bytes: new Uint8Array() }));
    const credential = { providerId: 'github', endpointProfileId: 'github-api', accessToken: 'SYNTHETIC_NO_PROVIDER_CREDENTIAL' };
    const mixed = new SafeProviderTransport({ resolve: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }], send });
    await expect(mixed.request({ profileId: 'github-api', method: 'GET', path: '/repos/qa/fixture' }, credential))
      .rejects.toMatchObject({ code: 'provider_address_denied', outcome: 'not_dispatched' });
    expect(send).not.toHaveBeenCalled();
    const publicOnly = new SafeProviderTransport({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], send });
    await expect(publicOnly.request({ profileId: 'github-api', method: 'GET', path: '/repos/qa/fixture' }, credential))
      .rejects.toMatchObject({ code: 'provider_redirect_denied' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 200, headers: { 'content-type': 'text/html' } },
    { status: 200, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } },
    { status: 302, headers: { 'content-type': 'application/json' } },
  ])('keeps a dispatched write outcome unknown when its response cannot prove the effect: %j', async response => {
    const transport = new SafeProviderTransport({ resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      send: async () => ({ ...response, headers: response.headers as Record<string, string>, bytes: new TextEncoder().encode('{}') }) });
    await expect(transport.request({ profileId: 'github-api', method: 'POST', path: '/repos/qa/fixture/issues', body: { title: 'synthetic' } },
      { providerId: 'github', endpointProfileId: 'github-api', accessToken: 'SYNTHETIC_NO_PROVIDER_CREDENTIAL' }))
      .rejects.toMatchObject({ outcome: 'unknown' });
  });
});
