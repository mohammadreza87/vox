import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { accountIdFor } from '../persistence/repository';
import type { RetentionAction } from './contracts';
import { rightsFixture, NOW, syntheticRightsPolicy } from './fixtures';
import { fail } from './repository';

const fixtures: Awaited<ReturnType<typeof rightsFixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map(f => f.close()));
});

async function prepared(action: RetentionAction['action'] = 'reassess_retention') {
  const f = await rightsFixture();
  fixtures.push(f);
  f.setPolicy({
    ...syntheticRightsPolicy(),
    retention: { requestReviewAfterMs: 100, auditRetentionMs: 100, receiptRetentionMs: 1000 },
    retentionOperations: { terminalRetentionMs: 50, continuityRetentionMs: 200 },
  });
  const row = (await f.service.create(101, f.input('erasure'))).request;
  if (action === 'purge_terminal_record') {
    await f.service.requesterAction(101, 'work', row.requestId, {
      version: 1, eventId: randomUUID(), expectedRevision: row.revision, action: 'withdraw_request',
    });
  }
  f.setNow(NOW + 100);
  const operation = (await f.service.operations(999)).requests.find(r => r.requestId === row.requestId)!;
  const input: RetentionAction = {
    version: 1, eventId: randomUUID(), expectedRevision: operation.revision,
    expectedPolicyRevision: operation.retentionPolicyRevision!, action, operationHandle: operation.operationHandle,
  };
  return { ...f, row, input };
}

it.each(['reassess_retention', 'purge_terminal_record'] as const)(
  '%s waits through a brief postcommit reader conflict without repeating its durable effect',
  async action => {
    const f = await prepared(action);
    const read = vi.spyOn(f.repository, 'read').mockImplementationOnce(() => fail(503, 'rights_storage_busy'));
    await expect(f.service.retentionAction(999, f.row.requestId, f.input)).resolves.toEqual({
      replayed: false, requestId: f.row.requestId,
      outcome: action === 'purge_terminal_record' ? 'purged' : 'reassessed',
    });
    expect(read).toHaveBeenCalledTimes(2);
    read.mockRestore();
    await expect(f.service.retentionAction(999, f.row.requestId, f.input)).resolves.toMatchObject({ replayed: true });
    const ledger = f.repository.read(accountIdFor(101))!;
    expect(ledger.commandReceipts.filter(r => r.eventId === f.input.eventId)).toHaveLength(1);
    if (action === 'reassess_retention') {
      expect(ledger.requests[0].revision).toBe(2);
      expect(ledger.requests[0].audit.filter(a => a.action === 'retention_reassessed')).toHaveLength(1);
    } else {
      expect(ledger.requests).toEqual([]);
      expect(ledger.tombstones).toHaveLength(1);
    }
  },
);

it.each([
  ['operator', 'privacy_operator_required'],
  ['policy', 'reviewed_policy_unavailable'],
  ['handle', 'operation_handle_invalid'],
] as const)('rechecks %s authority after waiting for the committed acknowledgement', async (boundary, code) => {
  const f = await prepared();
  const read = vi.spyOn(f.repository, 'read').mockImplementationOnce(() => {
    if (boundary === 'operator') f.denyOperator();
    if (boundary === 'policy') f.setPolicy(undefined);
    if (boundary === 'handle') f.setNow(NOW + 10_101);
    return fail(503, 'rights_storage_busy');
  });
  await expect(f.service.retentionAction(999, f.row.requestId, f.input)).rejects.toMatchObject({ code });
  read.mockRestore();
  expect(f.repository.read(accountIdFor(101))!.requests[0].revision).toBe(2);
});

it('does not retry a non-contention read failure or repeat an already committed action', async () => {
  const f = await prepared();
  const read = vi.spyOn(f.repository, 'read').mockImplementationOnce(() => fail(503, 'rights_storage_unavailable'));
  await expect(f.service.retentionAction(999, f.row.requestId, f.input)).rejects.toMatchObject({ code: 'rights_storage_unavailable' });
  expect(read).toHaveBeenCalledTimes(1);
  read.mockRestore();
  expect(f.repository.read(accountIdFor(101))!.requests[0].revision).toBe(2);
});

it.each([
  ['operator', 'privacy_operator_required'],
  ['policy', 'reviewed_policy_unavailable'],
  ['handle', 'operation_handle_invalid'],
] as const)('rechecks %s at publication after a successful committed read', async (boundary, code) => {
  const f = await prepared();
  const originalRead = f.repository.read.bind(f.repository);
  const read = vi.spyOn(f.repository, 'read').mockImplementationOnce(accountId => {
    const current = originalRead(accountId);
    queueMicrotask(() => {
      if (boundary === 'operator') f.denyOperator();
      if (boundary === 'policy') f.setPolicy(undefined);
      if (boundary === 'handle') f.setNow(NOW + 10_101);
    });
    return current;
  });
  await expect(f.service.retentionAction(999, f.row.requestId, f.input)).rejects.toMatchObject({ code });
  read.mockRestore();
  expect(f.repository.read(accountIdFor(101))!.requests[0].revision).toBe(2);
});

it('keeps the existing finite read budget when postcommit contention does not clear', async () => {
  const f = await prepared();
  const read = vi.spyOn(f.repository, 'read').mockImplementation(() => fail(503, 'rights_storage_busy'));
  await expect(f.service.retentionAction(999, f.row.requestId, f.input)).rejects.toMatchObject({ code: 'rights_storage_busy' });
  expect(read.mock.calls.length).toBeGreaterThan(1);
  read.mockRestore();
  expect(f.repository.read(accountIdFor(101))!.requests[0].revision).toBe(2);
});
