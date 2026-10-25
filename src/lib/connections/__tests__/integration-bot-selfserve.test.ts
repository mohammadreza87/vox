import { generateKeyPairSync, sign, webcrypto, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Studio } from '../../studio/service';
import type { StudioState } from '../../studio/types';
import { AdaptiveRepository } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import { agentInit, TEST_INITDATA_KEY_HEX } from '../../studio/__tests__/initdata-keys';
import { authenticateAgentConnections } from '../bot-principal';
import { InMemoryConnectionsStorage } from '../storage';
import { createStudioConnectionsApplication } from '../studio-application';
import { ConnectionsBudgetLedger } from '../budgets';
import { connectionsConfigurationSchema } from '../config';
import { FileBrokerVault } from '../broker/vault';
import { dispatchBrokerControl, type BrokerAuthority, type BrokerControlPlane } from '../broker/control';
import { ConnectionsBroker } from '../broker/service';
import { createConnectionsCatalog } from '../catalog';
import { SelfServiceMcpBroker, McpConnectionsCatalog, McpBrokerExecutor, McpPublicTransport, mcpToolId } from '../mcp';
import type { ConnectionActor } from '../contracts';
import type { ConnectionsApplication } from '../application';

const directories: string[] = [];
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('CryptoKey', webcrypto.CryptoKey); });
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const resource = 'https://mcp.fixture.net/personal/mcp', issuer = 'https://auth.fixture.net/';
const callbackUrl = 'https://vox.fixture.net/oauth/callback/remote_mcp';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'integration-rsa', use: 'sig' };
const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: resource, exp: Math.floor(Date.now() / 1000) + 3600, scope: 'files' })).toString('base64url');
const token = `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`;
const tool = { name: 'files.get', description: 'SYNTHETIC server tool', annotations: { readOnlyHint: true },
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } };
async function fixture() {
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage())); await adaptive.confirm(123, { confirm: true });
  const state = { members: [], agents: ['alpha', 'beta'].map((id, i) => ({ id, status: 'active', visibility: 'public', createdBy: 999,
    tokenEnc: id, bot: { id: 100 + i }, persona: { name: id }, access: [] })), groups: [], audit: [] } as unknown as StudioState;
  const llm = { identity: { provider: 'anthropic', model: 'synthetic' }, complete: vi.fn(async () => JSON.stringify({ kind: 'tool', toolId: mcpToolId(tool.name), arguments: { id: 'synthetic-own-document' }, expectedTargetRevision: null })) };
  const studio = { botToken: (agent: { id: string }) => `SYNTHETIC_BOT_${agent.id}`, deps: { adaptive, initDataKey: TEST_INITDATA_KEY_HEX, store: { read: async () => structuredClone(state), readCommittedForEffect: () => structuredClone(state) }, chatLLM: llm } } as unknown as Studio;
  const actorFor = (current: BrokerAuthority): ConnectionActor => ({ accountId: current.context.accountId, botAgentId: current.context.botAgentId, botAuthenticationRevision: current.context.botAuthenticationRevision });
  const actor = async (agentId: string) => (await authenticateAgentConnections(studio, new Request('https://vox.fixture.net', { headers: {
    'x-telegram-init-data': agentInit({ id: 123, first_name: 'Synthetic' }, `SYNTHETIC_BOT_${agentId}`, undefined, {}, agentId === 'beta' ? 101 : 100),
  } }), agentId)).actor;
  const config = connectionsConfigurationSchema.parse({ schemaVersion: 1, enabled: true, profiles: [], selfServiceMcp: { enabled: true, dailyModelTokenCeiling: 500_000, dailyToolCallCeiling: 20 },
    modelPolicy: { provider: 'anthropic', model: 'synthetic', qualified: true, evidenceReference: 'synthetic-only' } });
  const storage = new InMemoryConnectionsStorage(), budgets = new ConnectionsBudgetLedger(new MemoryAdaptiveStorage());
  const apps = new Map<string, ConnectionsApplication>();
  const appFor = async (a: ConnectionActor): Promise<ConnectionsApplication> => {
    const key = JSON.stringify(a); let app = apps.get(key);
    if (!app) { app = await createStudioConnectionsApplication(studio, a, 'personal', { storage, configuration: async () => structuredClone(config), budgets,
      broker: { begin: vi.fn(), claim: vi.fn(), cancel: vi.fn(), execute: input => mainBroker.execute(input), revoke: input => mainBroker.revoke(input),
        mcpBegin: input => mcp.beginSetup(input), mcpPreview: input => mcp.previewSetup(input), mcpClaim: input => mcp.claimSetup(input), mcpCancel: input => mcp.cancelSetup(input) } }); apps.set(key, app); }
    return app;
  };
  const control: BrokerControlPlane = { call: async input => { const result = await dispatchBrokerControl((await appFor(input.actor)).service, input);
    return result && typeof result === 'object' && 'connection' in result ? { ...result, providerEnabled: config.enabled && !!config.selfServiceMcp?.enabled } as never : result as never; } };
  const seen: { url: string; body: Record<string, unknown>; authorization?: string }[] = [];
  const transport = new McpPublicTransport({ resolve: async () => [{ address: '8.8.8.8', family: 4 }], send: async input => {
    await input.beforeSend?.();
    const body = input.headers['content-type'] === 'application/json' ? JSON.parse(input.body ?? '{}') : Object.fromEntries(new URLSearchParams(input.body));
    seen.push({ url: input.url.href, body, authorization: input.headers.authorization });
    const json = (value: unknown, status = 200) => ({ status, headers: { 'content-type': 'application/json' }, bytes: Buffer.from(JSON.stringify(value)) });
    if (input.url.href === 'https://mcp.fixture.net/.well-known/oauth-protected-resource/personal/mcp') return json({ resource, authorization_servers: [issuer], scopes_supported: ['files'] });
    if (input.url.href === 'https://auth.fixture.net/.well-known/oauth-authorization-server') return json({ issuer, authorization_endpoint: 'https://auth.fixture.net/authorize', token_endpoint: 'https://auth.fixture.net/token',
      response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true, jwks_uri: 'https://auth.fixture.net/jwks' });
    if (input.url.href === 'https://auth.fixture.net/jwks') return json({ keys: [jwk] });
    if (input.url.href === 'https://auth.fixture.net/token') return json({ access_token: token, token_type: 'Bearer', expires_in: 3600, scope: 'files', resource });
    if (input.url.href !== resource || input.headers.authorization !== `Bearer ${token}`) return json({}, 401);
    if (body.method === 'notifications/initialized') return { status: 202, headers: {}, bytes: Buffer.alloc(0) };
    const result = body.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'Synthetic', version: '1' } } :
      body.method === 'tools/list' ? { tools: [tool] } : { content: [{ type: 'text', text: 'SYNTHETIC_OWN_RESULT' }] };
    return json({ jsonrpc: '2.0', id: body.id, result });
  } });
  const directory = await mkdtemp(join(tmpdir(), 'vox-selfserve-integration-')); directories.push(directory);
  const vault = new FileBrokerVault(directory, new Uint8Array(32).fill(83));
  const mcp = new SelfServiceMcpBroker({ control, vault, transport, callbackUrl, clients: { registeredClients: [{ issuer, clientId: 'SYNTHETIC_CLIENT', scopes: ['files'] }] },
    activate: async (current, activation) => { await control.call({ action: 'completeMcpEnrollment', actor: actorFor(current), space: 'personal', connectionId: current.connection.id, expectedRevision: current.connection.revision, ...activation }); } });
  const mainBroker = new ConnectionsBroker({ control, vault, oauth: { exchange: vi.fn(), refresh: vi.fn(), identity: vi.fn(), revoke: vi.fn() }, catalog: createConnectionsCatalog(), executor: { execute: vi.fn() },
    oauthProfiles: {}, enabledProviderIds: ['remote_mcp'], readOnly: true, credentialForAuthority: async current => { const v = await mcp.credentialForAuthority(current); return { accessToken: v.accessToken, refreshToken: v.refreshToken, expiresAt: v.expiresAt, scopes: v.scopes, subject: v.subject, tenant: v.tenant, issuer: v.issuer, displayLabel: v.displayLabel, connectionRevision: v.connectionRevision, status: v.status, scopeEvidence: v.scopeEvidence }; }, revokeForAuthority: current => mcp.revoke(current),
    catalogForAuthority: async current => new McpConnectionsCatalog(current.connection.schemaVersion === 2 ? current.connection.mcp!.catalog! : null!),
    executorForAuthority: (current, catalog, operation) => new McpBrokerExecutor(catalog as McpConnectionsCatalog, transport, async () => { await control.call({ action: 'assertDispatchable', actor: actorFor(current), space: 'personal', operationId: operation.id }); }) });
  const connect = async (agentId: string) => {
    const a = await actor(agentId), app = await appFor(a);
    const connection = (await app.enrollMcp!(a, { space: 'personal', agentId, endpointUrl: resource, displayLabel: `Synthetic ${agentId}` })).connections[0];
    const setup = await app.beginSetup(a, 'personal', connection.id);
    await mcp.callback({ state: new URL(setup.authorizationUrl!).searchParams.get('state'), code: 'SYNTHETIC_CODE', iss: issuer });
    expect((await app.service.list(a, { space: 'personal' })).connections[0].lifecycle).toBe('pending');
    const preview = await app.previewMcpSetup!(a, 'personal', setup.flowId);
    await app.claimMcpSetup!(a, 'personal', setup.flowId, preview.catalog.catalogDigest);
    return { actor: a, app, connection: (await app.service.list(a, { space: 'personal' })).connections[0] };
  };
  return { state, config, seen, llm, vault, appFor, actor, connect };
}

describe('public bot own-account control plane through synthetic MCP broker', () => {
  it('runs the full owner review path with no operator account profile, no membership and no automatic grants', async () => {
    const f = await fixture(), a = await f.connect('alpha');
    const dashboard = await a.app.dashboard(a.actor, 'personal'); expect(dashboard.mcpAvailable).toBe(true); expect(dashboard.grants).toEqual([]);
    expect(a.connection.mcp?.catalog?.tools).toHaveLength(1); expect(f.state.members).toEqual([]); expect(f.config.profiles).toEqual([]);
    expect(JSON.stringify(dashboard)).not.toContain(token);
    const resource = (await a.app.resources(a.actor, 'personal', a.connection.id))[0];
    const granted = await a.app.grant!(a.actor, { space: 'personal', agentId: 'alpha', connectionId: a.connection.id, expectedRevision: a.connection.revision,
      toolIds: resource.toolIds, resourceIds: [resource.id], destinationIds: resource.destinationIds, effects: ['privileged'], expiresAt: Date.now() + 60_000, maxCalls: 10, maxBytes: 128_000 });
    expect(granted.grants[0].effects).toEqual(['privileged']);
    const task = await a.app.task!(a.actor, { space: 'personal', agentId: 'alpha', connectionId: a.connection.id, message: 'Read my selected document', requestId: randomUUID() });
    expect(task.status).toBe('review_required'); expect(f.seen.filter(x => x.body.method === 'tools/call')).toHaveLength(0);
    const operation = task.operations[0], preview = await a.app.service.preview(a.actor, { space: 'personal', operationId: operation.operationId, expectedRevision: operation.revision });
    expect(preview.arguments).toEqual({ id: 'synthetic-own-document' });
    const approved = await a.app.service.approve(a.actor, { space: 'personal', operationId: operation.operationId, expectedRevision: operation.revision, proposalDigest: operation.proposalDigest });
    const executed = await a.app.execute(a.actor, 'personal', approved.operationId);
    expect(executed.receipt.state).toBe('committed'); expect(executed.sourceIds).toHaveLength(1); expect(JSON.stringify(executed.output)).toContain('SYNTHETIC_OWN_RESULT');
    expect(f.seen.filter(x => x.body.method === 'tools/call')).toHaveLength(1);
  });
  it('reconciles only an identical committed activation and rejects altered identity or revoked authority', async () => {
    const f = await fixture(), a = await f.connect('alpha');
    const context = await a.app.service.context(a.actor, 'personal');
    const account = await a.app.service.repository.transaction(context, records => records.providerAccounts[0]);
    const activation = { space: 'personal' as const, connectionId: a.connection.id, expectedRevision: a.connection.revision - 1,
      catalog: a.connection.mcp!.catalog!, issuer: account.issuer, providerSubject: account.providerSubject, providerTenantId: account.providerTenantId,
      providerScopes: ['files'], displayLabel: account.displayLabel, identityEvidence: 'unavailable' as const };
    await a.app.service.completeMcpEnrollment(a.actor, activation);
    expect(await a.app.service.repository.transaction(context, records => records.providerAccounts.length)).toBe(1);
    expect((await a.app.service.list(a.actor, { space: 'personal' })).connections[0].revision).toBe(a.connection.revision);
    await expect(a.app.service.completeMcpEnrollment(a.actor, { ...activation, providerSubject: 'authorization:WRONG' })).rejects.toMatchObject({ code: 'enrollment_stale' });
    await expect(a.app.service.completeMcpEnrollment(a.actor, { ...activation, providerScopes: ['files', 'admin'] })).rejects.toMatchObject({ code: 'enrollment_stale' });
    f.state.agents[0].blocked = [123];
    await expect(a.app.service.completeMcpEnrollment(a.actor, activation)).rejects.toMatchObject({ code: 'agent_unavailable' });
  });
  it('keeps the same server authorization separate per bot and revokes only the chosen bot', async () => {
    const f = await fixture(), a = await f.connect('alpha'), b = await f.connect('beta');
    expect(a.connection.id).not.toBe(b.connection.id); expect((await a.app.dashboard(a.actor, 'personal')).connections.map(c => c.id)).toEqual([a.connection.id]);
    await expect(a.app.resources(a.actor, 'personal', b.connection.id)).rejects.toMatchObject({ code: 'connection_unavailable' });
    await a.app.revoke!(a.actor, { space: 'personal', connectionId: a.connection.id, expectedRevision: a.connection.revision });
    expect(await f.vault.binding('credential', a.connection.id)).toBeUndefined(); expect(await f.vault.binding('credential', b.connection.id)).toMatchObject({ agentId: 'beta' });
    expect((await b.app.service.list(b.actor, { space: 'personal' })).connections[0].lifecycle).toBe('connected');
  });
});
