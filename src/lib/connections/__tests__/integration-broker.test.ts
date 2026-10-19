import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnectionsCatalog } from '../catalog';
import type { ConnectionContext } from '../contracts';
import { ConnectionsRepository } from '../repository';
import { ConnectionsService } from '../service';
import { InMemoryConnectionsStorage } from '../storage';
import { ConnectionsBroker } from '../broker/service';
import { dispatchBrokerControl } from '../broker/control';
import { FileBrokerVault, type BrokerVault } from '../broker/vault';
import type { OAuthProfile } from '../broker/oauth';
import type { ProviderResult } from '../providers/types';
import { BrokerAuthenticator, signBrokerRequest } from '../broker/auth';
import { ConnectionsBrokerClient } from '../broker/client';
import { createConnectionsBrokerServer } from '../broker/server';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture(options: { expiresSoon?: boolean; interruptClaim?: boolean } = {}) {
  const now = 1_800_000_000_000; const actor = { accountId: 'qa-broker-account' };
  const context: ConnectionContext = { ...actor, personId: 'qa-broker-person', bindingId: 'qa-binding', bindingRevision: 1,
    bindingExpiresAt: now + 3_600_000, currentAgentIds: ['qa-agent'], scope: { tenantId: 'qa-tenant', spaceId: 'qa-work', spaceKind: 'work',
      containerId: 'qa-private', audiencePersonIds: ['qa-broker-person'], audienceRevision: 'qa-audience' } };
  const catalog = createConnectionsCatalog({ resourceIdsByTool: { 'github.issue.get': ['github:repo:qa/fixture'] }, destinationIds: ['provider:github', 'model:studio', 'vox:private'] });
  const service = new ConnectionsService(new ConnectionsRepository(new InMemoryConnectionsStorage()), { catalog, resolveContext: async () => context, now: () => now });
  const pending = (await service.enroll(actor, { space: 'work', providerId: 'github', displayLabel: 'Synthetic broker GitHub' })).connections[0];
  const directory = await mkdtemp(join(tmpdir(), 'vox-independent-broker-')); directories.push(directory);
  const fileVault = new FileBrokerVault(directory, new Uint8Array(32).fill(66));
  let interrupted = false;
  const vault: BrokerVault = { binding: (...args) => fileVault.binding(...args), read: (...args) => fileVault.read(...args),
    delete: (...args) => fileVault.delete(...args), listFlows: () => fileVault.listFlows(), withLock: (...args) => fileVault.withLock(...args),
    write: async (...args) => {
      if (options.interruptClaim && !interrupted && args[0] === 'flow' && (args[3] as { status?: string }).status === 'connected') {
        interrupted = true; throw new Error('synthetic interrupted receipt write');
      }
      return fileVault.write(...args);
    } };
  const profile: OAuthProfile = { providerId: 'github', issuer: 'https://github.com', authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token', clientId: 'SYNTHETIC_CLIENT', clientSecret: 'SYNTHETIC_CLIENT_SECRET',
    callbackUrl: 'https://vox-qa.example.invalid/oauth/callback/github', scopes: ['issues:read'] };
  const oauth = { exchange: vi.fn(async () => ({ accessToken: 'SYNTHETIC_ACCESS_CANARY_924', refreshToken: 'SYNTHETIC_REFRESH_CANARY',
    expiresAt: now + (options.expiresSoon ? 1000 : 3_600_000), scopes: ['issues:read'] })),
    refresh: vi.fn(async () => ({ accessToken: 'SYNTHETIC_ROTATED_TOKEN', refreshToken: 'SYNTHETIC_ROTATED_REFRESH', expiresAt: now + 3_600_000, scopes: ['issues:read'] })),
    identity: vi.fn(async () => ({ subject: 'qa-external-subject', tenant: 'qa-installation', displayLabel: 'Synthetic QA account', issuer: 'https://github.com' })),
    revoke: vi.fn(async () => 'verified' as const) };
  const result: ProviderResult = { data: { title: 'Synthetic result' }, resourceIds: ['github:repo:qa/fixture'], providerReceiptRef: 'qa-receipt',
    resourceRevision: 'qa-revision', untrustedContent: true, truncated: false };
  const executor = { execute: vi.fn(async () => result) };
  const broker = new ConnectionsBroker({ control: { call: input => dispatchBrokerControl(service, input) as never }, vault, oauth, catalog,
    executor, oauthProfiles: { github: profile }, enabledProviderIds: ['github'], now: () => now });
  const start = await broker.beginSetup({ actor, space: 'work', connectionId: pending.id, expectedRevision: pending.revision, providerId: 'github' });
  const state = new URL(start.authorizationUrl!).searchParams.get('state')!;
  const seal = () => broker.callback('github', { state, code: 'SYNTHETIC_CODE', iss: 'https://github.com' });
  const claimSetup = () => broker.claimSetup({ actor, space: 'work', flowId: start.flowId });
  const ready = async () => {
    await seal(); await claimSetup();
    const connection = (await service.list(actor, { space: 'work' })).connections[0];
    const grant = (await service.grant(actor, { space: 'work', connectionId: pending.id, expectedRevision: connection.revision,
      agentId: 'qa-agent', toolIds: ['github.issue.get'], resourceIds: ['github:repo:qa/fixture'], destinationIds: ['provider:github', 'model:studio', 'vox:private'],
      effects: ['read'], expiresAt: now + 60_000, maxCalls: 10, maxBytes: 64_000 })).grants[0];
    return { connection, grant };
  };
  const propose = async (grantId: string) => { const requestId = randomUUID(); return service.propose(actor, { space: 'work', requestId,
    idempotencyKey: requestId, connectionId: pending.id, grantId, agentId: 'qa-agent', toolId: 'github.issue.get',
    arguments: { owner: 'qa', repository: 'fixture', number: 1 }, destinationId: 'provider:github', expectedTargetRevision: null,
    sourceIds: [], retention: 'retained', deadlineAt: now + 30_000 }); };
  const revoke = async () => {
    const connection = (await service.list(actor, { space: 'work' })).connections[0];
    await service.revoke(actor, { space: 'work', connectionId: pending.id, expectedRevision: connection.revision });
    return broker.revoke({ actor, space: 'work', connectionId: pending.id, providerId: 'github' });
  };
  return { actor, context, service, broker, vault, oauth, executor, result, start, state, seal, claimSetup, ready, propose, revoke, pending };
}

describe('independent broker/OAuth/vault/core lifecycle fixtures', () => {
  it('callback only seals identity, authenticated claim connects, and enrollment gives no grants or token view', async () => {
    const f = await fixture(); await f.seal();
    expect((await f.service.list(f.actor, { space: 'work' })).connections[0].lifecycle).toBe('pending');
    await f.claimSetup(); const snapshot = await f.service.list(f.actor, { space: 'work' });
    expect(snapshot.connections[0].lifecycle).toBe('connected'); expect(snapshot.grants).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toMatch(/SYNTHETIC_ACCESS|SYNTHETIC_REFRESH|qa-external-subject/);
    await expect(f.seal()).rejects.toThrow(); expect(f.oauth.exchange).toHaveBeenCalledTimes(1);
  });

  it('rejects OAuth issuer/state/provider mixup before code exchange', async () => {
    const f = await fixture();
    await expect(f.broker.callback('github', { state: f.state, code: 'SYNTHETIC_CODE', iss: 'https://attacker.invalid' })).rejects.toThrow();
    await expect(f.broker.callback('github', { state: f.state + 'altered', code: 'SYNTHETIC_CODE' })).rejects.toThrow();
    await expect(f.broker.callback('gmail', { state: f.state, code: 'SYNTHETIC_CODE' })).rejects.toThrow();
    expect(f.oauth.exchange).not.toHaveBeenCalled();
  });

  it('a different verified person binding cannot claim an already sealed callback', async () => {
    const f = await fixture(); await f.seal(); f.context.bindingRevision++;
    await expect(f.claimSetup()).rejects.toMatchObject({ code: 'enrollment_identity_changed' });
    expect((await f.service.list(f.actor, { space: 'work' })).connections[0].lifecycle).toBe('pending');
  });

  it('revoking a pending connection prevents a later callback from exchanging or retaining credentials', async () => {
    const f = await fixture(); await f.revoke();
    await expect(f.seal()).rejects.toThrow();
    expect(f.oauth.exchange).not.toHaveBeenCalled();
  });

  it('revoking a sealed unclaimed enrollment clears its staged credentials and cancels the flow', async () => {
    const f = await fixture(); await f.seal();
    const binding = await f.vault.binding('flow', f.start.flowId); expect(binding).toBeDefined();
    await f.revoke();
    expect(await f.vault.read('credential', `pending:${f.start.flowId}`, binding!)).toBeUndefined();
    expect((await f.vault.read('flow', f.start.flowId, binding!)) as { status: string }).toMatchObject({ status: 'cancelled' });
  });

  it('does not abort a first authorized read merely because a second read obtains a credential', async () => {
    const f = await fixture(); const { grant } = await f.ready();
    let release!: () => void; let started!: () => void; let firstSignal: AbortSignal | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
    f.executor.execute.mockImplementationOnce(async (...args) => { firstSignal = (args[2] as { signal?: AbortSignal }).signal; started(); await gate; return f.result; });
    const firstOperation = await f.propose(grant.id);
    const first = f.broker.execute({ actor: f.actor, space: 'work', operationId: firstOperation.operationId });
    await entered;
    try {
      const secondOperation = await f.propose(grant.id);
      await f.broker.execute({ actor: f.actor, space: 'work', operationId: secondOperation.operationId });
      expect(firstSignal?.aborted).toBe(false);
    } finally { release(); await first; }
  });

  it('disables the stored credential after an uncertain refresh failure instead of replaying a rotated refresh token', async () => {
    const f = await fixture({ expiresSoon: true }); const { grant } = await f.ready();
    f.oauth.refresh.mockRejectedValue(new Error('synthetic timeout after potential rotation'));
    const operation = await f.propose(grant.id);
    expect(await f.broker.execute({ actor: f.actor, space: 'work', operationId: operation.operationId }))
      .toMatchObject({ receipt: { state: 'failed', safeReason: 'broker_preflight_failed' } });
    const binding = await f.vault.binding('credential', f.pending.id);
    const credential = await f.vault.read('credential', f.pending.id, binding!) as { status: string };
    expect(credential.status).not.toBe('active');
    const second = await f.propose(grant.id);
    expect(await f.broker.execute({ actor: f.actor, space: 'work', operationId: second.operationId }))
      .toMatchObject({ receipt: { state: 'failed', safeReason: 'broker_preflight_failed' } });
    expect(f.oauth.refresh).toHaveBeenCalledTimes(1); expect(f.executor.execute).not.toHaveBeenCalled();
  });

  it('recovers an interrupted connected-flow receipt without re-exchange or duplicate connection', async () => {
    const f = await fixture({ interruptClaim: true }); await f.seal();
    await expect(f.claimSetup()).rejects.toThrow('synthetic interrupted receipt write');
    expect((await f.service.list(f.actor, { space: 'work' })).connections[0].lifecycle).toBe('connected');
    expect((await f.claimSetup()).status).toBe('connected');
    expect(f.oauth.exchange).toHaveBeenCalledTimes(1);
  });

  it('revocation during OAuth exchange prevents sealing the late credential and requests token cleanup', async () => {
    const f = await fixture(); let started!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    f.oauth.exchange.mockImplementationOnce(async () => { started(); await gate; return { accessToken: 'SYNTHETIC_LATE_TOKEN', scopes: ['issues:read'] }; });
    const callback = f.seal(); const rejection = expect(callback).rejects.toThrow(); await entered;
    // Core revocation is authoritative even while the callback holds its flow lock.
    const connection = (await f.service.list(f.actor, { space: 'work' })).connections[0];
    await f.service.revoke(f.actor, { space: 'work', connectionId: connection.id, expectedRevision: connection.revision });
    release(); await rejection;
    const binding = await f.vault.binding('flow', f.start.flowId);
    expect(await f.vault.read('credential', `pending:${f.start.flowId}`, binding!)).toBeUndefined();
    expect(f.oauth.revoke).toHaveBeenCalledTimes(1);
  });

  it('real broker revocation aborts active executor work and fences late results', async () => {
    const f = await fixture(); const { grant } = await f.ready(); let started!: () => void; let release!: () => void;
    let activeSignal: AbortSignal | undefined;
    const entered = new Promise<void>(resolve => { started = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    f.executor.execute.mockImplementationOnce(async (...args) => { activeSignal = (args[2] as { signal?: AbortSignal }).signal; started(); await gate; return f.result; });
    const operation = await f.propose(grant.id);
    const execution = f.broker.execute({ actor: f.actor, space: 'work', operationId: operation.operationId });
    const rejected = expect(execution).rejects.toThrow(); await entered;
    await f.revoke(); expect(activeSignal?.aborted).toBe(true); release(); await rejected;
    const receipt = (await f.service.list(f.actor, { space: 'work' })).operations.find(o => o.operationId === operation.operationId)!;
    expect(receipt.state).toBe('outcome_unknown');
    await expect(f.service.operations.assertUsable(f.actor, 'work', operation.operationId)).rejects.toThrow();
  });

  it('grant-only invalidation aborts that grant without disconnecting its provider credential', async () => {
    const f = await fixture(); const { grant, connection } = await f.ready(); let started!: () => void; let release!: () => void;
    let activeSignal: AbortSignal | undefined;
    const entered = new Promise<void>(resolve => { started = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    f.executor.execute.mockImplementationOnce(async (...args) => { activeSignal = (args[2] as { signal?: AbortSignal }).signal; started(); await gate; return f.result; });
    const operation = await f.propose(grant.id);
    const execution = f.broker.execute({ actor: f.actor, space: 'work', operationId: operation.operationId });
    const rejected = expect(execution).rejects.toThrow(); await entered;
    await f.service.revoke(f.actor, { space: 'work', connectionId: connection.id, expectedRevision: connection.revision,
      grantId: grant.id, expectedGrantRevision: grant.revision });
    await f.broker.invalidate({ actor: f.actor, space: 'work', connectionId: connection.id, grantId: grant.id });
    expect(activeSignal?.aborted).toBe(true); release(); await rejected;
    expect((await f.service.list(f.actor, { space: 'work' })).connections[0].lifecycle).toBe('connected');
    const binding = await f.vault.binding('credential', connection.id);
    expect(await f.vault.read('credential', connection.id, binding!)).toMatchObject({ status: 'active' });
    expect(f.oauth.revoke).not.toHaveBeenCalled();
  });

  it('core revocation during refresh prevents storing an active rotated credential or executing the provider', async () => {
    const f = await fixture({ expiresSoon: true }); const { grant, connection } = await f.ready(); let started!: () => void; let release!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    f.oauth.refresh.mockImplementationOnce(async () => { started(); await gate; return { accessToken: 'SYNTHETIC_ROTATED_TOKEN',
      refreshToken: 'SYNTHETIC_ROTATED_REFRESH', expiresAt: 1_800_003_600_000, scopes: ['issues:read'] }; });
    const operation = await f.propose(grant.id);
    const execution = f.broker.execute({ actor: f.actor, space: 'work', operationId: operation.operationId });
    const rejected = expect(execution).rejects.toThrow(); await entered;
    await f.service.revoke(f.actor, { space: 'work', connectionId: connection.id, expectedRevision: connection.revision });
    release(); await rejected;
    const binding = await f.vault.binding('credential', connection.id);
    expect(await f.vault.read('credential', connection.id, binding!)).toMatchObject({ status: 'revoked' });
    expect(f.oauth.revoke).toHaveBeenCalledWith(expect.anything(), 'SYNTHETIC_ROTATED_TOKEN');
    expect(f.executor.execute).not.toHaveBeenCalled();
  });

  it('actual loopback HTTP client/server authenticate execution and reject unsigned/replayed enrollment messages', async () => {
    const f = await fixture(); const { grant } = await f.ready();
    const key = new Uint8Array(32).fill(48);
    const server = createConnectionsBrokerServer(f.broker, new BrokerAuthenticator(key));
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected private loopback address');
      const origin = `http://127.0.0.1:${address.port}`;
      const operation = await f.propose(grant.id);
      const input = { actor: f.actor, space: 'work' as const, operationId: operation.operationId };
      const unsigned = await fetch(`${origin}/v1/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      expect(unsigned.status).toBe(401); expect(f.executor.execute).not.toHaveBeenCalled();
      await expect(new ConnectionsBrokerClient(origin, new Uint8Array(32).fill(49)).execute(input)).rejects.toMatchObject({ code: 'broker_auth_denied' });
      const output = await new ConnectionsBrokerClient(origin, key).execute(input);
      expect(output.receipt.state).toBe('committed'); expect(output.sourceIds).toHaveLength(1);
      expect(JSON.stringify(output)).not.toMatch(/SYNTHETIC_ACCESS|SYNTHETIC_REFRESH|SYNTHETIC_CLIENT_SECRET/);
      expect(f.executor.execute).toHaveBeenCalledTimes(1);
      const body = JSON.stringify({ actor: f.actor, space: 'work', flowId: f.start.flowId });
      const headers = { 'content-type': 'application/json', ...signBrokerRequest(key, 'POST', '/v1/enrollments/claim', body) };
      expect((await fetch(`${origin}/v1/enrollments/claim`, { method: 'POST', headers, body })).status).toBe(200);
      expect((await fetch(`${origin}/v1/enrollments/claim`, { method: 'POST', headers, body })).status).toBe(401);
      const duplicate = await fetch(`${origin}/oauth/callback/github?state=one&state=two&code=SYNTHETIC_CODE`);
      expect(duplicate.status).toBe(400); expect(f.oauth.exchange).toHaveBeenCalledTimes(1);
      expect((await fetch(`${origin}/v1/operator-enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
