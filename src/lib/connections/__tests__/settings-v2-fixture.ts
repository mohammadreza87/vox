import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
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
import { SelfServiceMcpBroker, McpConnectionsCatalog, McpBrokerExecutor, McpPublicTransport } from '../mcp';
import type { ConnectionActor } from '../contracts';
import type { ConnectionsApplication } from '../application';
import { erasedAuthority } from '../rights';

/**
 * Synthetic Settings v2 fixture: a Studio with one member (123), a synthetic public MCP server with signed-JWT
 * access tokens, the real self-service MCP broker and the real ConnectionsBroker over a temporary vault. Every
 * identifier and credential is synthetic.
 */
export const RESOURCE = 'https://mcp.fixture.net/personal/mcp';
const issuer = 'https://auth.fixture.net/';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'settings-v2-rsa', use: 'sig' };
const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: RESOURCE, exp: Math.floor(Date.now() / 1000) + 3600, scope: 'files' })).toString('base64url');
export const SYNTHETIC_TOKEN = `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`;
const tool = { name: 'files.get', description: 'SYNTHETIC server tool', annotations: { readOnlyHint: true },
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } };

export interface FixtureOptions { role?: string; committed?: boolean; mcpEnabled?: boolean; directories: string[] }
export async function settingsV2Fixture(o: FixtureOptions) {
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage())); await adaptive.confirm(123, { confirm: true });
  const agent = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: 'active', visibility: 'org', createdBy: 999, tokenEnc: id, bot: { id: id.length + 100, username: `${id}_bot` },
    persona: { name: id }, access: [], ...extra });
  const state = { members: [{ telegramId: 123, name: 'Synthetic', role: o.role ?? 'member' }, { telegramId: 999, name: 'Creator', role: 'member' }],
    agents: [agent('alpha'), agent('beta'), agent('secret', { visibility: 'private' }), agent('blocked', { blocked: [123] })], groups: [], audit: [] } as unknown as StudioState;
  const llm = { identity: { provider: 'anthropic', model: 'synthetic' }, complete: vi.fn(async () => '{}') };
  const store = { read: async () => structuredClone(state), ...(o.committed === false ? {} : { readCommittedForEffect: () => structuredClone(state) }) };
  const studio = { botToken: (a: { id: string }) => `SYNTHETIC_BOT_${a.id}`, deps: { adaptive, store, chatLLM: llm, initDataKey: TEST_INITDATA_KEY_HEX, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } } as unknown as Studio;
  const manager: ConnectionActor = { accountId: 'telegram-account:123' };
  const botActor = async (agentId: string) => (await authenticateAgentConnections(studio, new Request('https://vox.fixture.net', { headers: {
    // Agent-signed initData needs Telegram's Ed25519 signature for that bot (agent(id).bot.id = id.length + 100).
    'x-telegram-init-data': agentInit({ id: 123, first_name: 'Synthetic' }, `SYNTHETIC_BOT_${agentId}`, undefined, {}, agentId.length + 100) } }), agentId)).actor;
  const config = connectionsConfigurationSchema.parse({ schemaVersion: 1, enabled: true, profiles: [], selfServiceMcp: { enabled: o.mcpEnabled !== false, dailyModelTokenCeiling: 500_000, dailyToolCallCeiling: 20 },
    modelPolicy: { provider: 'anthropic', model: 'synthetic', qualified: true, evidenceReference: 'synthetic-only' } });
  const storage = new InMemoryConnectionsStorage(), budgets = new ConnectionsBudgetLedger(new MemoryAdaptiveStorage());
  const apps = new Map<string, ConnectionsApplication>();
  const revoked: string[] = [];
  const brokerPort = {
    begin: vi.fn(), claim: vi.fn(), cancel: vi.fn(),
    execute: (input: Parameters<ConnectionsBroker['execute']>[0]) => mainBroker.execute(input),
    revoke: vi.fn(async (input: { connectionId: string }) => { const result = await mainBroker.revoke(input); revoked.push(input.connectionId); return result; }),
    erase: vi.fn(async (input: { connectionId: string }) => { const result = await mainBroker.revokeErased(input); revoked.push(input.connectionId); return result; }),
    mcpBegin: (input: unknown) => mcp.beginSetup(input), mcpPreview: (input: unknown) => mcp.previewSetup(input), mcpClaim: (input: unknown) => mcp.claimSetup(input), mcpCancel: (input: unknown) => mcp.cancelSetup(input),
  };
  const appFor = async (a: ConnectionActor): Promise<ConnectionsApplication> => {
    const key = JSON.stringify(a); let app = apps.get(key);
    if (!app) { app = await createStudioConnectionsApplication(studio, a, 'personal', { storage, configuration: async () => structuredClone(config), budgets, broker: brokerPort as never }); apps.set(key, app); }
    return app;
  };
  const actorFor = (current: BrokerAuthority): ConnectionActor => ({ accountId: current.context.accountId, ...(current.context.botAgentId ? { botAgentId: current.context.botAgentId, botAuthenticationRevision: current.context.botAuthenticationRevision } : {}) });
  // As runtime.ts: 'erasedContext' is answered from the person's own records, without identity resolution.
  const control: BrokerControlPlane = { call: async input => { const result = await dispatchBrokerControl((await appFor(input.actor)).service, input,
    { erasedContext: (actor, space, connectionId) => erasedAuthority({ storage }, actor, space, connectionId) });
    return result && typeof result === 'object' && 'connection' in result ? { ...result, providerEnabled: config.enabled && !!config.selfServiceMcp?.enabled } as never : result as never; } };
  const transport = new McpPublicTransport({ resolve: async () => [{ address: '8.8.8.8', family: 4 }], send: async input => {
    await input.beforeSend?.();
    const body = input.headers['content-type'] === 'application/json' ? JSON.parse(input.body ?? '{}') : Object.fromEntries(new URLSearchParams(input.body));
    const json = (value: unknown, status = 200) => ({ status, headers: { 'content-type': 'application/json' }, bytes: Buffer.from(JSON.stringify(value)) });
    if (input.url.href === 'https://mcp.fixture.net/.well-known/oauth-protected-resource/personal/mcp') return json({ resource: RESOURCE, authorization_servers: [issuer], scopes_supported: ['files'] });
    if (input.url.href === 'https://auth.fixture.net/.well-known/oauth-authorization-server') return json({ issuer, authorization_endpoint: 'https://auth.fixture.net/authorize', token_endpoint: 'https://auth.fixture.net/token',
      response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true, jwks_uri: 'https://auth.fixture.net/jwks' });
    if (input.url.href === 'https://auth.fixture.net/jwks') return json({ keys: [jwk] });
    if (input.url.href === 'https://auth.fixture.net/token') return json({ access_token: SYNTHETIC_TOKEN, token_type: 'Bearer', expires_in: 3600, scope: 'files', resource: RESOURCE });
    if (input.url.href !== RESOURCE || input.headers.authorization !== `Bearer ${SYNTHETIC_TOKEN}`) return json({}, 401);
    if (body.method === 'notifications/initialized') return { status: 202, headers: {}, bytes: Buffer.alloc(0) };
    const result = body.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'Synthetic', version: '1' } } :
      body.method === 'tools/list' ? { tools: [tool] } : { content: [{ type: 'text', text: 'SYNTHETIC_OWN_RESULT' }] };
    return json({ jsonrpc: '2.0', id: body.id, result });
  } });
  const directory = await mkdtemp(join(tmpdir(), 'vox-settings-v2-')); o.directories.push(directory);
  const vault = new FileBrokerVault(directory, new Uint8Array(32).fill(83));
  const mcp = new SelfServiceMcpBroker({ control, vault, transport, callbackUrl: 'https://vox.fixture.net/oauth/callback/remote_mcp', clients: { registeredClients: [{ issuer, clientId: 'SYNTHETIC_CLIENT', scopes: ['files'] }] },
    activate: async (current, activation) => { await control.call({ action: 'completeMcpEnrollment', actor: actorFor(current), space: 'personal', connectionId: current.connection.id, expectedRevision: current.connection.revision, ...activation }); } });
  const mainBroker = new ConnectionsBroker({ control, vault, oauth: { exchange: vi.fn(), refresh: vi.fn(), identity: vi.fn(), revoke: vi.fn() }, catalog: createConnectionsCatalog(), executor: { execute: vi.fn() },
    oauthProfiles: {}, enabledProviderIds: ['remote_mcp'], readOnly: true, credentialForAuthority: async current => { const v = await mcp.credentialForAuthority(current); return { accessToken: v.accessToken, refreshToken: v.refreshToken, expiresAt: v.expiresAt, scopes: v.scopes, subject: v.subject, tenant: v.tenant, issuer: v.issuer, displayLabel: v.displayLabel, connectionRevision: v.connectionRevision, status: v.status, scopeEvidence: v.scopeEvidence }; }, revokeForAuthority: current => mcp.revoke(current),
    catalogForAuthority: async current => new McpConnectionsCatalog(current.connection.schemaVersion === 2 ? current.connection.mcp!.catalog! : null!),
    executorForAuthority: (current, catalog, operation) => new McpBrokerExecutor(catalog as McpConnectionsCatalog, transport, async () => { await control.call({ action: 'assertDispatchable', actor: actorFor(current), space: 'personal', operationId: operation.id }); }) });
  /** Full main-app add: enroll, sign in (synthetic callback), preview, claim the exact digest. */
  const connect = async (actor: ConnectionActor, agentId: string) => {
    const app = await appFor(actor);
    const connection = (await app.enrollMcp!(actor, { space: 'personal', agentId, endpointUrl: RESOURCE, displayLabel: `Synthetic ${agentId}` })).connections.find(c => c.agentId === agentId && c.lifecycle === 'pending')!;
    const setup = await app.beginSetup(actor, 'personal', connection.id);
    await mcp.callback({ state: new URL(setup.authorizationUrl!).searchParams.get('state'), code: 'SYNTHETIC_CODE', iss: issuer });
    const preview = await app.previewMcpSetup!(actor, 'personal', setup.flowId);
    const claimed = await app.claimMcpSetup!(actor, 'personal', setup.flowId, preview.catalog.catalogDigest);
    return { app, setup, preview, claimed, connection: (await app.service.list(actor, { space: 'personal' })).connections.find(c => c.id === connection.id)! };
  };
  return { state, config, studio, storage, vault, mcp, llm, appFor, manager, botActor, connect, brokerPort, revoked };
}
