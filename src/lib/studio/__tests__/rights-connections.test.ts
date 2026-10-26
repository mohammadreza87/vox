/**
 * Rights coverage of connections (flag-independent): the rights export carries the person's own connection
 * records (or says they could not be read), a filed erasure erases them for its space, and My data's
 * "forget everything" (VoxxBot-signed; the pet page's agent-signed forget is gone) erases them in both spaces. A failing connections port never fails a filed request or a forget.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveLifecycleService } from '../../adaptive/lifecycle/service';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { NOW, rightsFixture, syntheticRightsPolicy } from '../../adaptive/rights-intake/fixtures';
import { RightsIntakeService } from '../../adaptive/rights-intake/service';
import { signInitData } from '../auth';
import { handlePetRequest } from '../pet-http';
import { handleMyDataRequest } from '../my-data-http';
import type { MyDataResponse } from '../my-data-contract';
import { agentInit } from './initdata-keys';
import { assertRightsAccountNow, handleRightsRequest } from '../rights-http';
import type { ConnectionsExport } from '../../connections/rights';
import { hire, ID, makeStudio, seedOrg } from './helpers';

const TOKEN = '123:synthetic-rights-only';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(cleanup.splice(0).map((fn) => fn())); });

const exported: ConnectionsExport = { space: 'work', connections: [{ id: 'c1', providerId: 'remote_mcp', agentId: 'a1', displayLabel: 'My server', lifecycle: 'connected', health: 'healthy', createdAt: 1, updatedAt: 1,
  mcp: { server: 'https://mcp.fixture.net/mcp', tools: ['Read file'] } }], providerAccounts: [], grants: [], operations: [], approvals: [], payloads: [], workflows: [], occurrences: [], subscriptions: [], audits: [] };

async function setup() {
  const f = await rightsFixture();
  cleanup.push(f.close);
  const h = makeStudio();
  const org = await seedOrg(h);
  const manifest = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-conn', enabledCapabilities: ['core_text'],
    accounts: [ID.alice].map((id) => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: [{ schemaVersion: 1, id: 'core-only', revision: 1, createdAt: NOW, updatedAt: NOW, jurisdiction: 'SYNTHETIC', capability: 'core_text', state: 'approved',
      configurationVersion: 'synthetic-conn', effectiveAt: NOW, reviewExpiresAt: NOW + 100_000_000, owner: 'synthetic', approvalReference: 'synthetic-only' }] }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(f.directory, 'canonical'))), { ...manifest, now: () => NOW });
  await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true });
  const lifecycle = new AdaptiveLifecycleService(adaptive);
  h.studio.deps.lifecycle = lifecycle;
  h.studio.deps.adaptive = adaptive;
  f.setPolicy({ ...syntheticRightsPolicy(), privacyOperatorIds: [ID.superadmin] });
  h.studio.deps.rights = new RightsIntakeService(f.repository, { ...f.options,
    assertAccountNow: (id) => assertRightsAccountNow(h.studio, id), assertOperatorNow: (id) => assertRightsAccountNow(h.studio, id, 'operator'),
    prepareExport: async (id, space) => {
      assertRightsAccountNow(h.studio, id, 'export');
      const prepared = await lifecycle.prepareAccountExport(id, space);
      return { data: prepared.data, revalidate: () => { assertRightsAccountNow(h.studio, id, 'export'); prepared.revalidate(); } };
    } });
  const port = { export: vi.fn(async () => exported), erase: vi.fn(async () => ({ erased: 2, pending: 1 })) };
  h.studio.deps.connectionsRights = vi.fn(async () => port);
  const request = (path: string, body?: unknown) => {
    const req = new Request(`https://vox.synthetic/api/studio/rights/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { origin: 'https://vox.synthetic', 'content-type': 'application/json', 'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'A' }, TOKEN) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return handleRightsRequest(h.studio, req, path.split('?')[0].split('/').filter(Boolean), TOKEN);
  };
  const exportNow = async () => {
    const row = (await (await request('requests', f.input('access_export'))).json()).request;
    return request(`requests/${row.requestId}/actions?space=work`, { version: 1, eventId: randomUUID(), expectedRevision: row.revision, action: 'prepare_local_export' });
  };
  return { f, h, org, port, request, exportNow };
}

describe('rights export and erasure cover connections', () => {
  it('the export carries the person\'s own connection records for its space, and no token-like key', async () => {
    const { port, exportNow } = await setup();
    const res = await exportNow();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.connections).toEqual(exported);
    expect(port.export).toHaveBeenCalledWith(ID.alice, 'work');
    expect(JSON.stringify(data.connections)).not.toMatch(/token|secret|verifier|refresh/i);
  });

  it('a failing connections store never fails the export: it says the part is missing', async () => {
    const { h, port, exportNow } = await setup();
    port.export.mockRejectedValueOnce(new Error('disk'));
    const res = await exportNow();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.connectionsUnavailable).toBe(true);
    expect(data).not.toHaveProperty('connections');
    expect(h.logger.warn).toHaveBeenCalledWith('[studio] connections_export_failed');
  });

  it('a filed erasure erases connections in its space; a failing erase still files the request', async () => {
    const { f, h, port, request } = await setup();
    const input = f.input('erasure');
    expect((await request('requests', input)).status).toBe(201);
    expect(port.erase).toHaveBeenCalledWith(ID.alice, [input.space]);
    port.erase.mockRejectedValueOnce(new Error('broker'));
    const again = f.input('erasure');
    expect([200, 201]).toContain((await request('requests', again)).status);
    expect(h.logger.warn).toHaveBeenCalledWith('[studio] connections_erasure_failed');
    // A runtime that cannot start (bad broker env) is the same: logged, never thrown.
    h.studio.deps.connectionsRights = vi.fn(async () => { throw new Error('broker_configuration_invalid'); });
    expect((await request('requests', f.input('erasure'))).status).toBeLessThan(300);
  });
});

describe('My data (VoxxBot-signed) covers connections in both spaces; the pet page no longer erases anything', () => {
  const MANAGER = '123:synthetic-manager';
  async function mine() {
    const h = makeStudio();
    h.studio.deps.webAppUrl = 'https://vox.example/studio';
    const org = await seedOrg(h);
    const mochi = await hire(h, org.alice, { name: 'Mochi' });
    const erase = vi.fn(async () => ({ erased: 2, pending: 1 }));
    const exportFor = vi.fn(async (_id: number, space: 'work' | 'personal') => space === 'work' ? { ...exported, connections: [{ ...exported.connections[0], agentId: mochi.agent.id }] } : null);
    h.studio.deps.connectionsRights = vi.fn(async () => ({ export: exportFor, erase }));
    const call = (path: string[], body?: unknown) => handleMyDataRequest(h.studio, new Request(`https://vox.example/api/studio/my-data${path.length ? `/${path.join('/')}` : ''}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin: 'https://vox.example', 'content-type': 'application/json', 'x-telegram-init-data': agentInit({ id: ID.bob, first_name: 'B' }, MANAGER) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), path, MANAGER);
    return { h, mochi, erase, exportFor, call };
  }

  it('forget reports erased and pending connections, and a failing port never fails the forget', async () => {
    const { h, erase, call } = await mine();
    const res = await call(['forget'], { confirm: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ erased: 0, connectionsErased: 2, connectionsPending: 1 });
    expect(erase).toHaveBeenCalledWith(ID.bob, ['work', 'personal']);
    erase.mockRejectedValueOnce(new Error('broker'));
    const failed = await call(['forget'], { confirm: true });
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual({ erased: 0 });
    expect(h.logger.warn).toHaveBeenCalledWith('[studio] connections_erasure_failed');
  });

  it('the export carries their own connection records for each space that holds any, with the agents named; a failing port says so', async () => {
    const { h, mochi, exportFor, call } = await mine();
    const body = await (await call([])).json() as MyDataResponse;
    expect(exportFor.mock.calls).toEqual([[ID.bob, 'work'], [ID.bob, 'personal']]);
    expect(body.connections).toEqual([{ ...exported, connections: [{ ...exported.connections[0], agentId: mochi.agent.id }] }]);
    expect(body.agentNames).toEqual({ [mochi.agent.id]: 'Mochi' });
    expect(JSON.stringify(body.connections)).not.toMatch(/token|secret|verifier|refresh/i);
    exportFor.mockRejectedValueOnce(new Error('disk'));
    const failed = await (await call([])).json() as MyDataResponse;
    expect(failed.connectionsUnavailable).toBe(true);
    expect(failed).not.toHaveProperty('connections');
    expect(h.logger.warn).toHaveBeenCalledWith('[studio] connections_export_failed');
  });

  it('the agent-signed pet "forget me" is gone (410) and never reaches connections', async () => {
    const { h, mochi, erase } = await mine();
    const res = await handlePetRequest(h.studio, new Request(`https://vox.example/api/studio/pet/${mochi.agent.id}/forget`, { method: 'POST',
      headers: { origin: 'https://vox.example', 'content-type': 'application/json', 'x-telegram-init-data': agentInit({ id: ID.bob, first_name: 'B' }, mochi.token) }, body: '{}' }), mochi.agent.id, ['forget']);
    expect(res.status).toBe(410);
    expect(erase).not.toHaveBeenCalled();
  });
});
