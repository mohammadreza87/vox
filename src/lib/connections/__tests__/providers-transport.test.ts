import { describe, expect, it, vi } from 'vitest';
import { isPublicAddress, SafeProviderTransport, ProviderError, type PinnedRequest, type WireResponse } from '../transport';
const credential = { providerId: 'github', endpointProfileId: 'github-api', accessToken: 'synthetic-token' };
const bytes = (body: unknown) => new TextEncoder().encode(JSON.stringify(body));
const response: WireResponse = { status: 200, headers: { 'content-type': 'application/json' }, bytes: bytes({ ok: true }) };
function transport(overrides: Partial<{ resolve: () => Promise<{ address: string; family: number }[]>; send: (input: PinnedRequest) => Promise<WireResponse> }> = {}) {
  const requests: PinnedRequest[] = [];
  return { requests, transport: new SafeProviderTransport({ resolve: overrides.resolve ?? (async () => [{ address: '93.184.216.34', family: 4 }]), send: overrides.send ?? (async input => { requests.push(input); return response; }) }) };
}
describe('provider network boundary', () => {
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '172.16.0.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.2', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001::1', '2001:0000:abcd::1', '2001:0db8::1', '2001:20::1', '2002:7f00:1::', '3fff::1'])('rejects special-use address %s', address => expect(isPublicAddress(address)).toBe(false));
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'])('allows public address %s', address => expect(isPublicAddress(address)).toBe(true));
  it('pins actual send address to checked DNS and scopes secret to provider profile', async () => {
    const { transport: client, requests } = transport(); const result = await client.request({ profileId: 'github-api', method: 'GET', path: '/user' }, credential);
    expect(result.body).toEqual({ ok: true }); expect(requests[0].address).toBe('93.184.216.34'); expect(requests[0].url.hostname).toBe('api.github.com'); expect(requests[0].headers.authorization).toBe('Bearer synthetic-token');
    await expect(client.request({ profileId: 'notion-api', method: 'GET', path: '/v1/users/me' }, credential)).rejects.toMatchObject({ code: 'credential_profile_mismatch', outcome: 'not_dispatched' }); expect(requests).toHaveLength(1);
  });
  it('rejects mixed DNS answers before any connection and never retries', async () => {
    let sends = 0; const { transport: client } = transport({ resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], send: async () => { sends++; return response; } });
    await expect(client.request({ profileId: 'github-api', method: 'GET', path: '/user' }, credential)).rejects.toMatchObject({ code: 'provider_address_denied' }); expect(sends).toBe(0);
  });
  it.each(['//evil.example/x', '/%2e%2e/x', '/\\evil.example', '/ok#fragment', '/ok\r\nInjected: yes', '/../secret', '/%2fsecret'])('rejects path injection %s', async path => {
    const { transport: client, requests } = transport(); await expect(client.request({ profileId: 'github-api', method: 'GET', path }, credential)).rejects.toMatchObject({ code: 'provider_path_invalid' }); expect(requests).toHaveLength(0);
  });
  it('does not permit model/caller headers or a credential with newline', async () => {
    const { transport: client, requests } = transport();
    await expect(client.request({ profileId: 'github-api', method: 'GET', path: '/user', headers: { authorization: 'secret' } }, credential)).rejects.toMatchObject({ code: 'provider_header_denied' });
    await expect(client.request({ profileId: 'github-api', method: 'GET', path: '/user' }, { ...credential, accessToken: 'secret\r\nheader' })).rejects.toMatchObject({ outcome: 'not_dispatched' }); expect(requests).toHaveLength(0);
  });
  it('requires explicit internal registration with exact address pins', async () => {
    const profile = { id: 'internal-review', providerId: 'github', origin: 'https://registered.internal', internalAddresses: ['10.0.0.7'] };
    const sent: PinnedRequest[] = []; const client = new SafeProviderTransport({ profiles: [profile], resolve: async () => [{ address: '10.0.0.7', family: 4 }], send: async input => { sent.push(input); return response; } });
    await client.request({ profileId: profile.id, method: 'GET', path: '/selected' }, { ...credential, endpointProfileId: profile.id }); expect(sent[0].address).toBe('10.0.0.7');
    const bad = new SafeProviderTransport({ profiles: [profile], resolve: async () => [{ address: '10.0.0.8', family: 4 }], send: async () => { throw new Error('must not send'); } });
    await expect(bad.request({ profileId: profile.id, method: 'GET', path: '/selected' }, { ...credential, endpointProfileId: profile.id })).rejects.toMatchObject({ code: 'provider_address_denied' });
  });
  it('includes DNS in deadline and never sends after DNS resolves late', async () => {
    vi.useFakeTimers(); let finish!: (value: { address: string; family: number }[]) => void; let sends = 0;
    const { transport: client } = transport({ resolve: () => new Promise(resolve => { finish = resolve; }), send: async () => { sends++; return response; } });
    const pending = client.request({ profileId: 'github-api', method: 'POST', path: '/repos/o/r/issues', timeoutMs: 100 }, credential);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'provider_timeout', outcome: 'unknown' });
    await vi.advanceTimersByTimeAsync(101); await assertion; finish([{ address: '8.8.8.8', family: 4 }]); await Promise.resolve(); expect(sends).toBe(0); vi.useRealTimers();
  });
  it.each([
    { status: 302, headers: { 'content-type': 'application/json' }, bytes: bytes({}) },
    { status: 200, headers: { 'content-type': 'text/html' }, bytes: bytes({}) },
    { status: 200, headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, bytes: bytes({}) },
    { status: 200, headers: { 'content-type': 'application/json' }, bytes: new TextEncoder().encode('{bad') },
  ])('treats an unusable dispatched write response as unknown', async wire => {
    let calls = 0; const { transport: client } = transport({ send: async () => { calls++; return wire; } });
    await expect(client.request({ profileId: 'github-api', method: 'POST', path: '/repos/o/r/issues' }, credential)).rejects.toMatchObject({ outcome: 'unknown' }); expect(calls).toBe(1);
  });
  it('normalizes errors without secrets/provider bodies and exposes bounded rate metadata only', async () => {
    let calls = 0; const { transport: client } = transport({ send: async () => { calls++; return { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '7200' }, bytes: bytes({ error: 'synthetic-token must not escape' }) }; } });
    try { await client.request({ profileId: 'github-api', method: 'GET', path: '/user' }, credential); throw new Error('expected failure'); } catch (error) {
      expect(error).toBeInstanceOf(ProviderError); expect(error).toMatchObject({ code: 'provider_rate_limited', retryAfterSeconds: 3600 }); expect(String(error)).not.toContain('synthetic-token');
    }
    expect(calls).toBe(1);
  });
});
