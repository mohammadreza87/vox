import { afterEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { accountIdFor } from '../persistence/repository';
import { RightsIntakeService } from './service';
import { RightsFileStorage } from './storage';
import { RightsRepository } from './repository';
import { rightsFixture, NOW, syntheticRightsPolicy } from './fixtures';
const fixtures: Awaited<ReturnType<typeof rightsFixture>>[] = [], extraRoots: string[] = [];
const setup = async () => { const f = await rightsFixture(); fixtures.push(f); return f; };
afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.close())); await Promise.all(extraRoots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const fileFor = (directory: string) => join(directory, createHash('sha256').update(accountIdFor(101)).digest('hex') + '.json');
it('persists read observations without creating a request ledger or adaptive profile, and rejects restart regression', async () => {
  const f = await setup(); expect(f.service.snapshot(101, 'work').requests).toEqual([]);
  expect((await readdir(f.directory)).filter(name => !name.startsWith('.clock-v1'))).toEqual([]);
  f.setNow(syntheticRightsPolicy().expiresAt);
  expect(f.service.snapshot(101, 'work').available).toBe(false);
  expect(JSON.parse(await readFile(join(f.directory, '.clock-v1.json'), 'utf8')).observedServerTime).toBe(syntheticRightsPolicy().expiresAt);
  f.setNow(NOW);
  const restarted = new RightsIntakeService(new RightsRepository(new RightsFileStorage(f.directory)), f.options);
  expect(() => restarted.snapshot(101, 'work')).toThrow('rights_clock_unavailable');
  expect(f.repository.read(accountIdFor(101))).toBeNull();
});
it('cannot revive an expired operator handle by observing expiry and restarting at an earlier clock', async () => {
  const f = await setup(); await f.service.create(101, f.input()); const row = (await f.service.operations(999)).requests[0];
  const command = { version: 1 as const, eventId: randomUUID(), expectedRevision: 1, action: 'begin_review' as const, reasonCode: 'review_pending' as const, operationHandle: row.operationHandle };
  f.setNow(NOW + 10_000); await expect(f.service.operatorAction(999, row.requestId, command)).rejects.toMatchObject({ code: 'operation_handle_invalid' });
  f.setNow(NOW + 9_999); const restarted = new RightsIntakeService(new RightsRepository(new RightsFileStorage(f.directory)), f.options);
  await expect(restarted.operatorAction(999, row.requestId, command)).rejects.toMatchObject({ code: 'rights_clock_unavailable' });
  expect(f.repository.read(accountIdFor(101))!.requests[0].revision).toBe(1);
});
it('rejects record symlinks in requester reads, operator enumeration and mutations', async () => {
  const f = await setup(); await f.service.create(101, f.input()); const file = fileFor(f.directory), original = join(f.directory, 'saved-ledger.json');
  await rename(file, original); await symlink(original, file);
  expect(() => f.service.snapshot(101, 'work')).toThrow('rights_storage_unavailable');
  await expect(f.service.operations(999)).rejects.toMatchObject({ code: 'rights_storage_unavailable' });
  await expect(f.service.create(101, f.input())).rejects.toMatchObject({ code: 'rights_storage_unavailable' });
});
it('rejects a replaced rights root and existing root symlink without following it', async () => {
  const f = await setup(); await f.service.create(101, f.input()); const moved = f.directory + '-moved'; extraRoots.push(moved);
  await rename(f.directory, moved); await symlink(moved, f.directory);
  expect(() => f.service.snapshot(101, 'work')).toThrow('rights_storage_unavailable');
  expect(() => new RightsFileStorage(f.directory)).toThrow('rights_storage_unavailable');
});
it('rejects malformed or symlink clock metadata and leaves committed ledger intact', async () => {
  const f = await setup(); await f.service.create(101, f.input()); const file = fileFor(f.directory), original = await readFile(file, 'utf8'), clock = join(f.directory, '.clock-v1.json');
  await writeFile(clock, JSON.stringify({ version: 1, observedServerTime: NOW, privateBody: 'UNEXPECTED' }));
  expect(() => f.service.snapshot(101, 'work')).toThrow('rights_clock_unavailable');
  await rename(clock, clock + '.original'); await symlink(clock + '.original', clock);
  expect(() => f.service.snapshot(101, 'work')).toThrow('rights_storage_unavailable');
  expect(await readFile(file, 'utf8')).toBe(original);
});
it('creates 0700 rights directories and 0600 ledger/clock records under the configured root', async () => {
  const f = await setup(), nested = join(f.directory, 'rights-intake', 'v1'), storage = new RightsFileStorage(nested);
  const service = new RightsIntakeService(new RightsRepository(storage), f.options);
  await service.create(101, f.input());
  expect((await stat(nested)).mode & 0o777).toBe(0o700);
  expect((await stat(fileFor(nested))).mode & 0o777).toBe(0o600);
  expect((await stat(join(nested, '.clock-v1.json'))).mode & 0o777).toBe(0o600);
});
it('keeps an interrupted clock writer lock fail-closed for operator reconciliation', async () => {
  const f = await setup(); await f.service.create(101, f.input()); const before = await readFile(fileFor(f.directory), 'utf8');
  await writeFile(join(f.directory, '.clock-v1.lock'), '');
  expect(() => f.service.snapshot(101, 'work')).toThrow('rights_clock_unavailable');
  await expect(f.service.create(101, f.input())).rejects.toMatchObject({ code: 'rights_clock_unavailable' });
  expect((await readdir(f.directory)).includes('.clock-v1.lock')).toBe(true);
  expect(await readFile(fileFor(f.directory), 'utf8')).toBe(before);
});
