import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { middleware } from '../../../middleware';
import { handleStudioBrokerControl } from '../runtime';
import { signBrokerRequest } from '../broker/auth';
import { emptyRecords, FileConnectionsStorage } from '../storage';
import { partitionIdFor } from '../repository';
import { eraseConnections } from '../rights';
import type { ConnectionsRecords } from '../contracts';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository } from '../../adaptive/persistence/repository';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import type { Studio } from '../../studio/service';
import type { StudioState } from '../../studio/types';
import { registerFileRuntimeFixture } from '../../studio/file-runtime-owner';

const featureKeys = ['STUDIO_CONNECTIONS_CONFIG_FILE', 'STUDIO_CONNECTIONS_BROKER_AUTH_KEY_FILE', 'STUDIO_CONNECTIONS_BROKER_URL'] as const;
const values = ['/synthetic/config.json', '/synthetic/auth.hex', 'http://127.0.0.1:7091'];
const directories: string[] = [];
async function privateControlFixture(prefix:string){
  const parent=await realpath(await mkdtemp('/tmp/'+prefix)),data=join(parent,'data'),artifact=join(parent,'synthetic-artifact');
  await mkdir(data,{mode:0o700});await mkdir(artifact,{mode:0o700});await mkdir(join(artifact,'.next'),{mode:0o700});
  const release={revision:'c4405f4c70f93b5b064ff64bb2815967d64e5785',sourceTree:'93556bf8ad66e87d7bccaa0d7b3a15f5c5dc1759',buildId:'synthetic-broker-control-unit'};
  // Only low-level unit fixture metadata; never executable production provenance.
  await writeFile(join(artifact,'server.js'),'// synthetic unit; never executed\n',{mode:0o600});await writeFile(join(artifact,'.next','BUILD_ID'),release.buildId,{mode:0o600});
  registerFileRuntimeFixture({dataRoot:data,artifactRoot:artifact,release});directories.push(parent);return data;
}
const configure = () => featureKeys.forEach((key, i) => vi.stubEnv(key, values[i]));
const request = (path = '/api/connections/broker', method = 'POST', headers?: Record<string, string>) =>
  new NextRequest(`https://synthetic-studio.invalid${path}`, { method, headers });
beforeEach(() => { vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('STUDIO_ONLY', '1'); featureKeys.forEach(key => vi.stubEnv(key, '')); });
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('independent exact broker middleware gate and real authenticated handler', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])('every absent/partial prerequisite set fails closed (mask %i)', mask => {
    featureKeys.forEach((key, i) => vi.stubEnv(key, mask & (1 << i) ? values[i] : ''));
    const response = middleware(request(undefined, 'POST', { origin: 'http://127.0.0.1:3107',
      host: '127.0.0.1', 'x-forwarded-host': '127.0.0.1', 'x-forwarded-proto': 'http', 'x-real-ip': '127.0.0.1',
      'x-forwarded-for': '127.0.0.1', authorization: 'Bearer SYNTHETIC_NOT_AUTHORITY' }));
    expect(response.status).toBe(404); expect(response.headers.get('x-middleware-next')).toBeNull();
  });

  it.each([
    [0, 'config.json'], [0, ' /private/config.json'], [0, '//host/config.json'], [0, '/private/config\r.json'],
    [1, 'key.hex'], [1, '/private/key.hex\n'], [2, 'https://127.0.0.1:7091'], [2, 'http://localhost:7091'],
    [2, 'http://127.0.0.1.attacker.invalid:7091'], [2, 'http://127.0.0.1:7091/private'],
    [2, 'http://127.0.0.1:7091/?route=broker'], [2, 'http://user:pass@127.0.0.1:7091'],
  ])('malformed server prerequisite %i cannot expose the route', (index, value) => {
    configure(); vi.stubEnv(featureKeys[Number(index)], String(value));
    expect(middleware(request()).status).toBe(404);
  });

  it.each(['/api/connections/broker/', '/api/connections/broker/child', '/api/connections/broker.json',
    '/api/connections/broker?space=work', '/api/connections/broker?space=work&space=personal',
    '/api/connections/%62roker', '/api/connections/broker%2fchild', '/api/connections/BROKER'])
  ('complete configuration admits no sibling/encoded/child/query namespace: %s', path => {
    configure(); expect(middleware(request(path)).status).toBe(404);
  });

  it.each(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('only POST can pass, never %s', method => {
    configure(); expect(middleware(request(undefined, method)).status).toBe(404);
  });

  it('the valid exception retains API security headers and grants no broader route access', () => {
    configure(); const accepted = middleware(request());
    expect(accepted.headers.get('x-middleware-next')).toBe('1');
    expect(accepted.headers.get('cache-control')).toContain('no-store');
    expect(accepted.headers.get('x-frame-options')).toBe('DENY');
    expect(accepted.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(middleware(request('/api/connections/vault')).status).toBe(404);
    expect(middleware(request('/api/chat')).status).toBe(404);
  });

  it('actual Node control still requires exact HMAC bytes/replay and current identity after middleware admits it', async () => {
    const directory = await privateControlFixture('vox-heldout-middleware-');
    const key = Buffer.alloc(32, 73); const keyPath = join(directory, 'synthetic-auth.hex'); const configPath = join(directory, 'synthetic-config.json');
    await writeFile(keyPath, key.toString('hex'), { mode: 0o600 });
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, enabled: true, profiles: [] }), { mode: 0o600 });
    vi.stubEnv('STUDIO_STORAGE', 'file'); vi.stubEnv('STUDIO_DATA_DIR', directory);
    vi.stubEnv(featureKeys[0], configPath); vi.stubEnv(featureKeys[1], keyPath); vi.stubEnv(featureKeys[2], 'http://127.0.0.1:9');
    const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage())); await adaptive.confirm(1001, { confirm: true });
    const state = { members: [{ telegramId: 1001, role: 'member', firstName: 'Synthetic' }], agents: [], groups: [], audit: [] } as unknown as StudioState;
    const studio = { deps: { adaptive, store: { read: async () => structuredClone(state) } } } as unknown as Studio;
    const body = JSON.stringify({ action: 'drainWorkflows', actor: { accountId: 'telegram-account:1001' }, space: 'work', maxOccurrences: 1 });
    const invoke = async (headers: Record<string, string>, raw = body) => {
      const incoming = new NextRequest('http://127.0.0.1/api/connections/broker', { method: 'POST', body: raw,
        headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1', 'x-forwarded-for': '127.0.0.1', ...headers } });
      expect(middleware(incoming).headers.get('x-middleware-next')).toBe('1');
      return handleStudioBrokerControl(studio, incoming);
    };
    expect((await invoke({})).status).toBe(401);
    expect((await invoke(signBrokerRequest(key, 'POST', '/api/connections/other', body))).status).toBe(401);
    expect((await invoke(signBrokerRequest(key, 'POST', '/api/connections/broker', body), body + ' ')).status).toBe(401);
    const signed = signBrokerRequest(key, 'POST', '/api/connections/broker', body);
    const accepted = await invoke(signed); expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ occurrences: [], quiet: true });
    expect((await invoke(signed)).status).toBe(401);
    state.members[0].role = 'pending';
    expect((await invoke(signBrokerRequest(key, 'POST', '/api/connections/broker', body))).status).toBe(403);
  });

  it('erasedContext: answered over the authenticated control route without identity, only for a connection an erasure marked', async () => {
    const directory = await privateControlFixture('vox-erased-control-');
    const key = Buffer.alloc(32, 74); const keyPath = join(directory, 'synthetic-auth.hex'); const configPath = join(directory, 'synthetic-config.json');
    await writeFile(keyPath, key.toString('hex'), { mode: 0o600 });
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, enabled: false, profiles: [] }), { mode: 0o600 });
    vi.stubEnv('STUDIO_STORAGE', 'file'); vi.stubEnv('STUDIO_DATA_DIR', directory);
    vi.stubEnv(featureKeys[0], configPath); vi.stubEnv(featureKeys[1], keyPath); vi.stubEnv(featureKeys[2], 'http://127.0.0.1:9');
    const accountId = 'telegram-account:1002';
    const row = (id: string) => ({ schemaVersion: 2, id, partitionId: partitionIdFor(accountId, 'personal'), revision: 1, createdAt: 1, updatedAt: 1, retentionUntil: 9e12, ownerAccountId: accountId,
      ownerPersonId: 'person-1002', scope: { tenantId: 't', spaceId: 's', spaceKind: 'personal', containerId: 'c', audiencePersonIds: ['person-1002'], audienceRevision: 'r' },
      providerId: 'github', displayLabel: 'SYNTHETIC', providerAccountId: null, adapterId: 'github', adapterVersion: '1', catalogDigest: 'd', endpointProfileId: 'p',
      providerScopes: [], lifecycle: 'connected', revocationEpoch: 0, health: 'healthy', checkedAt: null, agentId: 'alpha' });
    const storage = new FileConnectionsStorage(join(directory, 'connections'));
    await storage.transact(partitionIdFor(accountId, 'personal'), () => ({ records: { ...emptyRecords(), connections: [row('erased-one')] } as unknown as ConnectionsRecords, result: undefined }));
    // Erased while no broker answered: revoked and marked, waiting.
    expect(await eraseConnections({ storage, actorFor: async () => undefined, log: { warn: () => undefined } }, accountId, ['personal'])).toEqual({ erased: 1, pending: 1 });
    await storage.transact(partitionIdFor(accountId, 'personal'), raw => ({ records: { ...raw, connections: [...raw.connections, row('live-one')] } as unknown as ConnectionsRecords, result: undefined }));
    // No member, no identity service: nothing about the person is current any more.
    const studio = { deps: { store: { read: async () => ({ members: [], agents: [], groups: [], audit: [] }) } } } as unknown as Studio;
    const invoke = (payload: Record<string, unknown>) => {
      const raw = JSON.stringify(payload);
      return handleStudioBrokerControl(studio, new NextRequest('http://127.0.0.1/api/connections/broker', { method: 'POST', body: raw,
        headers: { 'content-type': 'application/json', ...signBrokerRequest(key, 'POST', '/api/connections/broker', raw) } }));
    };
    const ok = await invoke({ action: 'erasedContext', actor: { accountId }, space: 'personal', connectionId: 'erased-one' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ context: { accountId, personId: 'person-1002', currentAgentIds: [] }, connection: { id: 'erased-one', lifecycle: 'revoked' } });
    expect((await invoke({ action: 'erasedContext', actor: { accountId }, space: 'personal', connectionId: 'live-one' })).status).toBe(404);
    expect((await invoke({ action: 'erasedContext', actor: { accountId, botAgentId: 'alpha', botAuthenticationRevision: 'r1' }, space: 'personal', connectionId: 'erased-one' })).status).toBe(404);
    expect((await invoke({ action: 'erasedContext', actor: { accountId: 'telegram-account:1003' }, space: 'personal', connectionId: 'erased-one' })).status).toBe(404);
    // The ordinary context for the same connection still needs a current identity.
    expect((await invoke({ action: 'context', actor: { accountId }, space: 'personal', connectionId: 'erased-one' })).status).not.toBe(200);
  });
});
