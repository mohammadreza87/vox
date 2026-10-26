import { z } from 'zod';
import { StudioRateLimiter } from '../studio/ratelimit';
import { join, isAbsolute } from 'node:path';
import type { Studio } from '../studio/service';
import { connectionAgentId, type ConnectionActor, type SpaceKind } from './contracts';
import type { ConnectionsApplication } from './application';
import { FileConnectionsStorage, FirestoreConnectionsStorage, type ConnectionsStorage } from './storage';
import { readConnectionsConfiguration, readConnectionsConfigurationNow } from './config';
import { createStudioConnectionsApplication, type ConnectionsBrokerPort } from './studio-application';
import { AuthenticatedBrokerClient, BrokerAuthenticator } from './broker/auth';
import { readPrivateKeyFile } from './broker/vault';
import { brokerControlSchema, dispatchBrokerControl } from './broker/control';
import { digest } from './repository';
import { ConnectionsError } from './errors';
import { boundedStudioRequest } from '../studio/http';
import { ConnectionsBudgetLedger } from './budgets';
import { FileAdaptiveStorage, FirestoreAdaptiveStorage } from '../adaptive/persistence/storage';
import { erasedAuthority, eraseConnections, exportConnections, type ConnectionsExport, type ConnectionsRightsPort } from './rights';
import { botAuthenticationRevision } from './bot-principal';
import { listProviderDefinitions } from './catalog';
import { canUseAgent, visibilityOf } from '../studio/permissions';
import { protectUsage, usageAudience } from '../studio/connector-usage';

const PATHS = ['/v1/enrollments', '/v1/enrollments/claim', '/v1/enrollments/cancel', '/v1/execute', '/v1/revoke', '/v1/invalidate', '/v1/mcp/enrollments', '/v1/mcp/enrollments/preview', '/v1/mcp/enrollments/claim', '/v1/mcp/enrollments/cancel', '/v1/mcp/callback', '/v1/mcp/client-metadata', '/v1/erase'] as const;
interface RuntimeState { storage: ConnectionsStorage; budgets: ConnectionsBudgetLedger; broker?: ConnectionsBrokerPort; authenticator?: BrokerAuthenticator;
  publicMcpRelay?: { callback(input: unknown): Promise<unknown>; metadata(): Promise<unknown> };
  apps: Map<string, { signature: string; application: ConnectionsApplication; touchedAt: number }> }
const globalRuntime = globalThis as typeof globalThis & { __voxConnectionsRuntime?: WeakMap<Studio, Promise<RuntimeState>> };
const runtimes = globalRuntime.__voxConnectionsRuntime ??= new WeakMap();
const publicLimiters = new WeakMap<Studio, StudioRateLimiter>();
async function publicMcpRateLimit(studio: Studio) { let limiter = studio.deps.rateLimiter ?? publicLimiters.get(studio);
  if (!limiter) { const local = new StudioRateLimiter(); publicLimiters.set(studio, local); limiter = local; }
  await limiter.consume('ingress', 'connections-oauth');
}

async function createRuntime(): Promise<RuntimeState> {
  let storage: ConnectionsStorage;
  let budgets: ConnectionsBudgetLedger;
  if (process.env.STUDIO_STORAGE === 'firestore') {
    const { getAdminDb } = await import('../firebase-admin');
    const db = await getAdminDb();
    storage = new FirestoreConnectionsStorage(db);
    budgets = new ConnectionsBudgetLedger(new FirestoreAdaptiveStorage(db, 'connectionsBudgets'));
  } else {
    const dataDir = process.env.STUDIO_DATA_DIR ?? join(process.cwd(), 'data/studio');
    if (process.env.NODE_ENV === 'production' && !isAbsolute(dataDir)) throw new ConnectionsError(503, 'connections_storage_unavailable');
    storage = new FileConnectionsStorage(join(dataDir, 'connections'));
    budgets = new ConnectionsBudgetLedger(new FileAdaptiveStorage(join(dataDir, 'connection-budgets')));
  }
  const state: RuntimeState = { storage, budgets, apps: new Map() };
  const keyPath = process.env.STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE;
  const brokerUrl = process.env.STUDIO_CONNECTIONS_BROKER_URL;
  if (!keyPath && !brokerUrl) return state;
  if (!keyPath || !brokerUrl || !isAbsolute(keyPath)) throw new ConnectionsError(503, 'broker_configuration_invalid');
  // Each service owns its own 0600 copy of the same 64-character hex key.
  // The Studio copy grants broker authentication, never vault filesystem access.
  const key = await readPrivateKeyFile(keyPath, process.getuid?.());
  const client = new AuthenticatedBrokerClient(brokerUrl, key, PATHS);
  state.authenticator = new BrokerAuthenticator(key);
  state.publicMcpRelay = { callback: input => client.call(PATHS[10], input), metadata: () => client.call(PATHS[11], {}) };
  state.broker = {
    begin: input => client.call(PATHS[0], input), claim: input => client.call(PATHS[1], input),
    cancel: input => client.call(PATHS[2], input), execute: input => client.call(PATHS[3], input), revoke: input => client.call(PATHS[4], input),
    invalidate: input => client.call(PATHS[5], input), erase: input => client.call(PATHS[12], input),
    mcpBegin: input => client.call(PATHS[6], input), mcpPreview: input => client.call(PATHS[7], input), mcpClaim: input => client.call(PATHS[8], input), mcpCancel: input => client.call(PATHS[9], input),
  };
  return state;
}
async function runtimeFor(studio: Studio): Promise<RuntimeState> {
  let pending = runtimes.get(studio);
  if (!pending) { pending = createRuntime().catch(error => { runtimes.delete(studio); throw error; }); runtimes.set(studio, pending); }
  return pending;
}

export async function getConnectionsApplication(studio: Studio, actor: ConnectionActor, space: SpaceKind): Promise<ConnectionsApplication> {
  const runtime = await runtimeFor(studio);
  const configuration = () => readConnectionsConfiguration(process.env.STUDIO_CONNECTIONS_CONFIG_FILE);
  const config = await configuration();
  const signature = digest(config);
  const key = digest([actor.accountId, space, actor.botAgentId ?? null, actor.botAuthenticationRevision ?? null]);
  const existing = runtime.apps.get(key);
  if (existing?.signature === signature) { existing.touchedAt = Date.now(); return existing.application; }
  // A fresh process or changed policy loses ephemeral task payloads by design.
  // They are never serialized to recover a pending private-content action.
  for (const [id, item] of runtime.apps) if (item.touchedAt < Date.now() - 15 * 60_000) runtime.apps.delete(id);
  if (runtime.apps.size >= 1000 && !runtime.apps.has(key)) throw new ConnectionsError(503, 'connections_capacity');
  const application = await createStudioConnectionsApplication(studio, actor, space, { storage: runtime.storage, configuration, broker: runtime.broker, budgets: runtime.budgets });
  runtime.apps.set(key, { signature, application, touchedAt: Date.now() });
  return application;
}

/** Counts only: per provider, how many distinct people other than the viewer hold a live connection to this agent. No ids, labels, hosts or times. */
export interface ConnectorUsage { providers: Array<{ id: string; name: string; people: number }> }
const usageCache = new WeakMap<Studio, Map<string, { at: number; value: ConnectorUsage }>>();
/**
 * The viewer's own connections never count (no subtraction); an app shows only once USAGE_MIN_PEOPLE other people
 * use it and, for a non-public agent, never when every other person who may use it does (studio/connector-usage.ts).
 */
export async function connectionUsageFor(studio: Studio, agentId: string, viewerTelegramId?: number): Promise<ConnectorUsage> {
  let cache = usageCache.get(studio);
  if (!cache) usageCache.set(studio, cache = new Map());
  const cacheKey = `${agentId}:${viewerTelegramId ?? ''}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60_000) return structuredClone(hit.value);
  const runtime = await runtimeFor(studio);
  const counts = await runtime.storage.countLivePeopleByAgent?.(agentId, viewerTelegramId === undefined ? undefined : `telegram-account:${viewerTelegramId}`) ?? {};
  const state = await studio.deps.store.read();
  const agent = state.agents.find(a => a.id === agentId);
  // No agent: nothing to protect a count against, so nothing is shown (a hand-picked audience shows nothing either).
  const audience = !agent ? 'chosen' as const : usageAudience(visibilityOf(agent),
    () => state.members.filter(m => m.role !== 'pending' && m.telegramId !== viewerTelegramId && canUseAgent(m, agent) && !(agent.blocked ?? []).includes(m.telegramId)).length);
  const names = new Map(listProviderDefinitions().map(p => [p.id, p.label]));
  const value: ConnectorUsage = { providers: protectUsage(Object.entries(counts).map(([id, people]) => ({ id, name: id === 'remote_mcp' ? 'Custom MCP servers' : names.get(id) ?? id, people })), audience)
    .sort((a, b) => b.people - a.people || a.name.localeCompare(b.name)) };
  if (cache.size > 500) cache.clear();
  cache.set(cacheKey, { at: Date.now(), value });
  return structuredClone(value);
}

/** Erasure revokes through /v1/erase (no identity needed); a broker without it falls back to /v1/revoke with a server-minted
 * actor it accepts at that moment: the member, else the agent bot that owns the connection. */
function rightsPort(studio: Studio, runtime: RuntimeState): ConnectionsRightsPort {
  return {
    storage: runtime.storage, log: studio.deps.logger ?? console,
    ...(runtime.broker?.erase ? { erase: runtime.broker.erase } : {}),
    ...(runtime.broker ? { revoke: runtime.broker.revoke } : {}),
    actorFor: async (accountId, connection) => {
      const telegramId = Number(/^telegram-account:([1-9]\d{0,15})$/.exec(accountId)?.[1] ?? NaN);
      const state = await studio.deps.store.read();
      if (state.members.some(m => m.telegramId === telegramId && m.role !== 'pending')) return { accountId };
      const agent = connection.schemaVersion === 2 ? state.agents.find(a => a.id === connection.agentId && a.status === 'active' && a.bot && a.tokenEnc) : undefined;
      return agent ? { accountId, botAgentId: agent.id, botAuthenticationRevision: botAuthenticationRevision(agent) } : undefined;
    },
  };
}
/** Rights export and erasure of a person's connections (rights-http, pet forget). Throws only when the runtime cannot start. */
export async function connectionsRightsFor(studio: Studio): Promise<{
  export(telegramId: number, space: SpaceKind): Promise<ConnectionsExport | null>;
  erase(telegramId: number, spaces: readonly SpaceKind[]): Promise<{ erased: number; pending: number }>;
}> {
  const port = rightsPort(studio, await runtimeFor(studio));
  return {
    export: (telegramId, space) => exportConnections(port, `telegram-account:${telegramId}`, space),
    erase: (telegramId, spaces) => eraseConnections(port, `telegram-account:${telegramId}`, spaces),
  };
}

/** Reverse broker control, separately authenticated from Telegram. The public
 * callback must be reverse-proxied only to the broker callback endpoint. */
export async function handleStudioBrokerControl(studio: Studio, request: Request): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    const state = await runtimeFor(studio);
    if (!state.authenticator) throw new ConnectionsError(503, 'broker_unavailable');
    if (request.method !== 'POST' || request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new ConnectionsError(415, 'json_required');
    const bounded = await boundedStudioRequest(request, 350_000);
    const raw = await bounded.text();
    state.authenticator.verify('POST', '/api/connections/broker', raw, request.headers);
    const input = brokerControlSchema.parse(JSON.parse(raw));
    // Rights erasure: answered from the person's own records, before (and without) any identity resolution.
    if (input.action === 'erasedContext') return Response.json(await erasedAuthority({ storage: state.storage }, input.actor, input.space, input.connectionId), { headers });
    const app = await getConnectionsApplication(studio, input.actor, input.space);
    let operationProviderId: string | undefined;
    const protectedActions = ['claim', 'markDispatched', 'assertUsable', 'assertDispatchable', 'registerResult', 'completeEnrollment', 'completeMcpEnrollment', 'drainWorkflows', 'registerSubscription', 'ingestVerifiedEvent'];
    if (protectedActions.includes(input.action)) {
      const config = await readConnectionsConfiguration(process.env.STUDIO_CONNECTIONS_CONFIG_FILE);
      if (!config.enabled) throw new ConnectionsError(503, 'connections_paused');
      if ('operationId' in input) {
        const snapshot = await app.service.list(input.actor, { space: input.space });
        const receipt = snapshot.operations.find(o => o.operationId === input.operationId);
        const context = await app.service.context(input.actor, input.space);
        const connection = await app.service.repository.transaction(context, records => records.connections.find(c => c.id === records.operations.find(o => o.id === input.operationId)?.connectionId));
        const tool = receipt && connection ? app.service.catalogForConnection(connection).get(receipt.toolId) : undefined;
        if (!tool) throw new ConnectionsError(404, 'operation_unavailable');
        operationProviderId = tool.providerId;
        await app.assertTaskCurrent?.(tool.providerId, connection ? connectionAgentId(connection) : undefined);
      }
    }
    const responseContext = await app.service.context(input.actor, input.space);
    const result = await dispatchBrokerControl(app.service, input, { workflows: app.workflows });
    const currentConfig = readConnectionsConfigurationNow(process.env.STUDIO_CONNECTIONS_CONFIG_FILE);
    app.service.assertContextCurrent(input.actor, responseContext);
    if (protectedActions.includes(input.action) && (!currentConfig.enabled || (operationProviderId === 'remote_mcp' || input.action === 'completeMcpEnrollment') && !currentConfig.selfServiceMcp?.enabled)) throw new ConnectionsError(503, 'connections_paused');
    if (result && typeof result === 'object' && 'connection' in result && (result as { connection?: { providerId?: string } }).connection?.providerId === 'remote_mcp')
      return Response.json({ ...result, providerEnabled: currentConfig.enabled && !!currentConfig.selfServiceMcp?.enabled }, { headers });
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof ConnectionsError ? error.code : 'broker_control_unavailable' }, { status: error instanceof ConnectionsError ? error.status : 503, headers });
  }
}

/** Public OAuth relay never interprets a callback as a signed-in person or activates a grant. */
export async function handlePublicMcpCallback(studio: Studio, request: Request): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Content-Type': 'text/html; charset=utf-8' };
  try {
    await publicMcpRateLimit(studio);
    if (request.method !== 'GET' || request.url.length > 16_384) throw new ConnectionsError(400, 'mcp_callback_invalid');
    const state = await runtimeFor(studio); if (!state.publicMcpRelay) throw new ConnectionsError(503, 'mcp_setup_unavailable');
    const input: Record<string, string> = {};
    for (const [key, value] of new URL(request.url).searchParams) {
      if (!['state', 'code', 'error', 'error_description', 'iss'].includes(key) || Object.hasOwn(input, key) || value.length > 3000) throw new ConnectionsError(400, 'mcp_callback_invalid');
      input[key] = value;
    }
    await state.publicMcpRelay.callback(input);
    return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Return to Vox</title><body><h1>Return to your agent in Telegram</h1><p>Review the server in Connections to finish. No agent access has been granted.</p></body></html>', { headers });
  } catch (error) {
    return new Response('<!doctype html><html lang="en"><title>Sign-in could not be confirmed</title><body><h1>Sign-in could not be confirmed</h1><p>Return to your agent in Telegram and start a new connection.</p></body></html>', { status: ConnectionsError.is(error) ? error.status : 503, headers });
  }
}
export async function handlePublicMcpClientMetadata(studio: Studio): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  try {
    await publicMcpRateLimit(studio);
    const state = await runtimeFor(studio); if (!state.publicMcpRelay) throw new ConnectionsError(503, 'mcp_setup_unavailable');
    const metadata = z.object({ client_id: z.string().url().max(2000), client_name: z.string().min(1).max(160),
      redirect_uris: z.tuple([z.string().url().max(2000)]), grant_types: z.tuple([z.literal('authorization_code'), z.literal('refresh_token')]),
      response_types: z.tuple([z.literal('code')]), token_endpoint_auth_method: z.literal('none') }).strict().parse(await state.publicMcpRelay.metadata());
    const client = new URL(metadata.client_id), callback = new URL(metadata.redirect_uris[0]);
    if (client.protocol !== 'https:' || client.pathname !== '/oauth/client-metadata.json' || client.search || client.hash || client.username || client.password ||
        callback.origin !== client.origin || callback.pathname !== '/oauth/callback/remote_mcp' || callback.search || callback.hash || callback.username || callback.password) throw new ConnectionsError(503, 'mcp_client_metadata_unavailable');
    return Response.json(metadata, { headers });
  } catch { return Response.json({ error: 'mcp_client_metadata_unavailable' }, { status: 503, headers }); }
}
