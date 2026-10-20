import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { FileAdaptiveStorage } from '../persistence/storage';
import { SqliteAdaptiveStorage } from '../persistence/indexed/sqlite-storage';
import { ManagedFileV2Storage } from '../persistence/indexed/managed-storage';
import { AdaptiveLifecycleService } from '../lifecycle/service';
import { signInitData } from '../../studio/auth';
import { assertRightsAccountNow, handleRightsRequest } from '../../studio/rights-http';
import { makeStudio, seedOrg, ID } from '../../studio/__tests__/helpers';
import { RightsIntakeService } from './service';
import { rightsFixture, NOW, syntheticRightsPolicy } from './fixtures';
import { SharedMemoryService } from '../shared/service';
import { SharedMemoryRepository } from '../shared/repository';
import { sharedAuthorityFromStudioStore } from '../../studio/shared-authority';
const mocked = vi.hoisted(() => ({ getStudio: vi.fn() }));
vi.mock('@/lib/studio/runtime', () => ({ getStudio: mocked.getStudio }));
import { GET, POST } from '@/app/api/studio/rights/[[...path]]/route';
const TOKEN = '123:synthetic-rights-only';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanup.splice(0).map(fn => fn())); });
async function setup(format: 'file' | 'sqlite-v1' | 'file-v2' = 'file', shared = false) {
  const f = await rightsFixture(), h = makeStudio(); await seedOrg(h); cleanup.push(f.close, () => rm(h.dir, { recursive: true, force: true }));
  let now = NOW;
  const storage = format === 'file' ? new FileAdaptiveStorage(join(f.directory, 'canonical')) : format === 'sqlite-v1' ? new SqliteAdaptiveStorage(join(f.directory, 'canonical'), { now: () => now }) : new ManagedFileV2Storage(join(f.directory, 'canonical'), { now: () => now });
  if ('close' in storage) cleanup.unshift(async () => storage.close());
  const manifest = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-ri1', enabledCapabilities: ['core_text'], accounts: [ID.alice, ID.bob].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })), approvals: [{ schemaVersion: 1, id: 'core-only', revision: 1, createdAt: NOW, updatedAt: NOW, jurisdiction: 'SYNTHETIC', capability: 'core_text', state: 'approved', configurationVersion: 'synthetic-ri1', effectiveAt: NOW, reviewExpiresAt: NOW + 100_000_000, owner: 'synthetic', approvalReference: 'synthetic-only' }] }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(storage), { ...manifest, now: () => now });
  await adaptive.confirm(ID.alice, { confirm: true, adultConfirmed: true }); await adaptive.confirm(ID.bob, { confirm: true, adultConfirmed: true });
  const sharedService = shared ? new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(join(f.directory, 'shared'))), adaptive, sharedAuthorityFromStudioStore(h.store), () => now) : undefined;
  const lifecycle = new AdaptiveLifecycleService(adaptive, { shared: sharedService }); h.studio.deps.lifecycle = lifecycle; h.studio.deps.adaptive = adaptive;
  f.setPolicy({ ...syntheticRightsPolicy(), privacyOperatorIds: [ID.superadmin] });
  const rights = new RightsIntakeService(f.repository, { ...f.options,
    assertAccountNow: id => assertRightsAccountNow(h.studio, id), assertOperatorNow: id => assertRightsAccountNow(h.studio, id, 'operator'),
    prepareExport: async (id, space) => { assertRightsAccountNow(h.studio, id, 'export'); const prepared = await lifecycle.prepareAccountExport(id, space); return { data: prepared.data, revalidate: () => { assertRightsAccountNow(h.studio, id, 'export'); prepared.revalidate(); } }; } });
  h.studio.deps.rights = rights;
  const request = (path: string, method = 'GET', body?: unknown, user = ID.alice, headers: Record<string,string> = {}) => {
    const req = new Request(`https://vox.synthetic/api/studio/rights${path ? '/' + path : '?space=work'}`, { method, headers: { origin: 'https://vox.synthetic', 'content-type': 'application/json', 'x-telegram-init-data': signInitData({ id: user, first_name: 'Synthetic' }, TOKEN), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return handleRightsRequest(h.studio, req, path.split('?')[0].split('/').filter(Boolean), TOKEN);
  };
  const create = async (kind: 'access_export'|'erasure' = 'access_export', user = ID.alice) => { const input = f.input(kind), response = await request('requests', 'POST', input, user); expect(response.status).toBe(201); return (await response.json()).request; };
  const memory = async (text = 'CURRENT_PRIVATE_CANARY') => { const state = await adaptive.read(ID.alice, 'work'); return adaptive.createMemory(ID.alice, { space: 'work', text, eventId: randomUUID(), expectedRevision: state.revision }); };
  const act = (row: {requestId:string;revision:number}, action = 'prepare_local_export', user = ID.alice, eventId = randomUUID()) => request(`requests/${row.requestId}/actions?space=work`, 'POST', { version: 1, eventId, expectedRevision: row.revision, action }, user);
  return { f, h, adaptive, lifecycle, sharedService, rights, storage, request, create, memory, act, setNow: (value: number) => { now = value; f.setNow(value); } };
}
it('uses signed strict bounded requests without enrolling an unknown account; pending intake is metadata only', async () => {
  const x = await setup();
  expect((await x.request('', 'GET', undefined, ID.alice, { 'x-telegram-init-data': '' })).status).toBe(401);
  expect((await x.request('', 'GET', undefined, ID.stranger)).status).toBe(403);
  expect((await x.h.store.read()).members.some(m => m.telegramId === ID.stranger)).toBe(false);
  expect((await x.request('requests', 'POST', x.f.input(), ID.alice, { origin: 'https://hostile.invalid' })).status).toBe(403);
  expect((await x.request('requests', 'POST', { ...x.f.input(), reason: 'PRIVATE_FREE_TEXT' })).status).toBe(400);
  expect((await x.request('requests', 'POST', { ...x.f.input(), large: 'x'.repeat(4096) })).status).toBe(413);
  const row = await x.create('access_export', ID.pending);
  expect((await x.request(`requests/${row.requestId}?space=work`, 'GET', undefined, ID.pending)).status).toBe(200);
  expect((await x.act(row, 'prepare_local_export', ID.pending)).status).toBe(403);
  expect((await x.request('operations/requests', 'GET', undefined, ID.admin)).status).toBe(403);
  x.f.setPolicy({ ...syntheticRightsPolicy(), privacyOperatorIds: [ID.admin] });
  expect((await x.request('operations/requests', 'GET', undefined, ID.superadmin)).status).toBe(503);
});
it.each(['file','sqlite-v1','file-v2'] as const)('%s serves a fresh attachment with analytics/personalization off; replay returns metadata only', async format => {
  const x = await setup(format); await x.memory(); const row = await x.create(), eventId = randomUUID();
  const response = await x.act(row, 'prepare_local_export', ID.alice, eventId);
  expect(response.status).toBe(200); expect(response.headers.get('content-disposition')).toMatch(/^attachment;/); expect(response.headers.get('x-vox-rights-request-id')).toBe(row.requestId);
  expect(response.headers.get('cache-control')).toBe('no-store'); const data = await response.json(); expect(JSON.stringify(data)).toContain('CURRENT_PRIVATE_CANARY'); expect(data.coverage).toMatchObject({ providers: 'unavailable', backups: 'unavailable' });
  const retry = await x.act(row, 'prepare_local_export', ID.alice, eventId); expect(retry.headers.has('content-disposition')).toBe(false);
  expect(await retry.json()).toMatchObject({ replayed: true, request: { state: 'local_export_prepared', localExport: { delivery: 'unverified' } } });
  expect(JSON.stringify(x.f.repository.read(accountIdFor(ID.alice)))).not.toContain('CURRENT_PRIVATE_CANARY');
});
it.each(['file','sqlite-v1','file-v2'] as const)('%s suppresses a stale attachment after source mutation during the awaited ledger commit', async format => {
  const x = await setup(format); await x.memory(); const row = await x.create();
  const transact = x.f.storage.transact.bind(x.f.storage); vi.spyOn(x.f.storage, 'transact').mockImplementationOnce(async (...args) => { const result = await transact(...args); await x.adaptive.withAccountDocument(ID.alice, d => { d.memories[0].status = 'deleted'; delete d.memories[0].text; d.memories[0].revision++; d.revision++; }); return result; });
  const response = await x.act(row); expect(response.status).toBe(409); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('CURRENT_PRIVATE_CANARY');
  expect(x.rights.detail(ID.alice, 'work', row.requestId).request).toMatchObject({ state: 'local_export_prepared', localExport: { delivery: 'unverified' } });
  const fresh = await x.act({ ...row, revision: 2 }); expect(fresh.status).toBe(200); expect(await fresh.text()).not.toContain('CURRENT_PRIVATE_CANARY');
});
it.each(['member','policy','profile'] as const)('drops export when %s changes after ledger commit and never claims delivery', async kind => {
  const x = await setup(); await x.memory(); const row = await x.create(), transact = x.f.storage.transact.bind(x.f.storage);
  vi.spyOn(x.f.storage, 'transact').mockImplementationOnce(async (...args) => { const result = await transact(...args);
    if (kind === 'member') await x.h.store.update(state => { state.members.find(m => m.telegramId === ID.alice)!.role = 'pending'; });
    else if (kind === 'policy') x.f.setPolicy(undefined);
    else await x.adaptive.withAccountDocument(ID.alice, d => { delete d.binding; d.revision++; }); return result; });
  const response = await x.act(row); expect([403,409,503]).toContain(response.status); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('CURRENT_PRIVATE_CANARY');
});
it('suppresses shared text if requester shared authority changes after the awaited receipt commit', async () => {
  const x = await setup('file-v2', true); const shared = x.sharedService!;
  const preview = await shared.preview(ID.alice, { space: 'work', kind: 'selected', recipientTelegramIds: [ID.bob] });
  await shared.create(ID.alice, { space: 'work', previewToken: preview.previewToken, agentIds: [], text: 'SHARED_PRIVATE_CANARY', expectedRevision: 0, eventId: randomUUID() });
  const row = await x.create(), transact = x.f.storage.transact.bind(x.f.storage);
  vi.spyOn(x.f.storage, 'transact').mockImplementationOnce(async (...args) => { const result = await transact(...args); await x.h.store.update(state => { state.members.find(m => m.telegramId === ID.alice)!.role = 'pending'; }); return result; });
  const response = await x.act(row); expect([403,409]).toContain(response.status); expect(await response.text()).not.toContain('SHARED_PRIVATE_CANARY');
});
it('actual Next route delegates signed handling and normalizes initialization failures', async () => {
  const x = await setup(); mocked.getStudio.mockResolvedValue(x.h.studio); const previous = process.env.VOXX_BOT_TOKEN; process.env.VOXX_BOT_TOKEN = TOKEN;
  try {
    const req = new Request('https://vox.synthetic/api/studio/rights?space=work', { headers: { 'x-telegram-init-data': signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN) } });
    const result = await GET(req, { params: Promise.resolve({}) }); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ requests: [] });
    mocked.getStudio.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_ERROR'));
    const failed = await POST(req, { params: Promise.resolve({ path: ['requests'] }) }); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('PRIVATE_PROVIDER_ERROR');
  } finally { if (previous === undefined) delete process.env.VOXX_BOT_TOKEN; else process.env.VOXX_BOT_TOKEN = previous; }
});
it('denies an attachment after a source expiry deadline crosses during the ledger commit without a source write', async () => {
  const x = await setup(); await x.memory();
  await x.adaptive.withAccountDocument(ID.alice, d => { d.memories[0].expiresAt = NOW + 10; d.revision++; });
  const row = await x.create(), transact = x.f.storage.transact.bind(x.f.storage);
  vi.spyOn(x.f.storage, 'transact').mockImplementationOnce(async (...args) => { const result = await transact(...args); x.setNow(NOW + 10); return result; });
  const response = await x.act(row); expect(response.status).toBe(409); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('CURRENT_PRIVATE_CANARY');
});
it('denies shared export after group membership changes without a shared-body write', async () => {
  const x = await setup('sqlite-v1', true), shared = x.sharedService!;
  await x.h.store.update(state => { state.groups.push({ chatId: -123, title: 'Synthetic', memberIds: [ID.alice, ID.bob], hasGuests: false, agentIds: [], addedAt: new Date(NOW).toISOString() }); });
  const { groupId } = await import('../../studio/org-bridge');
  const preview = await shared.preview(ID.alice, { space: 'work', kind: 'group', groupId: groupId(-123), recipientTelegramIds: [] });
  await shared.create(ID.alice, { space: 'work', previewToken: preview.previewToken, agentIds: [], text: 'GROUP_PRIVATE_CANARY', expectedRevision: 0, eventId: randomUUID() });
  const row = await x.create(), transact = x.f.storage.transact.bind(x.f.storage);
  vi.spyOn(x.f.storage, 'transact').mockImplementationOnce(async (...args) => { const result = await transact(...args); await x.h.store.update(state => { state.groups[0].memberIds = [ID.alice]; }); return result; });
  const response = await x.act(row); expect(response.status).toBe(409); expect(await response.text()).not.toContain('GROUP_PRIVATE_CANARY');
});

it('keeps own export available when another recipient profile expired; the final fence never reads that private account', async () => {
  const x = await setup('file-v2', true), shared = x.sharedService!;
  const preview = await shared.preview(ID.alice, { space: 'work', kind: 'selected', recipientTelegramIds: [ID.bob] });
  await shared.create(ID.alice, { space: 'work', previewToken: preview.previewToken, agentIds: [], text: 'AUTHORIZED_SHARED', expectedRevision: 0, eventId: randomUUID() });
  await x.adaptive.withAccountDocument(ID.bob, d => { delete d.binding; d.revision++; });
  const row = await x.create(), read = vi.spyOn(x.adaptive, 'readAuthorityNow');
  const response = await x.act(row); expect(response.status).toBe(200); expect(await response.text()).toContain('AUTHORIZED_SHARED');
  expect(read.mock.calls.every(([id]) => id === ID.alice)).toBe(true);
});

it('disables new intake when the only allowlisted privacy operator loses its current owner role', async () => {
  const x = await setup();
  await x.h.store.update(state => { state.members.find(m => m.telegramId === ID.superadmin)!.role = 'member'; });
  const snapshot = await (await x.request('')).json(); expect(snapshot).toMatchObject({ available: false, supportedKinds: [], policyStatus: 'unavailable' });
  expect((await x.request('requests', 'POST', x.f.input())).status).toBe(503);
  expect(x.f.repository.read(accountIdFor(ID.alice))).toBeNull();
});
it('uses the actual signed auth_date boundary and rejects expiry during awaited JSON body reading without receipt allocation', async () => {
  const x = await setup(); let authNow = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => authNow);
  const auth = signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN, Math.floor(NOW / 1000) - 86_400);
  // Exactly 24 hours remains valid under verifyInitData's existing semantics.
  expect((await x.request('', 'GET', undefined, ID.alice, { 'x-telegram-init-data': auth })).status).toBe(200);
  const read = Request.prototype.json;
  vi.spyOn(Request.prototype, 'json').mockImplementationOnce(async function(this: Request) { const body = await read.call(this); authNow += 1000; return body; });
  const response = await x.request('requests', 'POST', x.f.input(), ID.alice, { 'x-telegram-init-data': auth });
  expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'authentication_required' });
  expect(x.f.repository.read(accountIdFor(ID.alice))).toBeNull();
});
it('aborts a draft if signed authentication expires at the durable ledger commit fence', async () => {
  const x = await setup(); let authNow = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => authNow);
  const auth = signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN, Math.floor(NOW / 1000) - 86_400);
  const transact = x.f.storage.transact.bind(x.f.storage);
  vi.spyOn(x.f.storage, 'transact').mockImplementationOnce((id, mutate, fence) => transact(id, mutate, () => { authNow += 1000; fence?.(); }));
  const response = await x.request('requests', 'POST', x.f.input(), ID.alice, { 'x-telegram-init-data': auth });
  expect(response.status).toBe(401); expect(x.f.repository.read(accountIdFor(ID.alice))).toBeNull();
});
it('withholds a receipt response if authentication expires after commit; a new valid session reconciles the same event', async () => {
  const x = await setup(); let authNow = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => authNow);
  const input = x.f.input(), auth = signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN, Math.floor(NOW / 1000) - 86_400);
  const transact = x.f.storage.transact.bind(x.f.storage);
  vi.spyOn(x.f.storage, 'transact').mockImplementationOnce(async (...args) => { const result = await transact(...args); authNow += 1000; return result; });
  const response = await x.request('requests', 'POST', input, ID.alice, { 'x-telegram-init-data': auth });
  expect(response.status).toBe(401); expect(await response.text()).not.toContain('requestId');
  expect(x.f.repository.read(accountIdFor(ID.alice))!.requests).toHaveLength(1);
  const reconciled = await x.request('requests', 'POST', input); expect(reconciled.status).toBe(200); expect(await reconciled.json()).toMatchObject({ replayed: true });
});
it('denies operator metadata if its signed session expires while enumeration is awaiting disk', async () => {
  const x = await setup(); await x.create(); let authNow = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => authNow);
  const auth = signInitData({ id: ID.superadmin, first_name: 'Synthetic' }, TOKEN, Math.floor(NOW / 1000) - 86_400), list = x.f.storage.listAccounts.bind(x.f.storage);
  vi.spyOn(x.f.storage, 'listAccounts').mockImplementationOnce(async input => { const page = await list(input); authNow += 1000; return page; });
  const response = await x.request('operations/requests', 'GET', undefined, ID.superadmin, { 'x-telegram-init-data': auth });
  expect(response.status).toBe(401); const text = await response.text(); expect(text).not.toContain('operationHandle'); expect(text).not.toContain('accountRef');
});
it('rejects attachment publication when init-data expires during serialization, preserving prepared/delivery-unverified metadata', async () => {
  const x = await setup(); await x.memory(); const row = await x.create(); let authNow = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => authNow);
  const auth = signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN, Math.floor(NOW / 1000) - 86_400), prepare = x.lifecycle.prepareAccountExport.bind(x.lifecycle);
  vi.spyOn(x.lifecycle, 'prepareAccountExport').mockImplementationOnce(async (...args) => { const result = await prepare(...args);
    Object.defineProperty(result.data, 'toJSON', { value() { authNow += 1000; return { ...result.data }; }, enumerable: false }); return result; });
  const response = await x.request(`requests/${row.requestId}/actions?space=work`, 'POST', { version: 1, eventId: randomUUID(), expectedRevision: row.revision, action: 'prepare_local_export' }, ID.alice, { 'x-telegram-init-data': auth });
  expect(response.status).toBe(401); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('CURRENT_PRIVATE_CANARY');
  expect(x.f.repository.read(accountIdFor(ID.alice))!.requests[0]).toMatchObject({ state: 'local_export_prepared', localExport: { delivery: 'unverified' } });
});
it('does not close an existing request if the signed requester session expires at the action commit boundary', async () => {
  const x = await setup(); const row = await x.create(); let authNow = NOW;
  vi.spyOn(Date, 'now').mockImplementation(() => authNow);
  const auth = signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN, Math.floor(NOW / 1000) - 86_400), transact = x.f.storage.transact.bind(x.f.storage);
  vi.spyOn(x.f.storage, 'transact').mockImplementationOnce((id, mutate, fence) => transact(id, mutate, () => { authNow += 1000; fence?.(); }));
  const response = await x.request(`requests/${row.requestId}/actions?space=work`, 'POST', { version: 1, eventId: randomUUID(), expectedRevision: 1, action: 'withdraw_request' }, ID.alice, { 'x-telegram-init-data': auth });
  expect(response.status).toBe(401); expect(x.f.repository.read(accountIdFor(ID.alice))!.requests[0]).toMatchObject({ revision: 1, state: 'received' });
});
