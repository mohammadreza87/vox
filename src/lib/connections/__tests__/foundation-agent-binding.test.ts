import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Studio } from '../../studio/service';
import type { StudioState } from '../../studio/types';
import { AdaptiveRepository } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { connectionsConfigurationSchema } from '../config';
import { createStudioConnectionsApplication } from '../studio-application';
import { InMemoryConnectionsStorage } from '../storage';
import { ConnectionsBudgetLedger } from '../budgets';
import { connectionSchema, type ConnectionContext } from '../contracts';
import { ConnectionsService } from '../service';
import { ConnectionsRepository } from '../repository';
import { createConnectionsCatalog } from '../catalog';
import { FileBrokerVault } from '../broker/vault';
import { ConnectionsBroker } from '../broker/service';
import { assertOwner } from '../policy';
import { dispatchBrokerControl } from '../broker/control';

const actor = { accountId: 'telegram-account:123' };
const names = ['alpha', 'beta'] as const;
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()));
  await adaptive.confirm(123, { confirm: true });
  const state = { members: [{ telegramId: 123, role: 'member', firstName: 'Synthetic' }],
    agents: names.map(id => ({ id, status: 'active', createdBy: 123, visibility: 'private', access: [], persona: { name: id } })), groups: [], audit: [] } as unknown as StudioState;
  const studio = { deps: { adaptive, store: { read: async () => structuredClone(state), readCommittedForEffect: () => structuredClone(state) },
    chatLLM: { identity: { provider: 'anthropic', model: 'fixture-model' }, complete: vi.fn() } } } as unknown as Studio;
  const configuration = connectionsConfigurationSchema.parse({ schemaVersion: 1, enabled: true,
    modelPolicy: { provider: 'anthropic', model: 'fixture-model', qualified: true, evidenceReference: 'synthetic-only' },
    profiles: [...names, 'legacy'].map(name => ({ ...actor, ...(name !== 'legacy' ? { agentId: name } : {}), space: 'work', providerId: 'github',
      providerSubject: `subject-${name}`, providerTenantId: `tenant-${name}`, endpointProfileId: 'github-api', setup: 'operator',
      qualified: true, evidenceReference: 'synthetic-only', dailyToolCallCeiling: 1, dailyModelTokenCeiling: 100_000,
      resources: [{ id: `github:repo:qa/${name}`, label: `PRIVATE_${name.toUpperCase()}_RESOURCE`, toolIds: ['github.repository.get'] }] })) });
  const broker = { begin: vi.fn(), claim: vi.fn(), cancel: vi.fn(), execute: vi.fn(), revoke: vi.fn(async () => undefined), invalidate: vi.fn(async () => undefined) };
  const storage = new InMemoryConnectionsStorage();
  const app = await createStudioConnectionsApplication(studio, actor, 'work', { storage, configuration: async () => structuredClone(configuration), broker,
    budgets: new ConnectionsBudgetLedger(new MemoryAdaptiveStorage()) });
  const connect = async (agentId?: string) => {
    const list = await app.enroll!(actor, { space: 'work', providerId: 'github', displayLabel: `Synthetic ${agentId ?? 'legacy'}`, ...(agentId ? { agentId } : {}) });
    const pending = list.connections.find(c => c.agentId === agentId && c.lifecycle === 'pending')!;
    await app.service.completeEnrollment(actor, { space: 'work', connectionId: pending.id, expectedRevision: pending.revision,
      issuer: 'https://github.com', providerSubject: `subject-${agentId ?? 'legacy'}`, providerTenantId: `tenant-${agentId ?? 'legacy'}`,
      providerScopes: ['metadata:read'], displayLabel: `Synthetic ${agentId ?? 'legacy'}` });
    return (await app.service.list(actor, { space: 'work' })).connections.find(c => c.id === pending.id)!;
  };
  const grant = async (connectionId: string, agentId: string) => {
    const current = (await app.service.list(actor, { space: 'work' })).connections.find(c => c.id === connectionId)!;
    return app.grant!(actor, { space: 'work', connectionId, agentId, expectedRevision: current.revision,
      toolIds: ['github.repository.get'], resourceIds: [`github:repo:qa/${agentId}`], destinationIds: ['provider:github', 'model:studio', 'vox:private'],
      effects: ['read'], expiresAt: Date.now() + 60_000, maxCalls: 10, maxBytes: 100_000 });
  };
  const propose = async (connectionId: string, agentId: string, grantId: string, resource = agentId) => app.service.propose(actor,
    { space: 'work', requestId: randomUUID(), idempotencyKey: randomUUID(), connectionId, grantId, agentId, toolId: 'github.repository.get',
      arguments: { owner: 'qa', repository: resource }, destinationId: 'provider:github', expectedTargetRevision: null,
      sourceIds: [], retention: 'retained', deadlineAt: Date.now() + 30_000 });
  return { app, connect, grant, propose, configuration, broker, state, adaptive };
}

describe('per-agent connection/account isolation', () => {
  it('connects the same provider separately for two agents with zero automatic grants', async () => {
    const f = await fixture(); const a = await f.connect('alpha'), b = await f.connect('beta');
    expect(a.id).not.toBe(b.id); expect(a.agentId).toBe('alpha'); expect(b.agentId).toBe('beta');
    expect((await f.app.service.list(actor, { space: 'work' })).grants).toEqual([]);
    await expect(f.connect('alpha')).rejects.toMatchObject({ code: 'connection_exists' });
    await expect(f.connect('unowned')).rejects.toMatchObject({ code: 'agent_unavailable' });
  });
  it('keeps legacy records global and does not inherit their inventory in an agent view', async () => {
    const f = await fixture(); const legacy = await f.connect(); const a = await f.connect('alpha');
    const scoped = await f.app.dashboard(actor, 'work', 'alpha');
    expect(scoped.connections.map(c => c.id)).toEqual([a.id]);
    expect(JSON.stringify(scoped)).not.toContain(legacy.displayLabel);
    const context = await f.app.service.context(actor, 'work');
    const stored = await f.app.service.repository.transaction(context, records => records.connections);
    expect(stored.find(c => c.id === legacy.id)?.schemaVersion).toBe(1);
    expect(stored.find(c => c.id === a.id)?.schemaVersion).toBe(2);
    expect(connectionSchema.safeParse({ ...stored.find(c => c.id === legacy.id), agentId: 'alpha' }).success).toBe(false);
    expect(connectionSchema.safeParse({ ...stored.find(c => c.id === a.id), agentId: undefined }).success).toBe(false);
  });
  it('uses only the selected agent’s verified provider identity, resource set and catalog', async () => {
    const f = await fixture(); const a = await f.connect('alpha'), b = await f.connect('beta');
    expect((await f.app.resources(actor, 'work', a.id)).map(r => r.id)).toEqual(['github:repo:qa/alpha']);
    expect((await f.app.resources(actor, 'work', b.id)).map(r => r.id)).toEqual(['github:repo:qa/beta']);
    const ac = f.app.service.catalogForConnection(a), bc = f.app.service.catalogForConnection(b);
    expect(ac.get('github.repository.get')?.resourceIds).toEqual(['github:repo:qa/alpha']);
    expect(bc.get('github.repository.get')?.resourceIds).toEqual(['github:repo:qa/beta']);
    expect(ac.provider('github')?.catalogDigest).not.toBe(bc.provider('github')?.catalogDigest);
    f.configuration.profiles = f.configuration.profiles.filter(p => p.agentId !== 'alpha');
    await expect(f.app.resources(actor, 'work', a.id)).rejects.toMatchObject({ code: 'provider_setup_required' });
    expect((await f.app.resources(actor, 'work', b.id)).map(r => r.id)).toEqual(['github:repo:qa/beta']);
  });
  it('rejects a grant or task aimed at a different agent and rejects cross-agent resources', async () => {
    const f = await fixture(); const a = await f.connect('alpha');
    await expect(f.grant(a.id, 'beta')).rejects.toMatchObject({ code: 'agent_connection_mismatch' });
    const snapshot = await f.grant(a.id, 'alpha'); const grant = snapshot.grants[0];
    await expect(f.propose(a.id, 'beta', grant.id, 'alpha')).rejects.toMatchObject({ code: 'agent_connection_mismatch' });
    await expect(f.propose(a.id, 'alpha', grant.id, 'beta')).rejects.toMatchObject({ code: 'resource_not_registered' });
    await expect(f.app.task!(actor, { space: 'work', requestId: randomUUID(), connectionId: a.id, agentId: 'beta', message: 'Read it' })).rejects.toMatchObject({ code: 'task_access_denied' });
  });
  it('revokes one agent’s connection without revoking or blocking the other', async () => {
    const f = await fixture(); const a = await f.connect('alpha'), b = await f.connect('beta');
    await f.grant(a.id, 'alpha'); const granted = await f.grant(b.id, 'beta');
    const bg = granted.grants.find(g => g.connectionId === b.id)!;
    await f.app.revoke!(actor, { space: 'work', connectionId: a.id, expectedRevision: a.revision });
    expect(f.broker.revoke).toHaveBeenCalledExactlyOnceWith({ actor, space: 'work', connectionId: a.id, providerId: 'github' });
    const receipt = await f.propose(b.id, 'beta', bg.id);
    expect(receipt.state).toBe('queued');
    const claim = await f.app.service.operations.claim(actor, { space: 'work', operationId: receipt.operationId, workerId: 'synthetic', leaseMs: 1000 });
    expect(claim.operation.agentId).toBe('beta');
    expect((await f.app.service.list(actor, { space: 'work', agentId: 'beta' })).connections[0].lifecycle).toBe('connected');
  });
  it('reserves separate call budgets per agent instead of consuming another agent’s allowance', async () => {
    const f = await fixture();
    await f.app.reserveTaskBudget!('github', 'same-reservation', 'tool_calls', 1, 'alpha');
    await f.app.reserveTaskBudget!('github', 'same-reservation', 'tool_calls', 1, 'beta');
    await expect(f.app.reserveTaskBudget!('github', 'next-reservation', 'tool_calls', 1, 'alpha')).rejects.toMatchObject({ code: 'budget_exhausted' });
  });
  it('authenticates the agent binding inside encrypted vault records while preserving legacy reads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-agent-credentials-')); directories.push(directory);
    const vault = new FileBrokerVault(directory, new Uint8Array(32).fill(42));
    const legacy = { accountId: actor.accountId, personId: 'synthetic-person', space: 'work' as const, connectionId: 'legacy', providerId: 'github' };
    const a = { ...legacy, connectionId: 'alpha-connection', agentId: 'alpha' }, b = { ...legacy, connectionId: 'beta-connection', agentId: 'beta' };
    await vault.write('credential', 'alpha-connection', a, { syntheticCredential: 'alpha-only' });
    await vault.write('credential', 'beta-connection', b, { syntheticCredential: 'beta-only' });
    await vault.write('credential', 'legacy', legacy, { syntheticCredential: 'legacy-only' });
    expect(await vault.read('credential', 'alpha-connection', a)).toEqual({ syntheticCredential: 'alpha-only' });
    expect(await vault.read('credential', 'beta-connection', b)).toEqual({ syntheticCredential: 'beta-only' });
    await expect(vault.read('credential', 'alpha-connection', { ...a, agentId: 'beta' })).rejects.toMatchObject({ code: 'vault_record_invalid' });
    await expect(vault.read('credential', 'alpha-connection', { ...a, agentId: undefined })).rejects.toMatchObject({ code: 'vault_record_invalid' });
    expect(await vault.read('credential', 'legacy', legacy)).toEqual({ syntheticCredential: 'legacy-only' });
  });
  it('keeps same-person management after confirmation while requiring a fresh explicit grant and suppressing old output', async () => {
    const f = await fixture(), connection = await f.connect('alpha');
    const snapshot = await f.grant(connection.id, 'alpha'), grant = snapshot.grants[0];
    const operation = await f.propose(connection.id, 'alpha', grant.id);
    const claim = await f.app.service.operations.claim(actor, { space: 'work', operationId: operation.operationId, workerId: 'synthetic', leaseMs: 1000 });
    const lease = { space: 'work' as const, operationId: operation.operationId, workerId: 'synthetic', fence: claim.fence };
    await f.app.service.operations.markDispatched(actor, lease);
    await f.app.service.operations.settle(actor, { ...lease, outcome: 'committed' });
    const source = await f.app.service.lineage.registerResult(actor, { space: 'work', operationId: operation.operationId, resourceId: 'github:repo:qa/alpha', resourceRevision: 'synthetic-one' });
    const sourceUse = { space: 'work' as const, sourceIds: [source.id], agentId: 'alpha', destinationId: 'vox:private', purpose: 'explicit.connection_task' as const };
    await f.app.service.lineage.assertUse(actor, sourceUse);
    const before = await f.app.service.context(actor, 'work'); await f.adaptive.confirm(123, { confirm: true });
    const after = await f.app.service.context(actor, 'work'); expect(after.bindingRevision).toBeGreaterThan(before.bindingRevision);
    expect((await f.app.service.list(actor, { space: 'work' })).connections[0].id).toBe(connection.id);
    await expect(f.propose(connection.id, 'alpha', grant.id)).rejects.toMatchObject({ code: 'grant_denied' });
    await expect(f.app.service.operations.assertUsable(actor, 'work', operation.operationId)).rejects.toThrow();
    await expect(f.app.service.lineage.assertUse(actor, sourceUse)).rejects.toThrow();
    expect((await f.app.service.list(actor, { space: 'work' })).grants).toHaveLength(1);
    await f.app.revoke!(actor, { space: 'work', connectionId: connection.id, expectedRevision: connection.revision, grantId: grant.id, expectedGrantRevision: grant.revision });
    const renewed = await f.grant(connection.id, 'alpha'); const newGrant = renewed.grants.find(g => g.status === 'active')!;
    expect(newGrant.id).not.toBe(grant.id); expect(newGrant.bindingRevision).toBe(after.bindingRevision);
    expect((await f.propose(connection.id, 'alpha', newGrant.id)).state).toBe('queued');
    await expect(f.app.service.lineage.assertUse(actor, sourceUse)).rejects.toThrow();
  });
  it('does not extend owner management to a different person, space, audience or bot', async () => {
    const f = await fixture(), connection = await f.connect('alpha'), context = await f.app.service.context(actor, 'work');
    const stored = await f.app.service.repository.transaction(context, records => records.connections.find(c => c.id === connection.id)!);
    for (const other of [ { ...context, personId: 'different-person' }, { ...context, accountId: 'telegram-account:456' },
      { ...context, scope: { ...context.scope, spaceKind: 'personal' as const } }, { ...context, scope: { ...context.scope, audiencePersonIds: ['different-person'] } },
      { ...context, botAgentId: 'beta' } ]) expect(() => assertOwner(other, stored)).toThrow('connection_unavailable');
  });
  it('stops agent enrollment and a stale callback before token exchange when the person is blocked', async () => {
    const f = await fixture();
    const pending = (await f.app.enroll!(actor, { space: 'work', providerId: 'github', displayLabel: 'Synthetic', agentId: 'alpha' })).connections[0];
    const directory = await mkdtemp(join(tmpdir(), 'vox-agent-broker-')); directories.push(directory);
    const vault = new FileBrokerVault(directory, new Uint8Array(32).fill(53));
    const write = vi.spyOn(vault, 'write');
    const oauth = { exchange: vi.fn(), refresh: vi.fn(), identity: vi.fn(), revoke: vi.fn() };
    const broker = new ConnectionsBroker({ control: { call: input => dispatchBrokerControl(f.app.service, input) as never }, vault, oauth,
      catalog: f.app.service.catalogForConnection(pending), executor: { execute: vi.fn() }, enabledProviderIds: ['github'],
      oauthProfiles: { github: { providerId: 'github', issuer: 'https://github.com', authorizeUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token', clientId: 'SYNTHETIC_CLIENT', clientSecret: 'SYNTHETIC_SECRET',
        callbackUrl: 'https://vox.example.invalid/oauth/callback/github', scopes: ['metadata:read'] } } });
    const alpha = f.state.agents.find(a => a.id === 'alpha')!;
    alpha.blocked = [123];
    const input = { actor, space: 'work', connectionId: pending.id, expectedRevision: pending.revision, providerId: 'github' };
    await expect(broker.beginSetup(input)).rejects.toMatchObject({ code: 'broker_agent_unavailable' });
    expect(write).not.toHaveBeenCalled(); expect(oauth.exchange).not.toHaveBeenCalled();
    alpha.blocked = [];
    const setup = await broker.beginSetup(input);
    expect(await vault.binding('flow', setup.flowId)).toMatchObject({ agentId: 'alpha', connectionId: pending.id });
    alpha.blocked = [123];
    await expect(broker.claimSetup({ actor, space: 'work', flowId: setup.flowId })).rejects.toMatchObject({ code: 'broker_agent_unavailable' });
    await expect(broker.callback('github', { state: new URL(setup.authorizationUrl!).searchParams.get('state'), code: 'SYNTHETIC_CODE' })).rejects.toMatchObject({ code: 'broker_agent_unavailable' });
    expect(oauth.exchange).not.toHaveBeenCalled(); expect(oauth.identity).not.toHaveBeenCalled();
  });
  it('fences cross-agent writes and final worker dispatch even if a stored grant is corrupted', async () => {
    const now = Date.now();
    const context: ConnectionContext = { ...actor, personId: 'synthetic', bindingId: 'binding', bindingRevision: 1,
      bindingExpiresAt: now + 60_000, currentAgentIds: [...names], scope: { tenantId: 'tenant', spaceId: 'space', spaceKind: 'work',
        containerId: 'private', audiencePersonIds: ['synthetic'], audienceRevision: 'one' } };
    const catalogForAgent = (id?: string) => createConnectionsCatalog({ resourceIdsByTool: { 'github.issue.create': [`github:repo:qa/${id}`] }, destinationIds: ['provider:github'] });
    const service = new ConnectionsService(new ConnectionsRepository(new InMemoryConnectionsStorage()), { now: () => now,
      catalog: catalogForAgent('legacy'), catalogForAgent, resolveContext: async () => context });
    const pending = (await service.enroll(actor, { space: 'work', providerId: 'github', displayLabel: 'Synthetic', agentId: 'alpha' })).connections[0];
    await service.completeEnrollment(actor, { space: 'work', connectionId: pending.id, expectedRevision: pending.revision,
      issuer: 'https://github.com', providerSubject: 'subject', providerTenantId: 'tenant', providerScopes: ['issues:write'], displayLabel: 'Synthetic' });
    const connection = (await service.list(actor, { space: 'work' })).connections[0];
    const input = { space: 'work', connectionId: connection.id, expectedRevision: connection.revision, agentId: 'alpha', toolIds: ['github.issue.create'],
      resourceIds: ['github:repo:qa/alpha'], destinationIds: ['provider:github'], effects: ['write'], expiresAt: now + 30_000, maxCalls: 10, maxBytes: 100_000 };
    await expect(service.grant(actor, { ...input, agentId: 'beta' })).rejects.toMatchObject({ code: 'agent_connection_mismatch' });
    const grant = (await service.grant(actor, input)).grants[0];
    const proposal = { space: 'work', requestId: randomUUID(), idempotencyKey: randomUUID(), connectionId: connection.id, grantId: grant.id,
      agentId: 'alpha', toolId: 'github.issue.create', arguments: { owner: 'qa', repository: 'alpha', title: 'Synthetic only', body: 'Synthetic fixture body' },
      destinationId: 'provider:github', expectedTargetRevision: null, sourceIds: [], retention: 'retained', deadlineAt: now + 20_000 };
    await expect(service.propose(actor, { ...proposal, agentId: 'beta' })).rejects.toMatchObject({ code: 'agent_connection_mismatch' });
    const receipt = await service.propose(actor, proposal);
    expect(receipt.state).toBe('needs_approval');
    const approved = await service.approve(actor, { space: 'work', operationId: receipt.operationId, expectedRevision: receipt.revision, proposalDigest: receipt.proposalDigest });
    await service.repository.transaction(context, records => { records.grants[0].agentId = 'beta'; records.operations[0].agentId = 'beta'; });
    await expect(service.operations.claim(actor, { space: 'work', operationId: approved.operationId, workerId: 'synthetic', leaseMs: 1000 })).rejects.toMatchObject({ code: 'agent_connection_mismatch' });
  });
});
