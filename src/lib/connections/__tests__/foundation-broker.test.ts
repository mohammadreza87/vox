import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { ConnectionsService } from '../service';
import { ConnectionsRepository } from '../repository';
import { InMemoryConnectionsStorage } from '../storage';
import { createConnectionsCatalog } from '../catalog';
import type { ConnectionContext, ProposeInput } from '../contracts';
import { BrokerAuthenticator, signBrokerRequest } from '../broker/auth';
import { dispatchBrokerControl, type BrokerControlInput } from '../broker/control';
import { FileBrokerVault, type VaultBinding } from '../broker/vault';
import { ConnectionsBroker } from '../broker/service';
import { createConnectionsBrokerServer } from '../broker/server';
import { ConnectionsBrokerClient } from '../broker/client';
import { validateBrokerProcess, type BrokerConfiguration } from '../broker/bootstrap';
import type { BrokerOAuthTransport, OAuthProfile } from '../broker/oauth';
import type { ProviderResult } from '../providers/types';
const actor = { accountId: 'synthetic-account' };
const profile: OAuthProfile = { providerId: 'github', issuer: 'https://github.com', authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token', clientId: 'synthetic-client', clientSecret: 'synthetic-client-secret',
  callbackUrl: 'https://broker.fixture.invalid/oauth/callback/github', scopes: ['repo'] };
async function fixture() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'vox-broker-fixture-'));
  let now = 1_000_000;
  const context: ConnectionContext = { accountId: actor.accountId, personId: 'synthetic-person', bindingId: 'binding-1', bindingRevision: 1,
    bindingExpiresAt: now + 1_000_000, currentAgentIds: ['agent-1'], scope: { tenantId: 'tenant-1', spaceId: 'work-1', spaceKind: 'work',
      containerId: 'private-1', audiencePersonIds: ['synthetic-person'], audienceRevision: 'audience-1' } };
  const catalog = createConnectionsCatalog({ resourceIdsByTool: { 'github.repository.get': ['github:repo:fixture/repository'] }, destinationIds: ['provider:github', 'vox:private'] });
  const service = new ConnectionsService(new ConnectionsRepository(new InMemoryConnectionsStorage()), { catalog, now: () => now,
    resolveContext: async requested => requested.accountId === actor.accountId ? structuredClone(context) : undefined });
  const vault = new FileBrokerVault(directory, randomBytes(32));
  let exchanges = 0; let executions = 0;
  const oauth: BrokerOAuthTransport = {
    exchange: async () => { exchanges++; return { accessToken: 'SYNTHETIC_TOKEN_ONLY', refreshToken: 'SYNTHETIC_REFRESH_ONLY', scopes: ['repo'], expiresAt: now + 600_000 }; },
    refresh: async () => ({ accessToken: 'SYNTHETIC_REFRESHED_ONLY', scopes: ['repo'], expiresAt: now + 600_000 }),
    identity: async () => ({ subject: 'provider-subject-1', tenant: 'provider-subject-1', displayLabel: 'Synthetic provider', issuer: 'https://github.com' }),
    revoke: async () => 'verified',
  };
  const result: ProviderResult = { data: { id: 1, full_name: 'fixture/repository' }, resourceIds: ['github:repo:fixture/repository'],
    providerReceiptRef: null, resourceRevision: 'rev-1', untrustedContent: true, truncated: false };
  const broker = new ConnectionsBroker({ control: { call: async <T>(input: BrokerControlInput) => await dispatchBrokerControl(service, input) as T }, vault, oauth,
    catalog, executor: { execute: async () => { executions++; return result; } }, oauthProfiles: { github: profile }, enabledProviderIds: ['github'],
    operatorScopes: { github: ['repo'] }, now: () => now });
  const initial = await service.enroll(actor, { space: 'work', providerId: 'github', displayLabel: 'Synthetic' });
  const connection = initial.connections[0];
  return { directory, broker, service, vault, connection, context, oauth, result, getExchanges: () => exchanges, getExecutions: () => executions,
    advance: (ms: number) => { now += ms; }, now: () => now, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
}
async function connected() {
  const f = await fixture();
  const setup = await f.broker.beginSetup({ actor, space: 'work', connectionId: f.connection.id, providerId: 'github', expectedRevision: 1 });
  const state = new URL(setup.authorizationUrl!).searchParams.get('state')!;
  await f.broker.callback('github', { state, code: 'synthetic-code' });
  await f.broker.claimSetup({ actor, space: 'work', flowId: setup.flowId });
  const view = await f.service.list(actor, { space: 'work' });
  const granted = await f.service.grant(actor, { space: 'work', connectionId: f.connection.id, expectedRevision: 2, agentId: 'agent-1',
    toolIds: ['github.repository.get'], resourceIds: ['github:repo:fixture/repository'], destinationIds: ['provider:github', 'vox:private'], effects: ['read'],
    expiresAt: f.now() + 60_000, maxCalls: 10, maxBytes: 1000 });
  const proposal: ProposeInput = { space: 'work', requestId: 'request-1', idempotencyKey: 'key-1', connectionId: f.connection.id,
    grantId: granted.grants[0].id, agentId: 'agent-1', toolId: 'github.repository.get', arguments: { owner: 'fixture', repository: 'repository' },
    destinationId: 'provider:github', expectedTargetRevision: null, sourceIds: [], retention: 'ephemeral', deadlineAt: f.now() + 30_000 };
  const binding: VaultBinding = { accountId: actor.accountId, personId: f.context.personId, space: 'work', connectionId: f.connection.id, providerId: 'github' };
  return { ...f, proposal, view, binding };
}
describe('separate broker foundation synthetic checks', () => {
  it('binds HMAC to exact method/path/body, timestamp and one-use nonce', () => {
    const key = randomBytes(32); const authenticator = new BrokerAuthenticator(key, () => 1000);
    const headers = signBrokerRequest(key, 'POST', '/v1/execute', '{"safe":true}', 1000);
    authenticator.verify('POST', '/v1/execute', '{"safe":true}', headers);
    expect(() => authenticator.verify('POST', '/v1/execute', '{"safe":true}', headers)).toThrow('broker_auth_denied');
    const changed = signBrokerRequest(key, 'POST', '/v1/execute', '{}', 1000);
    expect(() => authenticator.verify('POST', '/v1/revoke', '{}', changed)).toThrow('broker_auth_denied');
    expect(() => authenticator.verify('POST', '/v1/execute', '{}', signBrokerRequest(key, 'POST', '/v1/execute', '{}', -100_000))).toThrow('broker_auth_denied');
  });
  it('encrypts credentials and authenticates exact account/connection/space envelope', async () => {
    const f = await fixture();
    try {
      const binding: VaultBinding = { accountId: actor.accountId, personId: f.context.personId, space: 'work', connectionId: f.connection.id, providerId: 'github' };
      await f.vault.write('credential', f.connection.id, binding, { token: 'SYNTHETIC_CANARY_ONLY' });
      const file = (await fs.readdir(join(f.directory, 'credential')))[0];
      expect(await fs.readFile(join(f.directory, 'credential', file), 'utf8')).not.toContain('SYNTHETIC_CANARY_ONLY');
      await expect(f.vault.read('credential', f.connection.id, { ...binding, space: 'personal' })).rejects.toThrow('vault_record_invalid');
      expect(await f.vault.read('credential', f.connection.id, binding)).toEqual({ token: 'SYNTHETIC_CANARY_ONLY' });
    } finally { await f.cleanup(); }
  });
  it('PKCE callback seals only; authenticated claim verifies current account and completes zero-grant enrollment', async () => {
    const f = await fixture();
    try {
      const setup = await f.broker.beginSetup({ actor, space: 'work', connectionId: f.connection.id, providerId: 'github', expectedRevision: 1 });
      const url = new URL(setup.authorizationUrl!); expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      await f.broker.callback('github', { state: url.searchParams.get('state'), code: 'synthetic-code' });
      expect((await f.service.list(actor, { space: 'work' })).connections[0].lifecycle).toBe('pending');
      await expect(f.broker.claimSetup({ actor: { accountId: 'wrong-account' }, space: 'work', flowId: setup.flowId })).rejects.toThrow('enrollment_unavailable');
      expect((await f.broker.claimSetup({ actor, space: 'work', flowId: setup.flowId })).status).toBe('connected');
      expect((await f.service.list(actor, { space: 'work' })).grants).toEqual([]);
      await expect(f.broker.callback('github', { state: url.searchParams.get('state'), code: 'synthetic-code' })).rejects.toThrow('oauth_state_invalid');
      expect(f.getExchanges()).toBe(1);
    } finally { await f.cleanup(); }
  });
  it('revoke before OAuth callback performs zero exchanges and cancels staged flows', async () => {
    const f = await fixture();
    try {
      const setup = await f.broker.beginSetup({ actor, space: 'work', connectionId: f.connection.id, providerId: 'github', expectedRevision: 1 });
      await f.service.revoke(actor, { space: 'work', connectionId: f.connection.id, expectedRevision: 1 });
      await expect(f.broker.callback('github', { state: new URL(setup.authorizationUrl!).searchParams.get('state'), code: 'synthetic-code' })).rejects.toThrow('enrollment_stale');
      expect(f.getExchanges()).toBe(0);
      await f.broker.revoke({ actor, space: 'work', connectionId: f.connection.id, providerId: 'github' });
      expect((await f.broker.claimSetup({ actor, space: 'work', flowId: setup.flowId })).status).toBe('cancelled');
    } finally { await f.cleanup(); }
  });
  it('executes through durable claim+dispatch, registers restricted source and never replays', async () => {
    const f = await connected();
    try {
      const receipt = await f.service.propose(actor, f.proposal);
      const result = await f.broker.execute({ actor, space: 'work', operationId: receipt.operationId });
      expect(result.receipt.state).toBe('committed'); expect(result.sourceIds).toHaveLength(1); expect(result.output).toBeDefined();
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_TOKEN_ONLY');
      await expect(f.broker.execute({ actor, space: 'work', operationId: receipt.operationId })).rejects.toThrow('operation_not_dispatchable');
      expect(f.getExecutions()).toBe(1);
    } finally { await f.cleanup(); }
  });
  it('starts real loopback HTTP with authenticated API and has no token-enrollment route', async () => {
    const f = await fixture(); const key = randomBytes(32);
    const server = createConnectionsBrokerServer(f.broker, new BrokerAuthenticator(key));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${origin}/v1/enrollments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
      const client = new ConnectionsBrokerClient(origin, key);
      const setup = await client.beginSetup({ actor, space: 'work', connectionId: f.connection.id, providerId: 'github', expectedRevision: 1 });
      expect(setup.status).toBe('pending');
      expect((await fetch(`${origin}/v1/operator-enroll`, { method: 'POST', body: '{}' })).status).toBe(404);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); await f.cleanup(); }
  });
  it('refuses same Studio OS identity before touching production configuration', async () => {
    const uid = process.getuid?.() ?? 501;
    await expect(validateBrokerProcess({ brokerUid: uid, studioUid: uid } as BrokerConfiguration)).rejects.toThrow('broker_independent_uid_required');
  });
});
