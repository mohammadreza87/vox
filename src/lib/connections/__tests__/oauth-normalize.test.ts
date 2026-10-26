import { describe, expect, it, vi } from 'vitest';
import { PinnedOAuthTransport, type OAuthProfile } from '../broker/oauth';
import type { WireResponse } from '../transport';

/** Pins how the token response's `scope` becomes the credential's granted scopes (unchanged behaviour: a present but empty
 * `scope` already gave no scopes, since [] is not nullish). Guards the S1 GitHub App path against a regression. All traffic is synthetic. */
const github: OAuthProfile = { providerId: 'github', issuer: 'https://github.com', authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token', clientId: 'SYNTHETIC_CLIENT', clientSecret: 'SYNTHETIC_SECRET',
  callbackUrl: 'https://vox-qa.example.invalid/oauth/callback/github', scopes: ['repo', 'read:user'] };
function transport(body: Record<string, unknown>) {
  const send = vi.fn(async (): Promise<WireResponse> => ({ status: 200, headers: { 'content-type': 'application/json' },
    bytes: new TextEncoder().encode(JSON.stringify({ access_token: 'SYNTHETIC_ACCESS', token_type: 'bearer', ...body })) }));
  return { send, oauth: new PinnedOAuthTransport({ send, resolve: async () => [{ address: '140.82.112.3', family: 4 }], now: () => 1_000 }) };
}

describe('OAuth token normalize: granted scopes', () => {
  it('an empty scope (a GitHub App user token) grants no OAuth scopes, never the requested ones', async () => {
    expect((await transport({ scope: '' }).oauth.exchange(github, 'code', 'verifier')).scopes).toEqual([]);
    expect((await transport({ scope: '  ' }).oauth.refresh(github, 'refresh')).scopes).toEqual([]);
  });

  it('a missing scope keeps the RFC 6749 fallback: the requested scopes', async () => {
    expect((await transport({}).oauth.exchange(github, 'code', 'verifier')).scopes).toEqual(['repo', 'read:user']);
  });

  it('space or comma separated scopes are kept, and a scope never requested is refused', async () => {
    expect((await transport({ scope: 'repo,read:user' }).oauth.exchange(github, 'code', 'verifier')).scopes).toEqual(['repo', 'read:user']);
    expect((await transport({ scope: 'repo' }).oauth.exchange(github, 'code', 'verifier')).scopes).toEqual(['repo']);
    await expect(transport({ scope: 'repo admin:org' }).oauth.exchange(github, 'code', 'verifier')).rejects.toMatchObject({ code: 'oauth_scope_expansion_denied' });
  });

  it('expiry comes from expires_in against the injected clock', async () => {
    const token = await transport({ scope: 'repo', expires_in: 60, refresh_token: 'SYNTHETIC_REFRESH' }).oauth.exchange(github, 'code', 'verifier');
    expect(token).toEqual({ accessToken: 'SYNTHETIC_ACCESS', refreshToken: 'SYNTHETIC_REFRESH', expiresAt: 61_000, scopes: ['repo'] });
  });
});
