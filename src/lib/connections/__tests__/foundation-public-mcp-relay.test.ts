import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Studio } from '../../studio/service';
import { handlePublicMcpCallback, handlePublicMcpClientMetadata } from '../runtime';
const metadata = () => ({ client_id: 'https://vox.fixture.net/oauth/client-metadata.json', client_name: 'Vox agent connections', redirect_uris: ['https://vox.fixture.net/oauth/callback/remote_mcp'],
  grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
let studio: Studio; let callback: ReturnType<typeof vi.fn>; let readMetadata: ReturnType<typeof vi.fn>;
beforeEach(() => {
  callback = vi.fn(async () => ({ status: 'pending', reason: 'return_to_authenticated_bot' })); readMetadata = vi.fn(async () => metadata());
  studio = { deps: { rateLimiter: { consume: vi.fn() } } } as unknown as Studio;
  const runtime = (globalThis as unknown as { __voxConnectionsRuntime: WeakMap<Studio, Promise<unknown>> }).__voxConnectionsRuntime;
  runtime.set(studio, Promise.resolve({ publicMcpRelay: { callback, metadata: readMetadata } }));
});
describe('public OAuth callback and client metadata relay', () => {
  it('forwards only bounded query values and never reflects an authorization code/state or activates access', async () => {
    const res = await handlePublicMcpCallback(studio, new Request('https://vox.fixture.net/oauth/callback/remote_mcp?state=SYNTHETIC_STATE_CANARY&code=SYNTHETIC_CODE_CANARY&iss=https%3A%2F%2Fauth.fixture.net%2F'));
    expect(res.status).toBe(200); expect(callback).toHaveBeenCalledExactlyOnceWith({ state: 'SYNTHETIC_STATE_CANARY', code: 'SYNTHETIC_CODE_CANARY', iss: 'https://auth.fixture.net/' });
    const html = await res.text(); expect(html).not.toContain('CANARY'); expect(html).toContain('No agent access has been granted');
    expect(res.headers.get('cache-control')).toBe('no-store'); expect(res.headers.get('referrer-policy')).toBe('no-referrer'); expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
  it.each(['state=a&state=b&code=x', 'state=a&provider=https://attacker.test', `state=a&code=${'x'.repeat(3001)}`])('rejects ambiguous callback data before relay', async query => {
    const res = await handlePublicMcpCallback(studio, new Request(`https://vox.fixture.net/oauth/callback/remote_mcp?${query}`)); expect(res.status).toBe(400); expect(callback).not.toHaveBeenCalled();
  });
  it('returns only exact public client metadata with one matching callback URI', async () => {
    const res = await handlePublicMcpClientMetadata(studio); expect(res.status).toBe(200); expect(await res.json()).toEqual(metadata());
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('refuses an internal metadata bug exposing a secret or a mismatched resource path', async () => {
    readMetadata.mockResolvedValueOnce({ ...metadata(), client_secret: 'SYNTHETIC_PRIVATE_CLIENT_CANARY' });
    let res = await handlePublicMcpClientMetadata(studio); expect(res.status).toBe(503); expect(await res.text()).not.toContain('CANARY');
    readMetadata.mockResolvedValueOnce({ ...metadata(), redirect_uris: ['https://attacker.fixture.net/oauth/callback/remote_mcp'] });
    res = await handlePublicMcpClientMetadata(studio); expect(res.status).toBe(503);
  });
});
