import { describe, expect, it, vi } from 'vitest';
import { ProviderIdentityQualifier, type IdentityAdmission } from '../broker/provider-identity';
import type { ProviderHttpRequest } from '../transport';

const TOKEN = 'SYNTHETIC_IDENTITY_CREDENTIAL_475';
const UUID = { org: '00000000-0000-4000-8000-000000000001', game: '00000000-0000-4000-8000-000000000002',
  env: '00000000-0000-4000-8000-000000000003', person: '00000000-0000-4000-8000-000000000004', grant: '00000000-0000-4000-8000-000000000005' };
function fixture(body: unknown | ((request: ProviderHttpRequest) => unknown), admissions: readonly IdentityAdmission[] = []) {
  const request = vi.fn(async (input: ProviderHttpRequest) => ({ status: 200, headers: {}, body: typeof body === 'function' ? body(input) : body }));
  return { request, qualifier: new ProviderIdentityQualifier({ transport: { request }, admissions, now: () => Date.parse('2026-10-19T12:00:00Z') }) };
}
function native() {
  return { organizationId: UUID.org, organization: { id: UUID.org }, grant: { id: UUID.grant, orgId: UUID.org, ownerAdminId: UUID.person,
    name: 'Synthetic native grant', gameIds: [UUID.game], environmentIds: [UUID.env], scopes: ['stats:read', 'operations:write'],
    operationIds: ['stats.summary'], revokedAt: null, expiresAt: '2026-10-20T12:00:00Z' }, games: [{ id: UUID.game }],
    environments: [{ id: UUID.env, gameId: UUID.game }], protocolVersions: ['2026-07-28'] };
}
const rpc = (structuredContent: unknown) => ({ jsonrpc: '2.0', id: 'vox-identity', result: { isError: false, structuredContent } });

describe('independent provider-native identity qualification (synthetic transport only)', () => {
  it('Notion bot/workspace UUIDs remain identities even when names imitate another account', async () => {
    const f = fixture({ object: 'user', id: UUID.person, type: 'bot', name: 'Imitated account label',
      bot: { workspace_id: UUID.org, workspace_name: 'A different display label' } });
    const result = await f.qualifier.qualify('notion', TOKEN);
    expect(result.identity.subject).toBe(UUID.person); expect(result.identity.tenant).toBe(UUID.org);
    expect(result.evidence.identityKind).toBe('integration_bot'); expect(result.evidence.writeCapability).toBe('unavailable');
  });

  it('Notion missing native workspace identity cannot be repaired by its display name', async () => {
    const f = fixture({ object: 'user', id: UUID.person, type: 'bot', name: 'Looks verified', bot: { workspace_name: 'Trusted looking' } });
    await expect(f.qualifier.qualify('notion', TOKEN)).rejects.toMatchObject({ code: 'provider_identity_invalid' });
  });

  it('Hetzner requires explicit inventory admission and reports credential-resource evidence without inventing a principal', async () => {
    const denied = fixture({ server: { id: 123 } });
    await expect(denied.qualifier.qualify('hetzner', TOKEN)).rejects.toMatchObject({ code: 'provider_identity_admission_required' });
    expect(denied.request).not.toHaveBeenCalled();
    const f = fixture({ server: { id: 123 } }, [{ providerId: 'hetzner', kind: 'credential_resource', serverIds: [123] }]);
    const result = await f.qualifier.qualify('hetzner', TOKEN);
    expect(result.identity.subject).toMatch(/^credential:[a-f0-9]{64}$/);
    expect(result.evidence).toMatchObject({ identityKind: 'credential_resource', providerSubjectVerified: false,
      providerTenantVerified: false, verifiedScopes: null, writeCapability: 'unavailable', resourceAccess: ['hetzner:server:123'] });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('GitHub resource credentials cannot silently merge repositories from different returned owners', async () => {
    const f = fixture(request => request.path.includes('/first') ? { id: 1, full_name: 'qa/first', owner: { id: 100 } } :
      { id: 2, full_name: 'qa/second', owner: { id: 200 } }, [{ providerId: 'github', kind: 'credential_resource',
      repositories: [{ owner: 'qa', repository: 'first' }, { owner: 'qa', repository: 'second' }] }]);
    await expect(f.qualifier.qualify('github', TOKEN)).rejects.toMatchObject({ code: 'provider_identity_scope_mismatch' });
  });

  it('PostHog resource credentials pin region/project/insight without claiming a provider user', async () => {
    const f = fixture({ id: 42 }, [{ providerId: 'posthog', kind: 'credential_resource', region: 'eu', projectId: '7', insightIds: ['42'] }]);
    const result = await f.qualifier.qualify('posthog', TOKEN);
    expect(f.request.mock.calls[0][0]).toMatchObject({ profileId: 'posthog-eu-identity', path: '/api/projects/7/insights/42/' });
    expect(result.identity.issuer).toBe('https://eu.posthog.com');
    expect(result.evidence.providerSubjectVerified).toBe(false); expect(result.evidence.writeCapability).toBe('unavailable');
  });

  it('Gamend records native scopes/operations as an upper bound while keeping writes unavailable', async () => {
    const f = fixture(rpc(native()), [{ providerId: 'gamend', kind: 'native_delegation', orgId: UUID.org, gameId: UUID.game, envId: UUID.env }]);
    const result = await f.qualifier.qualify('gamend', TOKEN);
    expect(result.identity).toMatchObject({ subject: UUID.person, tenant: UUID.org });
    expect(result.evidence.verifiedScopes).toEqual(['stats:read', 'operations:write']);
    expect(result.evidence.permittedNativeOperationIds).toEqual(['stats.summary']); expect(result.evidence.writeCapability).toBe('unavailable');
  });

  it.each(['revoked', 'expired', 'wrong_org', 'wrong_game', 'wrong_env', 'wrong_protocol'] as const)
    ('Gamend native delegation denies %s despite a successful authenticated response', async failure => {
      const data = native();
      if (failure === 'revoked') data.grant.revokedAt = '2026-10-19T11:00:00Z' as never;
      if (failure === 'expired') data.grant.expiresAt = '2026-10-18T12:00:00Z';
      if (failure === 'wrong_org') data.organizationId = UUID.person;
      if (failure === 'wrong_game') data.grant.gameIds = [UUID.person];
      if (failure === 'wrong_env') data.environments[0].gameId = UUID.person;
      if (failure === 'wrong_protocol') data.protocolVersions = ['2025-11-25'];
      const f = fixture(rpc(data), [{ providerId: 'gamend', kind: 'native_delegation', orgId: UUID.org, gameId: UUID.game, envId: UUID.env }]);
      await expect(f.qualifier.qualify('gamend', TOKEN)).rejects.toMatchObject({ code: 'provider_identity_scope_mismatch' });
    });

  it('identity result cannot echo a reusable credential through a display label', async () => {
    const f = fixture({ id: 123, login: 'qa', name: TOKEN });
    await expect(f.qualifier.qualify('github', TOKEN)).rejects.toMatchObject({ code: 'provider_identity_invalid' });
  });
});
