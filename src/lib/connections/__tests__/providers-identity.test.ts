import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ProviderIdentityQualifier, type IdentityAdmission } from '../broker/provider-identity';
import type { ProviderHttpRequest, ProviderTransport } from '../transport';
const bot = '10000000-0000-4000-8000-000000000001';
const tenant = '10000000-0000-4000-8000-000000000002';
const game = '10000000-0000-4000-8000-000000000003';
const env = '10000000-0000-4000-8000-000000000004';
const grant = '10000000-0000-4000-8000-000000000005';
const now = Date.parse('2026-10-19T00:00:00Z');
const token = 'synthetic-identity-token';
const gamendContext = { organizationId: tenant, organization: { id: tenant }, grant: { id: grant, orgId: tenant, ownerAdminId: bot, name: 'Synthetic delegated account', gameIds: [game], environmentIds: [env], scopes: ['analytics:read', 'tenancy:read'], operationIds: ['GameTimezoneController_get'], revokedAt: null, expiresAt: '2026-11-19T00:00:00.000Z' }, games: [{ id: game }], environments: [{ id: env, gameId: game }], protocolVersions: ['2026-07-28'] };
const gamendRpc = (data = gamendContext) => ({ jsonrpc: '2.0', id: 'vox-identity', result: { isError: false, structuredContent: data } });
function setup(responses: unknown[], admissions: IdentityAdmission[] = []) {
  const requests: ProviderHttpRequest[] = [];
  const transport: ProviderTransport = { async request(request, credential) { requests.push(request); expect(credential.accessToken).toBe(token); expect(credential.endpointProfileId).toBe(request.profileId); if (!responses.length) throw new Error('unexpected extra request'); return { status: 200, headers: {}, body: responses.shift() }; } };
  return { requests, qualifier: new ProviderIdentityQualifier({ transport, admissions, now: () => now }) };
}
describe('provider identity qualification from authenticated API responses', () => {
  it.each([
    { provider: 'github', response: { id: 42, login: 'fixture', name: 'Synthetic GitHub', email: 'must-not-escape' }, subject: '42', tenant: '42', path: '/user' },
    { provider: 'forgejo', response: { id: 42, login: 'fixture', full_name: 'Synthetic Forgejo', email: 'must-not-escape' }, subject: '42', tenant: '42', path: '/api/v1/user' },
    { provider: 'notion', response: { object: 'user', type: 'bot', id: bot, name: 'Synthetic Notion', bot: { workspace_id: tenant, workspace_name: 'Synthetic workspace', owner: { user: { email: 'must-not-escape' } } } }, subject: bot, tenant, path: '/v1/users/me' },
    { provider: 'slack', response: { ok: true, user_id: 'U123456789', team_id: 'T123456789', user: 'Synthetic Slack', url: 'must-not-escape' }, subject: 'U123456789', tenant: 'T123456789', path: '/api/auth.test' },
    { provider: 'figma', response: { id: '42', handle: 'Synthetic Figma', email: 'must-not-escape' }, subject: '42', tenant: '42', path: '/v1/me' },
    ...['google_drive', 'google_docs', 'google_sheets', 'google_slides', 'gmail', 'google_analytics'].map(provider => ({ provider, response: { sub: 'stable-google-subject', name: 'Synthetic Google', email: 'must-not-escape', hd: 'not-a-stable-tenant' }, subject: 'stable-google-subject', tenant: 'stable-google-subject', path: '/v1/userinfo' })),
  ])('$provider takes subject/tenant only from verified API identity fields', async fixture => {
    const { qualifier, requests } = setup([fixture.response]); const result = await qualifier.qualify(fixture.provider, token);
    expect(result.identity.subject).toBe(fixture.subject); expect(result.identity.tenant).toBe(fixture.tenant); expect(requests[0].path).toBe(fixture.path);
    expect(result.evidence.providerSubjectVerified).toBe(true); expect(result.evidence.writeCapability).toBe('unavailable'); expect(result.evidence.verifiedScopes).toBe(null);
    expect(JSON.stringify(result)).not.toContain('must-not-escape'); expect(JSON.stringify(result)).not.toContain(token);
    if (fixture.provider === 'notion') { expect(result.evidence.identityKind).toBe('integration_bot'); expect(requests[0].headers).toEqual({ 'notion-version': '2026-03-11' }); }
  });
  it('never replaces missing Notion workspace identity with its label or bot/person owner', async () => {
    const { qualifier } = setup([{ object: 'user', type: 'bot', id: bot, name: 'Synthetic', bot: { workspace_name: tenant, owner: { user: { id: tenant } } } }]);
    await expect(qualifier.identity('notion', token)).rejects.toMatchObject({ code: 'provider_identity_invalid' });
  });
  it('rejects Slack errors, unsupported enterprise-only identity and mutable/invalid identifiers', async () => {
    for (const response of [{ ok: false, user_id: 'U123456789', team_id: 'T123456789' }, { ok: true, user_id: 'U123456789', enterprise_id: 'E123456789' }, { ok: true, user_id: 'https://evil.example', team_id: 'T123456789' }]) {
      const { qualifier } = setup([response]); await expect(qualifier.identity('slack', token)).rejects.toMatchObject({ code: 'provider_identity_invalid' });
    }
  });
  it('qualifies a Hetzner credential only against exact reviewed server IDs without inventing a provider account/project', async () => {
    const { qualifier, requests } = setup([{ server: { id: 5, name: 'must-not-escape', public_net: { private: 'must-not-escape' } } }], [{ providerId: 'hetzner', kind: 'credential_resource', serverIds: [5] }]);
    const result = await qualifier.qualify('hetzner', token); const hash = createHash('sha256').update(token).digest('hex');
    expect(result.identity.subject).toBe(`credential:${hash}`); expect(result.identity.tenant).toBe(`credential_scope:${hash}`);
    expect(result.identity.displayLabel).toContain('account and project ID unavailable'); expect(result.evidence).toMatchObject({ identityKind: 'credential_resource', providerSubjectVerified: false, providerTenantVerified: false, resourceAccess: ['hetzner:server:5'], writeCapability: 'unavailable' });
    expect(requests[0].path).toBe('/v1/servers/5'); expect(JSON.stringify(result)).not.toContain('must-not-escape');
    const missing = setup([]); await expect(missing.qualifier.identity('hetzner', token)).rejects.toMatchObject({ code: 'provider_identity_admission_required' }); expect(missing.requests).toHaveLength(0);
  });
  it('refuses a Hetzner resource response substituting another server', async () => {
    const { qualifier } = setup([{ server: { id: 6 } }], [{ providerId: 'hetzner', kind: 'credential_resource', serverIds: [5] }]);
    await expect(qualifier.identity('hetzner', token)).rejects.toMatchObject({ code: 'provider_identity_invalid' });
  });
  it('qualifies PostHog authenticated user and exact project in its admitted region, stripping nested project secrets', async () => {
    const { qualifier, requests } = setup([{ uuid: bot, first_name: 'Synthetic', last_name: 'User', team: { api_token: 'must-not-escape' } }, { id: 7, organization: tenant, api_token: 'must-not-escape' }], [{ providerId: 'posthog', kind: 'user_project', region: 'eu', projectId: '7' }]);
    const result = await qualifier.qualify('posthog', token); expect(result.identity).toMatchObject({ subject: bot, tenant: '7', issuer: 'https://eu.posthog.com' });
    expect(requests.map(r => r.profileId)).toEqual(['posthog-eu-identity', 'posthog-eu-identity']); expect(requests.map(r => r.path)).toEqual(['/api/users/@me/', '/api/projects/7/']); expect(JSON.stringify(result)).not.toContain('must-not-escape');
  });
  it('supports scoped PostHog insight credentials without requiring broad user/project reads or asserting a user identity', async () => {
    const { qualifier, requests } = setup([{ id: 8, name: 'must-not-escape', result: [{ person: 'must-not-escape' }] }], [{ providerId: 'posthog', kind: 'credential_resource', region: 'us', projectId: '7', insightIds: ['8'] }]);
    const result = await qualifier.qualify('posthog', token); expect(result.identity.subject).toMatch(/^credential:[a-f0-9]{64}$/); expect(result.identity.tenant).toBe('project:7');
    expect(result.evidence.providerSubjectVerified).toBe(false); expect(result.evidence.resourceAccess).toEqual(['posthog:project:7:insight:8']); expect(requests[0].path).toBe('/api/projects/7/insights/8/'); expect(JSON.stringify(result)).not.toContain('must-not-escape');
  });
  it('denies PostHog impersonation, project substitution and arbitrary regional endpoints', async () => {
    const impersonated = setup([{ uuid: bot, is_impersonated: true }], [{ providerId: 'posthog', kind: 'user_project', region: 'eu', projectId: '7' }]); await expect(impersonated.qualifier.identity('posthog', token)).rejects.toMatchObject({ code: 'provider_identity_impersonation_denied' });
    const swapped = setup([{ uuid: bot }, { id: 8, organization: tenant }], [{ providerId: 'posthog', kind: 'user_project', region: 'eu', projectId: '7' }]); await expect(swapped.qualifier.identity('posthog', token)).rejects.toMatchObject({ code: 'provider_identity_scope_mismatch' });
    expect(() => setup([], [{ providerId: 'posthog', kind: 'user_project', region: 'internal', projectId: '7' } as never])).toThrow();
  });
  it('qualifies GitHub installation-style credentials through exact repository access without fabricating installation ID', async () => {
    const { qualifier, requests } = setup([{ id: 1, full_name: 'Example/Synthetic', owner: { id: 42 }, permissions: { admin: false, push: true }, secret: 'must-not-escape' }], [{ providerId: 'github', kind: 'credential_resource', repositories: [{ owner: 'example', repository: 'synthetic' }] }]);
    const result = await qualifier.qualify('github', token); expect(requests[0].path).toBe('/repos/example/synthetic'); expect(result.identity.subject).toMatch(/^credential:/); expect(result.identity.tenant).toBe('repository_owner:42'); expect(result.identity.displayLabel).toContain('installation ID unavailable'); expect(result.evidence.writeCapability).toBe('unavailable'); expect(JSON.stringify(result)).not.toContain('must-not-escape');
  });
  it('qualifies native Gamend person/org and exact current delegated game/environment, preserving actual grant scope evidence', async () => {
    const { qualifier, requests } = setup([gamendRpc()], [{ providerId: 'gamend', kind: 'native_delegation', orgId: tenant, gameId: game, envId: env }]);
    const result = await qualifier.qualify('gamend', token); expect(result.identity).toMatchObject({ subject: bot, tenant, issuer: 'https://gamend.joyixir.com' }); expect(result.evidence).toMatchObject({ identityKind: 'native_delegation', verifiedScopes: ['analytics:read', 'tenancy:read'], permittedNativeOperationIds: ['GameTimezoneController_get'], resourceAccess: [`gamend:org:${tenant}:game:${game}:env:${env}`], writeCapability: 'unavailable' });
    expect(requests[0].path).toBe('/v1/mcp'); expect(requests[0].headers).toMatchObject({ 'mcp-protocol-version': '2026-07-28', 'mcp-name': 'gamend_context' });
  });
  it.each([
    { ...gamendContext, organizationId: game },
    { ...gamendContext, grant: { ...gamendContext.grant, revokedAt: '2026-10-01' } },
    { ...gamendContext, grant: { ...gamendContext.grant, expiresAt: '2026-10-01T00:00:00.000Z' } },
    { ...gamendContext, grant: { ...gamendContext.grant, gameIds: [tenant] } },
    { ...gamendContext, environments: [{ id: env, gameId: tenant }] },
    { ...gamendContext, protocolVersions: ['2025-03-26'] },
  ])('rejects stale or substituted Gamend delegation', async response => {
    const { qualifier } = setup([gamendRpc(response)], [{ providerId: 'gamend', kind: 'native_delegation', orgId: tenant, gameId: game, envId: env }]); await expect(qualifier.identity('gamend', token)).rejects.toMatchObject({ code: 'provider_identity_scope_mismatch' });
  });
  it('never enrolls browser/SSH from a bearer token or calls a missing provider endpoint', async () => {
    const { qualifier, requests } = setup([]); for (const provider of ['browser', 'ssh']) await expect(qualifier.identity(provider, token)).rejects.toMatchObject({ code: 'runner_identity_requires_attestation', outcome: 'not_dispatched' });
    await expect(qualifier.identity('unknown', token)).rejects.toMatchObject({ code: 'provider_identity_unavailable' }); expect(requests).toHaveLength(0);
  });
  it('rejects malformed tokens before network and any provider identity that echoes the credential', async () => {
    const { qualifier, requests } = setup([]); await expect(qualifier.identity('github', 'bad\r\nsecret')).rejects.toMatchObject({ code: 'provider_credential_invalid', outcome: 'not_dispatched' }); expect(requests).toHaveLength(0);
    const echoed = setup([{ id: 42, login: token }]); await expect(echoed.qualifier.identity('github', token)).rejects.toMatchObject({ code: 'provider_identity_invalid' });
  });
});
