import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { handleLearningRequest } from '../learning-http';
import { signInitData } from '../auth';
import { unconfiguredMaintenanceHealth, type MaintenanceHealth } from '../../adaptive/lifecycle/maintenance-health-contracts';
import { ID, makeStudio, seedOrg } from './helpers';
const TOKEN = 'synthetic-maintenance-only';
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function fixture() {
  const h = makeStudio(); dirs.push(h.dir); await seedOrg(h);
  const health: MaintenanceHealth = { version: 1, state: 'failed', observedAt: 1000, checkpoint: { updatedAt: 900, recordedStatus: 'failed', checkpointedPages: 1, checkpointedAccounts: 3, failure: 'sweep_failed' }, leaseExpiresAt: null, reason: null };
  h.studio.deps.maintenanceHealth = vi.fn(() => health);
  const call = (id = ID.superadmin, auth?: string, path = 'operations', signal?: AbortSignal) => handleLearningRequest(h.studio, new Request('https://vox.synthetic/api/studio/learning/' + path, { headers: { 'x-telegram-init-data': auth ?? signInitData({ id, first_name: 'Synthetic' }, TOKEN) }, signal }), ['operations'], TOKEN);
  return { h, health, call };
}
it('off execution preserves readable metadata, with zero membership/state/checkpoint writes or enrollment', async () => {
  const { h, call, health } = await fixture(); const file = join(h.dir, 'studio.json'), before = readFileSync(file);
  const ensure = vi.spyOn(h.studio, 'ensureMember').mockRejectedValue(Error('must not enroll'));
  const write = vi.spyOn(h.store, 'update').mockRejectedValue(Error('must not mutate'));
  vi.spyOn(h.store, 'read').mockRejectedValue(Error('must use committed authority'));
  const response = await call(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ maintenanceConfigured: false, maintenance: health, improvementConfigured: false, report: null });
  expect(ensure).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(readFileSync(file)).toEqual(before);
});
it.each([ID.admin, ID.alice, ID.pending, ID.stranger])('nonoperator %s gets no health and no enrollment', async id => { const { h, call } = await fixture(); const ensure = vi.spyOn(h.studio, 'ensureMember'); expect((await call(id)).status).toBe(403); expect(h.studio.deps.maintenanceHealth).not.toHaveBeenCalled(); expect(ensure).not.toHaveBeenCalled(); });
it('missing observer capability is explicitly unobserved, never an empty completed pass', async () => { const { h, call } = await fixture(); h.studio.deps.maintenanceHealth = undefined; const response = await call(); expect((await response.json()).maintenance).toEqual(unconfiguredMaintenanceHealth()); });
it('role removed during awaited report is denied at final committed fence', async () => {
  const { h, call } = await fixture(); h.studio.deps.improvement = { report: vi.fn(async () => { await h.store.update(s => { s.members.find(m => m.telegramId === ID.superadmin)!.role = 'member'; }); return {} as never; }) };
  expect((await call()).status).toBe(409);
});
it('serialization cannot publish after committed operator removal', async () => {
  const { h, call } = await fixture(); const file = join(h.dir, 'studio.json');
  h.studio.deps.improvement = { report: vi.fn(async () => ({ toJSON: () => { const state = JSON.parse(readFileSync(file, 'utf8')); state.members.find((m: { telegramId: number }) => m.telegramId === ID.superadmin).role = 'member'; writeFileSync(file, JSON.stringify(state)); return { status: 'synthetic' }; } }) as never) };
  const response = await call(); expect(response.status).toBe(409); expect(await response.text()).not.toContain('checkpointedAccounts');
});
it('signed session expiry during serialization is rechecked immediately before publication', async () => {
  const { h, call } = await fixture(), now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
  const auth = signInitData({ id: ID.superadmin, first_name: 'Synthetic' }, TOKEN);
  h.studio.deps.improvement = { report: vi.fn(async () => ({ toJSON: () => { vi.mocked(Date.now).mockReturnValue(now + 86_401_000); return {}; } }) as never) };
  expect((await call(ID.superadmin, auth)).status).toBe(401);
});
it('duplicate authority, unsupported committed store, invalid health and aborted reads fail closed', async () => {
  const { h, call } = await fixture();
  h.studio.deps.maintenanceHealth = () => ({ ...unconfiguredMaintenanceHealth(), accountId: 'PRIVATE' }) as MaintenanceHealth;
  expect((await call()).status).toBe(503);
  h.studio.deps.maintenanceHealth = () => unconfiguredMaintenanceHealth();
  const controller = new AbortController(); controller.abort(); expect((await call(ID.superadmin, undefined, 'operations', controller.signal)).status).toBe(409);
  await h.store.update(s => { s.members.push({ ...s.members.find(m => m.telegramId === ID.superadmin)! }); }); expect((await call()).status).toBe(403);
  h.studio.deps.store = { ...h.store, readCommittedForEffect: undefined } as typeof h.store; expect((await call()).status).toBe(503);
});
it('unsigned requests and global-health query variants do not reach observer', async () => { const { h, call } = await fixture(); expect((await call(ID.superadmin, '')).status).toBe(401); expect((await call(ID.superadmin, undefined, 'operations?space=personal')).status).toBe(400); expect(h.studio.deps.maintenanceHealth).not.toHaveBeenCalled(); });

it('broken health capabilities and private report exceptions never become healthy/empty or leak raw error', async () => {
  const { h, call } = await fixture();
  h.studio.deps.maintenanceHealth = () => undefined as unknown as MaintenanceHealth;
  expect((await call()).status).toBe(503);
  h.studio.deps.maintenanceHealth = () => unconfiguredMaintenanceHealth();
  h.studio.deps.improvement = { report: vi.fn(async () => { throw Error('PRIVATE_RAW_ERROR_CANARY'); }) };
  const response = await call(); expect(response.status).toBe(503); expect(await response.json()).toEqual({error:'learning_unavailable'});
});
