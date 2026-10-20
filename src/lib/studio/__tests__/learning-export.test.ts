import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { SqliteAdaptiveStorage } from '../../adaptive/persistence/indexed/sqlite-storage';
import { ManagedFileV2Storage } from '../../adaptive/persistence/indexed/managed-storage';
import { ProductPauseService } from '../../adaptive/product-pause/service';
import { AdaptiveLifecycleService } from '../../adaptive/lifecycle/service';
import { SharedMemoryRepository } from '../../adaptive/shared/repository';
import { SharedMemoryService } from '../../adaptive/shared/service';
import { sharedAuthorityFromStudioStore } from '../shared-authority';
import { groupId } from '../org-bridge';
import { signInitData } from '../auth';
import { handleLearningRequest } from '../learning-http';
import { ID, makeStudio, seedOrg } from './helpers';
const NOW = Date.UTC(2026, 9, 20, 12), TOKEN = '123:synthetic-immediate-export';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) await close(); });
async function setup(format: 'file' | 'file-v2' | 'sqlite-v1' = 'file', shared = false) {
  const h = makeStudio(); await seedOrg(h); let now = NOW;
  const directory = join(h.dir, 'canonical'), storage = format === 'file' ? new FileAdaptiveStorage(directory)
    : format === 'file-v2' ? new ManagedFileV2Storage(directory, { now: () => now, newStoreSeed: { generation: 1, lifecycleWatermark: 0, schemaVersion: 2 } }) : new SqliteAdaptiveStorage(directory, { now: () => now, newStoreSeed: { generation: 1, lifecycleWatermark: 0, schemaVersion: 2 } });
  cleanup.push(async () => { if ('close' in storage) storage.close(); await rm(h.dir, { recursive: true, force: true }); });
  const policy = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-immediate-export', enabledCapabilities: ['core_text'],
    accounts: [ID.alice, ID.bob].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: [{ schemaVersion: 1, id: 'synthetic-core', revision: 1, createdAt: NOW, updatedAt: NOW, jurisdiction: 'SYNTHETIC', capability: 'core_text', state: 'approved', configurationVersion: 'synthetic-immediate-export', effectiveAt: NOW, reviewExpiresAt: NOW + 100_000_000, owner: 'synthetic', approvalReference: 'synthetic-only' }] }));
  const adaptive = new AdaptiveService(new AdaptiveRepository(storage), { ...policy, now: () => now });
  for (const id of [ID.alice, ID.bob]) await adaptive.confirm(id, { confirm: true, adultConfirmed: true });
  for (const space of ['work', 'personal'] as const) {
    const state = await adaptive.read(ID.alice, space);
    await adaptive.createMemory(ID.alice, { space, text: `OWN_${space}_CANARY`, expectedRevision: state.revision, eventId: randomUUID() });
  }
  const sharedService = shared ? new SharedMemoryService(new SharedMemoryRepository(new FileAdaptiveStorage(join(h.dir, 'shared'))), adaptive, sharedAuthorityFromStudioStore(h.store), () => now) : undefined;
  const lifecycle = new AdaptiveLifecycleService(adaptive, { shared: sharedService }); h.studio.deps.lifecycle = lifecycle;
  const request = (space = 'work', auth = signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN)) => handleLearningRequest(h.studio,
    new Request(`https://vox.synthetic/api/studio/learning/export?space=${space}`, { headers: { 'x-telegram-init-data': auth } }), ['export'], TOKEN);
  const duringMemberRead = (change: () => Promise<unknown> | void) => {
    const prepare = lifecycle.prepareAccountExport.bind(lifecycle);
    vi.spyOn(lifecycle, 'prepareAccountExport').mockImplementationOnce(async (...args) => {
      const prepared = await prepare(...args), read = h.store.read.bind(h.store);
      vi.spyOn(h.store, 'read').mockImplementationOnce(async () => { const state = await read(); await change(); return state; });
      return prepared;
    });
  };
  return { h, directory, storage, adaptive, lifecycle, sharedService, request, duringMemberRead, setNow: (value: number) => { now = value; } };
}
it.each(['file', 'file-v2', 'sqlite-v1'] as const)('%s keeps immediate export usable with optional purposes off and preserves attachment schema/scope', async format => {
  const x = await setup(format);
  if (format !== 'file') await new ProductPauseService(x.adaptive).command(ID.alice, { version: 1, eventId: randomUUID(), expectedCommandSeq: 0, space: 'work', action: 'pause' });
  const state = await x.adaptive.read(ID.alice, 'work');
  expect(state.purposes.some(p => p.state === 'granted')).toBe(false);
  const response = await x.request(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-disposition')).toBe('attachment; filename="vox-work-export.json"');
  const data = await response.json(); expect(data).toMatchObject({ schemaVersion: 1, accountId: accountIdFor(ID.alice), space: 'work', coverage: { providers: 'unavailable', backups: 'unavailable' } });
  expect(JSON.stringify(data)).toContain('OWN_work_CANARY'); expect(JSON.stringify(data)).not.toContain('OWN_personal_CANARY');
  if (format === 'file') { expect(x.storage.canonicalSchemaVersion).toBeUndefined(); expect(await readdir(x.directory)).not.toContain('adaptive.managed'); }
  else expect(data.productPause).toMatchObject({ productPaused: true });
});
it.each(['file', 'file-v2', 'sqlite-v1'] as const)('%s suppresses a stale attachment when source changes during the final awaited membership read', async format => {
  const x = await setup(format);
  x.duringMemberRead(() => x.adaptive.withAccountDocument(ID.alice, d => { d.memories[0].status = 'deleted'; delete d.memories[0].text; d.memories[0].revision++; d.revision++; }));
  const response = await x.request(); expect(response.status).toBe(409); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('OWN_work_CANARY');
  const fresh = await x.request(); expect(fresh.status).toBe(200); expect(await fresh.text()).not.toContain('OWN_work_CANARY');
});
it('denies an expired profile even when the membership read returns the prior approved member', async () => {
  const x = await setup(); x.duringMemberRead(() => x.setNow(NOW + 12 * 60 * 60_000));
  const response = await x.request(); expect([403, 409, 503]).toContain(response.status); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('OWN_work_CANARY');
});
it('rechecks committed membership after awaited membership loading and source serialization', async () => {
  const x = await setup(); x.duringMemberRead(() => x.h.store.update(state => { state.members.find(m => m.telegramId === ID.alice)!.role = 'pending'; }));
  const response = await x.request(); expect(response.status).toBe(409); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('OWN_work_CANARY');
});
it('rechecks the unchanged signed auth_date age after a delayed membership read', async () => {
  const x = await setup(); let authNow = NOW; vi.spyOn(Date, 'now').mockImplementation(() => authNow);
  const auth = signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN, Math.floor(NOW / 1000) - 86_400);
  x.duringMemberRead(() => { authNow += 1000; });
  const response = await x.request('work', auth); expect(response.status).toBe(401); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('OWN_work_CANARY');
});
it('rechecks signed auth after serialization and accepts the exact existing 24-hour boundary', async () => {
  const x = await setup(); let authNow = NOW; vi.spyOn(Date, 'now').mockImplementation(() => authNow);
  const auth = signInitData({ id: ID.alice, first_name: 'Synthetic' }, TOKEN, Math.floor(NOW / 1000) - 86_400);
  expect((await x.request('work', auth)).status).toBe(200);
  const prepare = x.lifecycle.prepareAccountExport.bind(x.lifecycle);
  vi.spyOn(x.lifecycle, 'prepareAccountExport').mockImplementationOnce(async (...args) => { const prepared = await prepare(...args);
    Object.defineProperty(prepared.data, 'toJSON', { enumerable: false, value() { authNow += 1000; return { ...prepared.data }; } }); return prepared; });
  const response = await x.request('work', auth); expect(response.status).toBe(401); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('OWN_work_CANARY');
});
it('denies changed shared group authority during the awaited membership read without modifying shared bodies', async () => {
  const x = await setup('file', true), shared = x.sharedService!;
  await x.h.store.update(state => { state.groups.push({ chatId: -123, title: 'Synthetic', memberIds: [ID.alice, ID.bob], hasGuests: false, agentIds: [], addedAt: new Date(NOW).toISOString() }); });
  const preview = await shared.preview(ID.alice, { space: 'work', kind: 'group', groupId: groupId(-123), recipientTelegramIds: [] });
  await shared.create(ID.alice, { space: 'work', previewToken: preview.previewToken, agentIds: [], text: 'SHARED_EXPORT_CANARY', expectedRevision: 0, eventId: randomUUID() });
  x.duringMemberRead(() => x.h.store.update(state => { state.groups[0].memberIds = [ID.alice]; }));
  const response = await x.request(); expect(response.status).toBe(409); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('SHARED_EXPORT_CANARY');
});
it('preserves the legacy FILE runtime composition with an empty shared store and all optional purposes off', async () => {
  const x = await setup('file', true);
  expect((await x.adaptive.read(ID.alice, 'work')).purposes.some(p => p.state === 'granted')).toBe(false);
  const response = await x.request(); expect(response.status).toBe(200);
  const data = await response.json(); expect(data.coverage.shared).toBe('authorized_published_only');
  expect(JSON.stringify(data)).toContain('OWN_work_CANARY'); expect(JSON.stringify(data)).not.toContain('OWN_personal_CANARY');
  expect(x.storage.canonicalSchemaVersion).toBeUndefined();
  expect(await readdir(x.h.dir)).not.toContain('canonical.managed');
});
