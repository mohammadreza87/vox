import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { accountIdFor } from '../persistence/repository';
import type { AccountLedger } from './contracts';
import { RightsIntakeService } from './service';
import { rightsFixture, NOW, syntheticRightsPolicy } from './fixtures';
const fixtures: Awaited<ReturnType<typeof rightsFixture>>[] = [];
const setup = async () => { const f = await rightsFixture(); fixtures.push(f); return f; };
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(fixtures.splice(0).map(f => f.close())); });
it('does not allocate on read; records one request across concurrent retry and restart', async () => {
  const f = await setup(); expect(f.service.snapshot(101, 'work').requests).toEqual([]);
  expect(f.repository.read(accountIdFor(101))).toBeNull();
  const input = f.input(); const results = await Promise.all([f.service.create(101, input), f.service.create(101, input)]);
  expect(results.map(r => r.replayed).sort()).toEqual([false, true]);
  expect(f.repository.read(accountIdFor(101))!.requests).toHaveLength(1);
  const restarted = new RightsIntakeService(f.repository, f.options);
  expect((await restarted.create(101, input)).request.requestId).toBe(results[0].request.requestId);
  expect(restarted.snapshot(101, 'personal').requests).toEqual([]);
  expect(() => restarted.detail(102, 'work', results[0].request.requestId)).toThrow('not_found');
  expect(() => restarted.detail(101, 'personal', results[0].request.requestId)).toThrow('not_found');
  expect(results[0].request.requester).toEqual({ assurance: 'signed_telegram_account', personVerification: 'not_established' });
  expect(results[0].request.deadline).toEqual({ state: 'reviewed_policy_unavailable', dueAt: null, reason: 'no_matching_rule' });
});
it('rejects semantic collisions and stale CAS while exact retry returns current state', async () => {
  const f = await setup(), input = f.input(); const created = await f.service.create(101, input);
  await expect(f.service.create(101, { ...input, kind: 'erasure' })).rejects.toMatchObject({ status: 409 });
  const close = { version: 1 as const, eventId: randomUUID(), expectedRevision: 1, action: 'withdraw_request' as const };
  await f.service.requesterAction(101, 'work', created.request.requestId, close);
  expect((await f.service.create(101, input)).request.state).toBe('closed_unfulfilled');
  expect((await f.service.requesterAction(101, 'work', created.request.requestId, close)).result.replayed).toBe(true);
  await expect(f.service.requesterAction(101, 'work', created.request.requestId, { ...close, eventId: randomUUID() })).rejects.toMatchObject({ status: 409 });
});
it('has no missing/future/expired/malformed/copy-mismatched policy or implicit operator fallback', async () => {
  const f = await setup();
  for (const policy of [undefined, {}, { ...syntheticRightsPolicy(), effectiveAt: NOW + 1 }, { ...syntheticRightsPolicy(), expiresAt: NOW }, { ...syntheticRightsPolicy(), privacyOperatorIds: [] }, { ...syntheticRightsPolicy(), noticeHashes: { en: 'a'.repeat(64), fa: 'b'.repeat(64) } }]) {
    f.setPolicy(policy); expect(f.service.snapshot(101, 'work').available).toBe(false);
    await expect(f.service.create(101, f.input())).rejects.toMatchObject({ status: 503 });
    expect(f.repository.read(accountIdFor(101))).toBeNull();
  }
});
it('reads/replays existing metadata under unavailable policy without allocating or changing the ledger', async () => {
  const f = await setup(), input = f.input(); await f.service.create(101, input);
  const before = f.repository.read(accountIdFor(101)); f.setPolicy(undefined);
  expect(f.service.snapshot(101, 'work')).toMatchObject({ available: false, policyStatus: 'unavailable' });
  expect(await f.service.create(101, input)).toMatchObject({ replayed: true, policyStatus: 'unavailable' });
  expect(f.repository.read(accountIdFor(101))).toEqual(before);
});
it('does not infer legal deadlines; exact reviewed account rules preserve server anchor', async () => {
  const f = await setup(); f.setPolicy({ ...syntheticRightsPolicy(), deadlineRules: [{ id: 'exact-synthetic-rule', accountId: accountIdFor(101), space: 'work', kind: 'access_export', dueAfterMs: 9876 }] });
  const row = (await f.service.create(101, f.input())).request;
  expect(row.deadline).toMatchObject({ state: 'scheduled', anchorAt: NOW, dueAt: NOW + 9876, ruleId: 'exact-synthetic-rule' });
  f.setPolicy({ ...syntheticRightsPolicy(), revision: 2 });
  expect(f.service.detail(101, 'work', row.requestId).request.deadline).toEqual(row.deadline);
});
it('flags reached retention review and refuses new admissions without evicting unresolved evidence', async () => {
  const f = await setup(); await f.service.create(101, f.input()); f.setNow(NOW + 10_000_000);
  expect(f.service.snapshot(101, 'work')).toMatchObject({ available: false, requests: [{ retentionReviewRequired: true }] });
  await expect(f.service.create(101, f.input())).rejects.toMatchObject({ code: 'rights_retention_review_required' });
  expect(f.repository.read(accountIdFor(101))!.requests).toHaveLength(1);
});
it('enforces open and audit capacity before committing rather than evicting a request', async () => {
  const f = await setup(); for (let i = 0; i < 20; i++) await f.service.create(101, f.input());
  await expect(f.service.create(101, f.input())).rejects.toMatchObject({ code: 'rights_capacity' });
  expect(f.repository.read(accountIdFor(101))!.requests).toHaveLength(20);
});
it('rejects clock regression after restart and invalid/overflow clocks without writes', async () => {
  const f = await setup(); await f.service.create(101, f.input()); f.setNow(NOW - 1);
  expect(() => new RightsIntakeService(f.repository, f.options).snapshot(101, 'work')).toThrow('rights_clock_unavailable');
  f.setNow(NaN); await expect(f.service.create(102, f.input())).rejects.toMatchObject({ code: 'rights_clock_unavailable' });
  f.setNow(Number.MAX_SAFE_INTEGER + 1); await expect(f.service.create(102, f.input())).rejects.toMatchObject({ code: 'rights_clock_unavailable' });
  expect(f.repository.read(accountIdFor(102))).toBeNull();
});
it('rejects malformed nested partitions, duplicate IDs, audit gaps and private unknown fields', async () => {
  const f = await setup(); await f.service.create(101, f.input()); const original = f.repository.read(accountIdFor(101))!;
  const file = join(f.directory, createHash('sha256').update(accountIdFor(101)).digest('hex') + '.json');
  for (const corrupt of [
    (d: AccountLedger) => { d.requests[0].accountId = accountIdFor(102); },
    (d: AccountLedger) => { d.requests.push(d.requests[0]); },
    (d: AccountLedger) => { d.commandReceipts.push(d.commandReceipts[0]); },
    (d: AccountLedger) => { d.requests[0].audit[0].seq = 2; },
    (d: AccountLedger) => { d.requests[0].state = 'operator_review'; },
    (d: AccountLedger) => { Object.assign(d.requests[0], { body: 'PRIVATE_CANARY' }); },
  ]) { const d = structuredClone(original); corrupt(d); await writeFile(file, JSON.stringify(d)); expect(() => f.service.snapshot(101, 'work')).toThrow('rights_storage_unavailable'); }
});
it('requires configured operator authority, encrypts addressing and bounds cursor pages', async () => {
  const f = await setup(); const created = await f.service.create(101, f.input('erasure')); await f.service.create(102, f.input());
  await expect(f.service.operations(101)).rejects.toMatchObject({ status: 403 });
  const page = await f.service.operations(999); expect(page.requests).toHaveLength(1); expect(page.nextCursor).toBeTruthy();
  const text = JSON.stringify(page); expect(text).not.toContain('telegram-account:'); expect(text).not.toContain('actorRef'); expect(text).not.toContain('personVerification');
  const next = await f.service.operations(999, page.nextCursor); expect(next.requests).toHaveLength(1); expect(next.requests[0].accountRef).not.toBe(page.requests[0].accountRef);
  await expect(f.service.operations(999, 'tampered-base64')).rejects.toMatchObject({ status: 403 });
  const row = [...page.requests, ...next.requests].find(r => r.requestId === created.request.requestId)!;
  const input = { version: 1 as const, eventId: randomUUID(), expectedRevision: row.revision, action: 'begin_review' as const, reasonCode: 'review_pending' as const, operationHandle: row.operationHandle };
  const reviewed = await f.service.operatorAction(999, row.requestId, input); expect(reviewed.request.state).toBe('operator_review');
  expect((await f.service.operatorAction(999, row.requestId, input)).replayed).toBe(true);
  await expect(f.service.operatorAction(999, row.requestId, { ...input, eventId: randomUUID() })).rejects.toMatchObject({ status: 409 });
  f.denyOperator(); await expect(f.service.operatorAction(999, row.requestId, input)).rejects.toMatchObject({ status: 403 });
});
it('denies expired handles, operator removal/policy changes during enumeration and unsupported fulfillment', async () => {
  const f = await setup(); const created = await f.service.create(101, f.input('erasure')), page = await f.service.operations(999), row = page.requests[0];
  await expect(f.service.requesterAction(101, 'work', created.request.requestId, { version: 1, eventId: randomUUID(), expectedRevision: 1, action: 'prepare_local_export' })).rejects.toMatchObject({ code: 'unsupported_action' });
  f.setNow(NOW + 10_000);
  await expect(f.service.operatorAction(999, row.requestId, { version: 1, eventId: randomUUID(), expectedRevision: 1, action: 'begin_review', reasonCode: 'review_pending', operationHandle: row.operationHandle })).rejects.toMatchObject({ code: 'operation_handle_invalid' });
  const list = f.storage.listAccounts.bind(f.storage); vi.spyOn(f.storage, 'listAccounts').mockImplementationOnce(async input => { const value = await list(input); f.setPolicy({ ...syntheticRightsPolicy(), privacyOperatorIds: [998] }); return value; });
  await expect(f.service.operations(999)).rejects.toMatchObject({ status: 503 });
});
it('rejects real writer contention and preserves committed receipt', async () => {
  const f = await setup(); await f.service.create(101, f.input()); const before = await readFile(join(f.directory, createHash('sha256').update(accountIdFor(101)).digest('hex') + '.json'), 'utf8');
  await mkdir(join(f.directory, createHash('sha256').update(accountIdFor(101)).digest('hex') + '.json.lock'));
  await expect(f.service.create(101, f.input())).rejects.toMatchObject({ code: 'rights_storage_busy' });
  expect(await readFile(join(f.directory, createHash('sha256').update(accountIdFor(101)).digest('hex') + '.json'), 'utf8')).toBe(before);
});
it('never persists or replays export bytes and records preparation with delivery unverified', async () => {
  const f = await setup(); let content = 'CURRENT_PRIVATE_CANARY', calls = 0;
  const service = new RightsIntakeService(f.repository, { ...f.options, prepareExport: async () => { calls++; return { data: { revision: calls, memories: [content] }, revalidate: () => undefined }; } });
  const row = (await service.create(101, f.input())).request;
  const input = { version: 1 as const, eventId: randomUUID(), expectedRevision: row.revision, action: 'prepare_local_export' as const };
  expect((await service.requesterAction(101, 'work', row.requestId, input)).prepared?.data.memories).toEqual(['CURRENT_PRIVATE_CANARY']);
  const stored = JSON.stringify(f.repository.read(accountIdFor(101))); expect(stored).not.toContain('CURRENT_PRIVATE_CANARY'); expect(stored).toContain('unverified');
  content = 'FRESH'; expect((await service.requesterAction(101, 'work', row.requestId, input)).prepared).toBeUndefined(); expect(calls).toBe(1);
  expect((await service.requesterAction(101, 'work', row.requestId, { ...input, eventId: randomUUID(), expectedRevision: 2 })).prepared?.data.memories).toEqual(['FRESH']);
});
it('keeps advancing clock samples coherent and never rebases a command when its receipt expires', async () => {
  const f = await setup(); let now = NOW;
  const advancing = new RightsIntakeService(f.repository, { ...f.options, clock: () => ++now });
  const input = f.input(), created = await advancing.create(101, input);
  const d = f.repository.read(accountIdFor(101))!; expect(d.observedServerTime).toBeGreaterThanOrEqual(created.request.updatedAt);
  now = NOW + 100_100;
  const action = { version: 1 as const, eventId: randomUUID(), expectedRevision: 1, action: 'withdraw_request' as const };
  await advancing.requesterAction(101, 'work', created.request.requestId, action);
  now += 100_100;
  await expect(advancing.requesterAction(101, 'work', created.request.requestId, action)).rejects.toMatchObject({ status: 409 });
  expect(f.repository.read(accountIdFor(101))!.requests).toHaveLength(1);
});
it('aborts a fresh draft if account or policy authority is removed at its commit fence', async () => {
  const f = await setup(), transact = f.storage.transact.bind(f.storage);
  vi.spyOn(f.storage, 'transact').mockImplementationOnce((id, mutate, fence) => transact(id, mutate, () => { f.denyAccount(); fence?.(); }));
  await expect(f.service.create(101, f.input())).rejects.toMatchObject({ status: 403 });
  expect(f.repository.read(accountIdFor(101))).toBeNull();
});
it('rejects a wrong-scope/other-operator operation handle without looking up its private account', async () => {
  const f = await setup(); await f.service.create(101, f.input()); const row = (await f.service.operations(999)).requests[0];
  f.setPolicy({ ...syntheticRightsPolicy(), privacyOperatorIds: [998,999] });
  const input = { version: 1 as const, eventId: randomUUID(), expectedRevision: 1, action: 'begin_review' as const, reasonCode: 'review_pending' as const, operationHandle: row.operationHandle };
  const read = vi.spyOn(f.repository, 'read');
  await expect(f.service.operatorAction(998, row.requestId, input)).rejects.toMatchObject({ status: 403 });
  expect(read).not.toHaveBeenCalled();
});
it('rejects shape-valid stored audit actions, actors and reason/state pairs that commands could never produce', async () => {
  const f = await setup(), created = await f.service.create(101, f.input('erasure'));
  await f.service.requesterAction(101, 'work', created.request.requestId, { version: 1, eventId: randomUUID(), expectedRevision: 1, action: 'withdraw_request' });
  const original = f.repository.read(accountIdFor(101))!, file = join(f.directory, createHash('sha256').update(accountIdFor(101)).digest('hex') + '.json');
  const corruptions = [
    (d: AccountLedger) => { d.requests[0].audit[1].actor = 'service'; },
    (d: AccountLedger) => { d.requests[0].audit[1].action = 'operator_pending'; },
    (d: AccountLedger) => { d.requests[0].audit[1].reasonCode = 'outside_supported_scope'; },
    (d: AccountLedger) => { const r = d.requests[0]; r.state = 'local_export_prepared'; r.reasonCode = 'supported_scope_only'; r.audit[1] = { ...r.audit[1], actor: 'service', action: 'local_export_prepared', to: 'local_export_prepared', reasonCode: 'supported_scope_only' }; r.localExport = { preparedAt: NOW, accountRevision: 1, scope: 'authorized_local_account_projection', delivery: 'unverified' }; r.coverage.localAccount = 'export_prepared'; r.coverage.shared = 'currently_authorized_published_only'; },
  ];
  for (const corrupt of corruptions) { const d = structuredClone(original); corrupt(d); await writeFile(file, JSON.stringify(d)); expect(() => f.service.snapshot(101, 'work')).toThrow('rights_storage_unavailable'); }
});
