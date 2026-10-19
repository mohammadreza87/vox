import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, readdirSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AdaptiveRepository, accountIdFor } from '../repository';
import { ManagedFileV2Storage } from './managed-storage';
const paths: string[] = [], stores: ManagedFileV2Storage[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const p of paths.splice(0)) rmSync(p, { recursive: true, force: true }); });
async function fixture() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'vox-file-v2-synthetic-')); paths.push(directory);
  const path = join(directory, 'store'); let now = 2000;
  const storage = new ManagedFileV2Storage(path, { now: () => now, newStoreSeed: { generation: 2, lifecycleWatermark: 1000 } }); stores.push(storage);
  const repo = new AdaptiveRepository(storage);
  await repo.transaction(accountIdFor(123), () => now, d => { d.declaration = { adultConfirmed: true, declaredAt: now }; });
  return { directory, path, storage, repo, now: () => now, setNow: (n: number) => { now = n; } };
}
it('separately persists compact lifecycle observations without materializing canonical bodies', async () => {
  const f = await fixture(), count = f.storage.io.canonicalImageReads;
  f.setNow(5000); f.storage.observeLifecycleTime(5000);
  expect(f.storage.io.canonicalImageReads).toBe(count); expect(f.storage.readMetadata().lifecycleWatermark).toBe(5000);
  f.storage.close(); const reopened = new ManagedFileV2Storage(f.path, { now: () => 4000 }); stores.push(reopened);
  expect(() => reopened.readCommittedForEffect(accountIdFor(123))).toThrow(/clock_regression/);
  expect(reopened.io.canonicalImageReads).toBe(0);
});
it('suppresses post-publication guard denial without claiming canonical rollback and carries the denial time', async () => {
  const f = await fixture(); let guards = 0;
  await expect(f.repo.transaction(accountIdFor(123), f.now, d => { d.declaration!.declaredJurisdiction = 'CURRENT'; }, () => {
    guards++; if (guards === 2) { f.setNow(5000); throw Error('synthetic expiry after publish'); }
  })).rejects.toMatchObject({ reason: 'denied', committed: true });
  const record = f.storage.readCommittedForEffect(accountIdFor(123)); expect(record.status).toBe('ready');
  if (record.status === 'ready') expect(JSON.stringify(record.document)).toContain('CURRENT');
  expect(f.storage.readMetadata().lifecycleWatermark).toBe(5000);
});
it('removes superseded images after atomic publication while retaining current-state equality', async () => {
  const f = await fixture();
  for (let i = 0; i < 4; i++) await f.repo.transaction(accountIdFor(123), f.now, d => { d.revision++; d.declaration!.declaredJurisdiction = `CURRENT_${i}`; });
  expect(readdirSync(join(f.path, 'records')).filter(name => name.endsWith('.json'))).toHaveLength(1);
  expect(JSON.stringify((f.storage.readCommittedForEffect(accountIdFor(123)) as { document: unknown }).document)).toContain('CURRENT_3');
});
it('rejects malformed head identity/order and record symlinks before exposing payloads', async () => {
  const f = await fixture(); const file = join(f.path, 'head.json'), head = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...head, generation: 999 })); expect(() => f.storage.readCommittedForEffect(accountIdFor(123))).toThrow(/corrupt/);
  writeFileSync(file, JSON.stringify(head)); const record = join(f.path, 'records', `${head.accounts[0].file}.json`);
  const original = readFileSync(record); const target = join(f.directory, 'symlink-target.json'); writeFileSync(target, original);
  rmSync(record); symlinkSync(target, record); expect(() => f.storage.readCommittedForEffect(accountIdFor(123))).toThrow(/corrupt/);
});
it('rejects unknown legacy owner/active leases and constructor failure releases its new ownership', async () => {
  const f = await fixture(); expect(() => new ManagedFileV2Storage(f.path)).toThrow(/busy/); f.storage.close();
  expect(() => new ManagedFileV2Storage(f.path, { now: f.now, newStoreSeed: { generation: 2, lifecycleWatermark: 2000 } })).toThrow(/corrupt/);
  const reopened = new ManagedFileV2Storage(f.path, { now: f.now }); stores.push(reopened); expect(reopened.identity).toEqual(f.storage.identity);
});
