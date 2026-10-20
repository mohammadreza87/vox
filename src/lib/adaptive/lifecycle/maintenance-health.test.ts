import { afterEach, expect, it, vi } from 'vitest';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { FileAdaptiveStorage, type AdaptiveStorage } from '../persistence/storage';
import { AdaptiveMaintenanceRunner, CHECKPOINT } from './maintenance';
import type { AdaptiveLifecycleService } from './service';
import { readMaintenanceHealth } from './maintenance-health';
import { maintenanceHealthSchema, unconfiguredMaintenanceHealth } from './maintenance-health-contracts';
const dirs: string[] = [], NOW = 10_000;
const checkpoint = (overrides: Record<string, unknown> = {}) => ({ schemaVersion: 1, status: 'continued', pages: 2, accounts: 5, updatedAt: NOW - 100, cursor: 'a'.repeat(64), ...overrides });
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'vox-maint-health-')); dirs.push(dir); const storage = new FileAdaptiveStorage(join(dir, 'checkpoints')); const file = join(storage.directory, createHash('sha256').update(CHECKPOINT).digest('hex') + '.json'); return { dir, storage, file, seed: (raw: unknown) => storage.transact(CHECKPOINT, () => ({ document: raw, result: undefined })), health: (now = NOW) => readMaintenanceHealth(storage, () => now) }; }
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
it('missing state is observed without creating directory, data, lock or clock', () => { const f = fixture(); expect(f.health()).toEqual({ version: 1, state: 'not_started', observedAt: NOW, checkpoint: null, leaseExpiresAt: null, reason: null }); expect(readdirSync(f.dir)).toEqual([]); });
it.each(['continued', 'completed', 'failed'] as const)('projects only committed %s activity/count metadata without reads mutating anything', async status => {
  const f = fixture(); await f.seed(checkpoint({ status, ...(status === 'completed' ? { cursor: undefined } : {}), ...(status === 'failed' ? { failure: 'sweep_failed' } : {}) }));
  const before = readFileSync(f.file), info = statSync(f.file);
  const write = vi.spyOn(f.storage, 'transact').mockRejectedValue(Error('must not write'));
  vi.spyOn(f.storage, 'readCommittedForEffect').mockImplementation(() => { throw Error('must not use unbounded read'); });
  const health = f.health(); expect(health).toMatchObject({ state: status, checkpoint: { recordedStatus: status, checkpointedPages: 2, checkpointedAccounts: 5, updatedAt: NOW - 100 } });
  expect(maintenanceHealthSchema.safeParse(health).success).toBe(true); expect(readFileSync(f.file)).toEqual(before); expect(statSync(f.file).mtimeMs).toBe(info.mtimeMs); expect(write).not.toHaveBeenCalled(); expect(readdirSync(f.storage.directory)).toHaveLength(1); expect(JSON.stringify(health)).not.toContain('a'.repeat(64));
});
it('lease state retains prior failure and exact boundary means stale, not liveness', async () => { const f = fixture(); await f.seed(checkpoint({ status: 'failed', failure: 'sweep_failed', lease: { token: '11111111-1111-4111-8111-111111111111', workerId: 'PRIVATE_WORKER', until: NOW + 1000 } })); expect(f.health()).toMatchObject({ state: 'leased', leaseExpiresAt: NOW + 1000, checkpoint: { recordedStatus: 'failed', failure: 'sweep_failed' } }); expect(f.health(NOW + 1000)).toMatchObject({ state: 'stale', reason: 'lease_expired' }); expect(JSON.stringify(f.health())).not.toMatch(/PRIVATE_WORKER|11111111/); });
it('real worker activity, final committed page and restart are independently observable', async () => {
  const f = fixture(), accounts = new FileAdaptiveStorage(join(f.dir, 'accounts')); await accounts.transact('telegram-account:123', () => ({ document: { accountId: 'telegram-account:123' }, result: undefined }));
  let enter!: () => void, release!: () => void; const entered = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  const lifecycle = { sweepAccount: vi.fn(async () => {}), sweepShared: vi.fn(async () => {}) } as unknown as AdaptiveLifecycleService;
  const runner = new AdaptiveMaintenanceRunner(lifecycle, accounts, f.storage, { now: () => NOW, leaseMs: 1000, afterAccount: async () => { enter(); await gate; } });
  const running = runner.runPage({ workerId: 'synthetic' }); await entered;
  expect(f.health()).toMatchObject({ state: 'leased', checkpoint: { checkpointedPages: 0, checkpointedAccounts: 0 } }); release(); expect((await running).state).toBe('completed');
  expect(readMaintenanceHealth(new FileAdaptiveStorage(f.storage.directory), () => NOW)).toMatchObject({ state: 'completed', checkpoint: { checkpointedPages: 1, checkpointedAccounts: 1 } });
});
it('busy lock suppresses all snapshot fields without opening corrupt payload', async () => { const f = fixture(); await f.seed(checkpoint()); writeFileSync(f.file, '{PRIVATE'); mkdirSync(f.file + '.lock', { mode: 0o700 }); expect(f.health()).toEqual({ version: 1, state: 'busy', observedAt: NOW, checkpoint: null, leaseExpiresAt: null, reason: 'checkpoint_locked' }); });
it.each([{}, checkpoint({ private: 'PRIVATE_CANARY' }), checkpoint({ status: 'failed' }), checkpoint({ failure: 'sweep_failed' }), checkpoint({ status: 'completed' }), checkpoint({ lease: { token: '11111111-1111-4111-8111-111111111111', workerId: 'worker', until: NOW - 100 } })])('invalid record fails closed without snapshot or content', async raw => { const f = fixture(); await f.seed(raw); const h = f.health(); expect(h).toMatchObject({ state: 'unavailable', reason: 'invalid_checkpoint', checkpoint: null, leaseExpiresAt: null }); expect(JSON.stringify(h)).not.toContain('PRIVATE'); });
it('future checkpoint is clock regression and does not replace retained bytes', async () => { const f = fixture(); await f.seed(checkpoint({ updatedAt: NOW + 1 })); const before = readFileSync(f.file); expect(f.health()).toMatchObject({ state: 'unavailable', reason: 'clock_regressed', observedAt: NOW }); expect(readFileSync(f.file)).toEqual(before); });
it.each([NaN, Infinity, -1, 1.5])('invalid trusted clock %s has no observed timestamp', now => { const f = fixture(); expect(f.health(now)).toMatchObject({ state: 'unavailable', reason: 'invalid_clock', observedAt: null, checkpoint: null }); });
it('unsupported store has no fallback transaction', () => { const storage = { transact: vi.fn() } as unknown as AdaptiveStorage; expect(readMaintenanceHealth(storage, () => NOW)).toMatchObject({ state: 'unavailable', reason: 'unsupported_store' }); expect(storage.transact).not.toHaveBeenCalled(); });
it.each(['malformed', 'oversized', 'world-readable', 'hardlink', 'symlink', 'lock-symlink', 'ancestor-symlink'] as const)('unsafe or unreadable %s does not appear healthy', async kind => {
  const f = fixture(); await f.seed(checkpoint());
  if (kind === 'malformed') writeFileSync(f.file, '{PRIVATE');
  if (kind === 'oversized') writeFileSync(f.file, ' '.repeat(16_385));
  if (kind === 'world-readable') chmodSync(f.file, 0o644);
  if (kind === 'hardlink') linkSync(f.file, join(f.dir, 'other.json'));
  if (kind === 'symlink') { const target = join(f.dir, 'target'); writeFileSync(target, readFileSync(f.file)); rmSync(f.file); symlinkSync(target, f.file); }
  if (kind === 'lock-symlink') symlinkSync(f.dir, f.file + '.lock');
  if (kind === 'ancestor-symlink') { const alias = join(f.dir, 'alias'); symlinkSync(f.storage.directory, alias); expect(readMaintenanceHealth(new FileAdaptiveStorage(alias), () => NOW)).toMatchObject({ state: 'unavailable', reason: 'unsafe_path' }); return; }
  const h = f.health(); expect(h.state).toBe('unavailable'); expect(h.checkpoint).toBeNull(); expect(JSON.stringify(h)).not.toContain('PRIVATE');
});
it('strict client-safe contract refuses missing/extra/misleading state combinations', () => {
  const empty = unconfiguredMaintenanceHealth(); expect(maintenanceHealthSchema.safeParse(empty).success).toBe(true);
  for (const invalid of [{}, { ...empty, observedAt: NOW }, { ...empty, workerId: 'PRIVATE' }, { ...empty, state: 'not_started' }, { ...empty, state: 'unavailable', reason: 'invalid_clock', observedAt: NOW }, { ...empty, state: 'completed', checkpoint: { updatedAt: NOW, recordedStatus: 'completed', checkpointedPages: 0, checkpointedAccounts: 0, failure: null } }]) expect(maintenanceHealthSchema.safeParse(invalid).success).toBe(false);
});

it('continued without cursor or lease is incoherent and cannot claim pending pages', async () => {
  const f = fixture(); await f.seed(checkpoint({cursor:undefined,pages:1,accounts:1})); const before=readFileSync(f.file);
  expect(f.health()).toMatchObject({state:'unavailable',reason:'invalid_checkpoint',checkpoint:null,leaseExpiresAt:null}); expect(readFileSync(f.file)).toEqual(before);
});
it('initial continued with no cursor remains valid while its lease is held or expired', async () => {
  const f=fixture();await f.seed(checkpoint({cursor:undefined,pages:0,accounts:0,lease:{token:'11111111-1111-4111-8111-111111111111',workerId:'synthetic',until:NOW+1000}}));
  expect(f.health()).toMatchObject({state:'leased',checkpoint:{recordedStatus:'continued',checkpointedPages:0,checkpointedAccounts:0}});
  expect(f.health(NOW+1000)).toMatchObject({state:'stale',reason:'lease_expired',checkpoint:{recordedStatus:'continued',checkpointedPages:0,checkpointedAccounts:0}});
});
