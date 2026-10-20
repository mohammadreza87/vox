import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { accountIdFor } from '../persistence/repository';
import type { RetentionAction } from './contracts';
import { RightsIntakeService } from './service';
import { rightsFixture, NOW, syntheticRightsPolicy } from './fixtures';
const fixtures: Awaited<ReturnType<typeof rightsFixture>>[] = [];
const policy = () => ({ ...syntheticRightsPolicy(), retention: { requestReviewAfterMs: 100, auditRetentionMs: 100, receiptRetentionMs: 1000 }, retentionOperations: { terminalRetentionMs: 50, continuityRetentionMs: 200 } });
async function setup() { const f = await rightsFixture(); fixtures.push(f); f.setPolicy(policy()); return f; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(fixtures.splice(0).map(f => f.close())); });
async function command(f: Awaited<ReturnType<typeof setup>>, action: RetentionAction['action'], requestId?: string): Promise<RetentionAction> {
  const row = (await f.service.operations(999)).requests.find(r => !requestId || r.requestId === requestId)!;
  return { version: 1, eventId: randomUUID(), expectedRevision: row.revision, expectedPolicyRevision: row.retentionPolicyRevision!, action, operationHandle: row.operationHandle };
}
async function closed(f: Awaited<ReturnType<typeof setup>>) { const input = f.input('erasure'), row = (await f.service.create(101, input)).request; await f.service.requesterAction(101, 'work', row.requestId, { version: 1, eventId: randomUUID(), expectedRevision: 1, action: 'withdraw_request' }); return { input, row }; }
it('reassesses unresolved requests after review time without closing or rewriting deadlines; exact concurrent retry writes once', async () => {
  const f = await setup(), row = (await f.service.create(101, f.input('erasure'))).request;
  f.setNow(NOW + 100); const input = await command(f, 'reassess_retention');
  expect(f.service.snapshot(101, 'work').available).toBe(false);
  const results = await Promise.all([f.service.retentionAction(999, row.requestId, input), f.service.retentionAction(999, row.requestId, input)]);
  expect(results.map(r => r.replayed).sort()).toEqual([false, true]);
  const current = f.service.detail(101, 'work', row.requestId).request;
  expect(current).toMatchObject({ state: 'received', revision: 2, retentionReviewRequired: false, retention: { reviewOrExpiryAt: NOW + 200 } });
  expect(current.deadline).toEqual(row.deadline); expect(current.coverage).toEqual(row.coverage);
  expect(f.service.snapshot(101, 'work').available).toBe(true);
  await expect(f.service.retentionAction(999, row.requestId, { ...input, eventId: randomUUID() })).rejects.toMatchObject({ code: 'rights_conflict' });
  await expect(f.service.retentionAction(999, row.requestId, await command(f, 'purge_terminal_record'))).rejects.toMatchObject({ code: 'rights_retention_not_eligible' });
  expect(f.repository.read(accountIdFor(101))!.requests).toHaveLength(1);
});
it('purges only eligible closed detail, keeps minimal scoped continuity, rejects replay resurrection across restart and then expires continuity', async () => {
  const f = await setup(), { input: create, row } = await closed(f);
  await expect(f.service.retentionAction(999, row.requestId, await command(f, 'purge_terminal_record'))).rejects.toMatchObject({ code: 'rights_retention_not_eligible' });
  f.setNow(NOW + 100); const input = await command(f, 'purge_terminal_record');
  expect(await f.service.retentionAction(999, row.requestId, input)).toMatchObject({ replayed: false, outcome: 'purged' });
  expect(await f.service.retentionAction(999, row.requestId, input)).toMatchObject({ replayed: true, outcome: 'purged' });
  const d = f.repository.read(accountIdFor(101))!;
  expect(d.requests).toEqual([]); expect(d.commandReceipts.every(c => c.action === 'purged_record' && c.recordedAt === NOW + 100 && c.resultingRequestRevision === 2)).toBe(true); expect(Object.keys(d.tombstones[0]).sort()).toEqual(['lastRevision','purgedAt','requestId','retainUntil','space']);
  expect(d.tombstones[0].retainUntil).toBe(NOW + 1100); // includes the purge receipt's horizon
  expect(JSON.stringify(d)).not.toMatch(/localeAtSubmission|reasonCode|actorRef|deadline|coverage|request_received/);
  const restart = new RightsIntakeService(f.repository, f.options);
  await expect(restart.create(101, create)).rejects.toMatchObject({ status: 410, code: 'rights_record_expired' });
  await expect(restart.create(101, { ...create, kind: 'access_export' })).rejects.toMatchObject({ code: 'rights_conflict' });
  expect(() => restart.detail(101, 'work', row.requestId)).toThrow('rights_record_expired');
  expect(() => restart.detail(102, 'work', row.requestId)).toThrow('not_found');
  expect(restart.snapshot(101, 'personal').expiredRequests).toEqual([]);
  expect(restart.snapshot(101, 'work').expiredRequests).toHaveLength(1);
  expect((await restart.create(101, f.input())).request.requestId).not.toBe(row.requestId);
  f.setNow(NOW + 1050); await expect(restart.create(101, create)).rejects.toMatchObject({ status: 410 });
  f.setNow(NOW + 1101); const open = f.service.snapshot(101, 'work').requests[0];
  await f.service.retentionAction(999, open.requestId, await command(f, 'reassess_retention', open.requestId));
  await f.service.create(101, f.input());
  expect(f.repository.read(accountIdFor(101))!.tombstones).toEqual([]);
});
it('requires explicit current policy, strict schema, CAS and fresh operator authority through the commit fence', async () => {
  const f = await setup(), { row } = await closed(f); f.setNow(NOW + 100);
  const input = await command(f, 'purge_terminal_record');
  await expect(f.service.retentionAction(998, row.requestId, input)).rejects.toMatchObject({ status: 403 });
  await expect(f.service.retentionAction(999, row.requestId, { ...input, expectedPolicyRevision: 2 })).rejects.toMatchObject({ code: 'rights_conflict' });
  await expect(f.service.retentionAction(999, row.requestId, { ...input, action: 'erase_account' } as unknown as RetentionAction)).rejects.toThrow();
  f.setPolicy(syntheticRightsPolicy()); await expect(f.service.retentionAction(999, row.requestId, input)).rejects.toMatchObject({ code: 'rights_retention_policy_unavailable' });
  f.setPolicy(policy()); const before = f.repository.read(accountIdFor(101)), transact = f.storage.transact.bind(f.storage);
  vi.spyOn(f.storage, 'transact').mockImplementationOnce((id, mutate, fence) => transact(id, mutate, () => { f.denyOperator(); fence?.(); }));
  await expect(f.service.retentionAction(999, row.requestId, input)).rejects.toMatchObject({ status: 403 });
  expect(f.repository.read(accountIdFor(101))).toEqual(before);
});
it('reassesses terminal dates only on explicit command, preserving legal deadlines and remaining purge eligible', async () => {
  const f = await setup(), { row } = await closed(f); f.setNow(NOW + 100);
  const before = f.service.detail(101, 'work', row.requestId).request;
  await f.service.retentionAction(999, row.requestId, await command(f, 'reassess_retention'));
  expect(f.service.detail(101, 'work', row.requestId).request).toMatchObject({ state: 'closed_unfulfilled', deadline: before.deadline, retention: { reviewOrExpiryAt: NOW + 100 }, revision: 3 });
  await f.service.retentionAction(999, row.requestId, await command(f, 'purge_terminal_record'));
  expect(f.repository.read(accountIdFor(101))!.requests).toEqual([]);
});
it('validates legacy v1 without rewriting on read and upgrades only the next authorized commit', async () => {
  const f = await setup(); await f.service.create(101, f.input());
  const { tombstones, ...current } = f.repository.read(accountIdFor(101))!; expect(tombstones).toEqual([]);
  delete current.requests[0].retention.auditRetainUntil;
  const file = join(f.directory, createHash('sha256').update(accountIdFor(101)).digest('hex') + '.json');
  await writeFile(file, JSON.stringify({ ...current, version: 1 })); const bytes = await readFile(file, 'utf8');
  expect(f.service.snapshot(101, 'work').requests).toHaveLength(1); expect(await readFile(file, 'utf8')).toBe(bytes);
  await f.service.create(101, f.input()); expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(2);
});
it('policy shortening alone never removes the recorded audit floor; only explicit reassessment can change it', async () => {
  const f = await setup(); f.setPolicy({ ...policy(), retention: { ...policy().retention, auditRetentionMs: 500 } });
  const { row } = await closed(f); f.setNow(NOW + 100); f.setPolicy({ ...policy(), revision: 2 });
  const input = await command(f, 'purge_terminal_record');
  await expect(f.service.retentionAction(999, row.requestId, input)).rejects.toMatchObject({ code: 'rights_retention_not_eligible' });
  expect(f.service.detail(101, 'work', row.requestId).request.retention.auditRetainUntil).toBe(NOW + 500);
  await f.service.retentionAction(999, row.requestId, await command(f, 'reassess_retention'));
  expect(f.service.detail(101, 'work', row.requestId).request.retention.auditRetainUntil).toBe(NOW + 100);
  await f.service.retentionAction(999, row.requestId, await command(f, 'purge_terminal_record'));
});
it('requires explicit review for legacy unbound retention and leaves persisted time regression closed after purge', async () => {
  const f = await setup(), { row } = await closed(f);
  const current = f.repository.read(accountIdFor(101))!, file = join(f.directory, createHash('sha256').update(accountIdFor(101)).digest('hex') + '.json');
  delete current.requests[0].retention.auditRetainUntil; delete current.requests[0].retention.terminalRetainUntil;
  const { tombstones, ...legacy } = current; expect(tombstones).toEqual([]); await writeFile(file, JSON.stringify({ ...legacy, version: 1 }));
  f.setNow(NOW + 100);
  expect((await f.service.operations(999)).requests[0].retentionAt).toBeUndefined();
  await expect(f.service.retentionAction(999, row.requestId, await command(f, 'purge_terminal_record'))).rejects.toMatchObject({ code: 'rights_retention_not_eligible' });
  await f.service.retentionAction(999, row.requestId, await command(f, 'reassess_retention'));
  await f.service.retentionAction(999, row.requestId, await command(f, 'purge_terminal_record'));
  f.setNow(NOW + 99);
  expect(() => new RightsIntakeService(f.repository, f.options).snapshot(101, 'work')).toThrow('rights_clock_unavailable');
});
