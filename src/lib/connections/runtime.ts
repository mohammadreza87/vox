import { join, isAbsolute } from 'node:path';
import type { Studio } from '../studio/service';
import type { ConnectionActor, SpaceKind } from './contracts';
import type { ConnectionsApplication } from './application';
import { FileConnectionsStorage, FirestoreConnectionsStorage, type ConnectionsStorage } from './storage';
import { readConnectionsConfiguration } from './config';
import { createStudioConnectionsApplication, type ConnectionsBrokerPort } from './studio-application';
import { AuthenticatedBrokerClient, BrokerAuthenticator } from './broker/auth';
import { readPrivateKeyFile } from './broker/vault';
import { brokerControlSchema, dispatchBrokerControl } from './broker/control';
import { digest } from './repository';
import { ConnectionsError } from './errors';
import { boundedStudioRequest } from '../studio/http';
import { ConnectionsBudgetLedger } from './budgets';
import { FileAdaptiveStorage, FirestoreAdaptiveStorage } from '../adaptive/persistence/storage';

const PATHS = ['/v1/enrollments', '/v1/enrollments/claim', '/v1/enrollments/cancel', '/v1/execute', '/v1/revoke', '/v1/invalidate'] as const;
interface RuntimeState { storage: ConnectionsStorage; budgets: ConnectionsBudgetLedger; broker?: ConnectionsBrokerPort; authenticator?: BrokerAuthenticator;
  apps: Map<string, { signature: string; application: ConnectionsApplication; touchedAt: number }> }
const globalRuntime = globalThis as typeof globalThis & { __voxConnectionsRuntime?: WeakMap<Studio, Promise<RuntimeState>> };
const runtimes = globalRuntime.__voxConnectionsRuntime ??= new WeakMap();

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
  state.broker = {
    begin: input => client.call(PATHS[0], input), claim: input => client.call(PATHS[1], input),
    cancel: input => client.call(PATHS[2], input), execute: input => client.call(PATHS[3], input), revoke: input => client.call(PATHS[4], input),
    invalidate: input => client.call(PATHS[5], input),
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
  const key = digest([actor.accountId, space]);
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
    const app = await getConnectionsApplication(studio, input.actor, input.space);
    if (['claim', 'markDispatched', 'assertUsable', 'assertDispatchable', 'registerResult', 'completeEnrollment', 'drainWorkflows', 'registerSubscription', 'ingestVerifiedEvent'].includes(input.action)) {
      const config = await readConnectionsConfiguration(process.env.STUDIO_CONNECTIONS_CONFIG_FILE);
      if (!config.enabled) throw new ConnectionsError(503, 'connections_paused');
      if ('operationId' in input) {
        const snapshot = await app.service.list(input.actor, { space: input.space });
        const receipt = snapshot.operations.find(o => o.operationId === input.operationId);
        const tool = receipt ? app.service.options.catalog.get(receipt.toolId) : undefined;
        if (!tool) throw new ConnectionsError(404, 'operation_unavailable');
        await app.assertTaskCurrent?.(tool.providerId);
      }
    }
    return Response.json(await dispatchBrokerControl(app.service, input, { workflows: app.workflows }), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof ConnectionsError ? error.code : 'broker_control_unavailable' }, { status: error instanceof ConnectionsError ? error.status : 503, headers });
  }
}
