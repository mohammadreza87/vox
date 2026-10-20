/** Independent RF2 contract regressions. Synthetic fixtures only; root owns acceptance.
 * Do not execute until the exact repaired candidate and this file are approved.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AdaptiveLifecycleService } from '../lifecycle/service';
import { accountIdFor, type AdaptiveDocument, type StoredMemory } from '../persistence/repository';
import { localUseFixture, syntheticLocalUsePolicy, RF1_NOW } from './local-use-fixtures';
import { prepareRightsLocalErasureLedger } from './conversion';
import { localErasureNotice, LOCAL_ERASURE_NOTICE_VERSION } from './local-erasure-notice';
import { RightsIntakeService } from './service';

const OWN = 101, OPERATOR = 999, CANARY = 'RF2_QA_SYNTHETIC_PRIVATE_فارسی';
const closes: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of closes.splice(0).reverse()) await close(); });
const sha = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
// Compare whole objects without printing synthetic private payloads in failure diffs.
const same = (actual: unknown, expected: unknown) => expect(sha(actual)).toBe(sha(expected));
function reviewedPolicy() {
  return { ...syntheticLocalUsePolicy(), version: 3 as const, localErasure: {
    version: 1 as const, approvalReference: 'SYNTHETIC independent RF2 approval', decisionReference: 'SYNTHETIC selected-note-only decision',
    assurance: 'signed_account_own_private_note' as const, topology: 'single_persistent_process' as const,
    scope: 'selected_manual_private_note_and_canonical_descendants' as const, allowedActions: ['plan', 'execute', 'reconcile'] as Array<'plan' | 'execute' | 'reconcile'>,
    noticeVersion: LOCAL_ERASURE_NOTICE_VERSION, noticeHashes: { en: sha(localErasureNotice.en), fa: sha(localErasureNotice.fa) },
    planLifetimeMs: 30_000, executionWindowMs: 60_000, metadataRetentionMs: 86_400_000, replayRetentionMs: 86_400_000, receiptRetentionMs: 86_400_000,
  } };
}
function files(directory: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (root: string, relative: string) => {
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(root, entry.name), key = relative + '/' + entry.name;
      if (entry.isDirectory()) walk(path, key);
      // SQLite reader-lock shared memory is process-local coordination, not durable state.
      else if (!entry.name.endsWith('-shm')) result[key] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  walk(directory, ''); return result;
}
async function fixture(format: 'file' | 'sqlite' = 'file') {
  const f = await localUseFixture(format); closes.push(f.close);
  const restriction = await f.create(); await f.prepare(); f.setPolicy(reviewedPolicy());
  let cancelled = false, operatorAllowed = true;
  const backend = new AdaptiveLifecycleService(f.adaptive);
  const options = { ...f.serviceOptions, localErasure: backend,
    assertRequestNow: () => { if (cancelled) throw Error('synthetic_request_cancelled'); },
    assertPrivateMemoryNow: (id: number) => { if (id !== OWN) throw Error('synthetic_private_scope_denied'); },
    assertOperatorNow: (id: number) => { if (!operatorAllowed || id !== OPERATOR) throw Error('synthetic_operator_denied'); },
  };
  const service = new RightsIntakeService(f.repository, options);
  const row = (await service.create(OWN, { version: 1, eventId: randomUUID(), space: 'work', kind: 'erasure', locale: 'en', expectedIntakePolicyRevision: 1 })).request;
  await prepareRightsLocalErasureLedger({ repository: f.repository, accountId: accountIdFor(OWN), policy: reviewedPolicy, clock: () => RF1_NOW, assertLocalAdministrationNow: () => {}, assertQuiescedNow: () => {} });
  const raw = (id = OWN): AdaptiveDocument => {
    const value = f.storage.readCommittedWithoutObservationForEffect?.(accountIdFor(id));
    if (value?.status !== 'ready' || !value.document) throw Error('synthetic_pure_snapshot_unavailable');
    return structuredClone(value.document) as AdaptiveDocument;
  };
  await f.adaptive.createMemory(OWN, { eventId: randomUUID(), space: 'work', expectedRevision: raw().revision, text: CANARY });
  const target = raw().memories.find(m => m.text === CANARY)!;
  const write = (mutate: (d: AdaptiveDocument) => void) => f.storage.transact(accountIdFor(OWN), value => {
    if (!value) throw Error('synthetic_missing_account'); const d = value as AdaptiveDocument; mutate(d); return { document: d, result: undefined };
  });
  const ledger = () => { const d = f.repository.read(accountIdFor(OWN)); if (d?.version !== 4) throw Error('synthetic_missing_v4'); return d; };
  const plan = (overrides: Partial<Parameters<RightsIntakeService['privateNoteErasurePlan']>[3]> = {}) => service.privateNoteErasurePlan(OWN, row.requestId, 'work', { version: 1, eventId: randomUUID(), expectedRequestRevision: row.revision, space: 'work', memoryId: target.id, expectedMemoryRevision: target.revision, locale: 'en', ...overrides });
  const execute = (p: ReturnType<typeof plan>) => service.privateNoteErasureExecute(OWN, row.requestId, 'work', { version: 1, eventId: p.eventId, planHandle: p.planHandle });
  return { ...f, options, service, backend, restriction, row, target, raw, write, ledger, plan, execute,
    cancel: () => { cancelled = true; }, denyOperator: () => { operatorAllowed = false; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function lostAcknowledgement(f: Fixture) {
  const p = f.plan(), transaction = f.repository.transaction.bind(f.repository); let writes = 0;
  vi.spyOn(f.repository, 'transaction').mockImplementation(async (...args) => {
    if (++writes === 2) throw Error('synthetic_acknowledgement_loss'); return transaction(...args);
  });
  const response = await f.execute(p); vi.restoreAllMocks();
  expect(response.operations[0]).toMatchObject({ technical: 'note_content_removed', recording: 'acknowledgement_pending' });
  return p;
}
const operationRow = async (f: Fixture) => {
  const rows = await f.service.operations(OPERATOR); const row = rows.requests.find(r => r.requestId === f.row.requestId);
  if (!row) throw Error('synthetic_missing_operator_row'); return row;
};

for (const format of ['file', 'sqlite'] as const) it(`RF2 independent ${format}: exact multi-source/stale-ref closure delta and immutable witness`, async () => {
  const f = await fixture(format);
  const ancestor = 'qa-other-authored', child = 'qa-derived-child', grandchild = 'qa-derived-grandchild', tombstone = 'qa-old-tombstone', unrelated = 'qa-unrelated-invalid';
  await f.write(d => {
    const note = (id: string, patch: Partial<StoredMemory> = {}): StoredMemory => ({ ...structuredClone(f.target), id, text: CANARY + id, ...patch });
    d.memories.push(note(ancestor), note(child, { sourceRefs: [{ id: f.target.id, revision: 9 }, { id: ancestor, revision: 1 }] }), note(grandchild, { sourceRefs: [{ id: child, revision: 1 }] }),
      note(tombstone, { text: undefined, status: 'deleted', revision: 4, revocationEpoch: 3, sourceRefs: [{ id: child, revision: 1 }] }),
      note(unrelated, { expiresAt: RF1_NOW - 1, sourceRefs: [{ id: 'qa-missing-unrelated', revision: 1 }] }), note('qa-personal', { space: 'personal' }));
  });
  const before = f.raw(), otherAccount = f.raw(102), p = f.plan(), response = await f.execute(p), after = f.raw();
  const changed = [f.target.id, child, grandchild];
  const expected = structuredClone(before); expected.revision++; expected.updatedAt = RF1_NOW;
  for (const id of changed) {
    const m = expected.memories.find(m => m.id === id)!; m.status = 'deleted'; delete m.text; m.revision++; m.revocationEpoch++; m.updatedAt = RF1_NOW;
  }
  // Existing entries must be exact prefixes. Independently inspect only the explicitly allowed new rows.
  same(after.events.slice(0, before.events.length), before.events); same(after.outbox.slice(0, before.outbox.length), before.outbox);
  const events = after.events.slice(before.events.length), outbox = after.outbox.slice(before.outbox.length);
  expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ eventId: p.eventId, kind: 'rights_private_note_erased', resultId: f.target.id, revision: before.revision + 1 });
  expect(outbox).toHaveLength(3); expect(new Set(outbox.map(r => r.eventId)).size).toBe(3);
  expect(outbox.map(r => r.memoryId).sort()).toEqual([...changed].sort());
  for (const row of outbox) expect(row).toMatchObject({ kind: 'memory_deleted', space: 'work', personId: before.personId, revision: before.revision + 1, epoch: 1, createdAt: RF1_NOW });
  expected.events.push(...events); expected.outbox.push(...outbox); same(after, expected); same(f.raw(102), otherAccount);
  const op = f.ledger().localErasure.operations[0]; expect(op.witness.map(w => w.id)).toEqual([f.target.id, child, grandchild, tombstone].sort());
  expect(events[0].fingerprint).toBe(op.fingerprint);
  for (const w of op.witness) expect(w).toMatchObject({ space: 'work', beforeRevision: w.id === tombstone ? 4 : 1, afterRevision: w.id === tombstone ? 4 : 2, beforeEpoch: w.id === tombstone ? 3 : 0, afterEpoch: w.id === tombstone ? 3 : 1, afterStatus: 'deleted' });
  expect(JSON.stringify(op)).not.toContain(CANARY); expect(JSON.stringify(response)).not.toContain(CANARY); expect(JSON.stringify(response)).not.toContain(f.target.id);
  const stable = f.raw(); await f.execute(p); same(f.raw(), stable); same(f.ledger().localErasure.operations[0], op);
  expect(f.ledger().requests.find(r => r.requestId === f.row.requestId)?.state).toBe('received');
});

for (const format of ['file', 'sqlite'] as const) for (const action of ['plan', 'rejected-plan', 'status', 'expired-applied', 'expired-intent'] as const) it(`RF2 independent ${format}: ${action} has no durable or clock-writer effects`, async () => {
  const f = await fixture(format), p = f.plan();
  if (action === 'expired-intent') { vi.spyOn(f.backend, 'eraseSelectedPrivateNote').mockRejectedValueOnce(Error('synthetic_before_effect')); await expect(f.execute(p)).rejects.toThrow(); vi.restoreAllMocks(); }
  if (action === 'status' || action === 'expired-applied') await f.execute(p);
  f.setNow(RF1_NOW + (action.startsWith('expired') ? 30_001 : 1));
  const canonical = f.raw(), ledger = f.ledger(), before = files(f.directory), watermark = f.storage.io.watermarkWrites;
  const observe = vi.spyOn(f.repository, 'observeTime'), clockWriter = vi.spyOn(f.rightsStorage, 'observeRightsTime'), canonicalWriter = vi.spyOn(f.storage, 'transact');
  if (action === 'plan') expect(f.plan().planHandle.length).toBeGreaterThan(40);
  else if (action === 'rejected-plan') expect(() => f.plan({ expectedRequestRevision: f.row.revision + 1 })).toThrow();
  else if (action === 'status') expect(f.service.privateNoteErasureStatus(OWN, f.row.requestId, 'work').operations[0].technical).toBe('note_content_removed');
  else expect(await f.execute(p)).toMatchObject({ replayed: true, operations: [{ technical: action === 'expired-applied' ? 'note_content_removed' : 'not_applied' }] });
  expect(observe).not.toHaveBeenCalled(); expect(clockWriter).not.toHaveBeenCalled(); expect(canonicalWriter).not.toHaveBeenCalled(); expect(f.storage.io.watermarkWrites).toBe(watermark);
  same(f.raw(), canonical); same(f.ledger(), ledger); same(files(f.directory), before);
});

for (const drift of ['epoch', 'event-kind', 'event-result', 'event-revision', 'restored-payload'] as const) it(`RF2 independent: historical acknowledgement never overrides ${drift} proof drift`, async () => {
  const f = await fixture(); await f.execute(f.plan());
  await f.write(d => { const m = d.memories.find(m => m.id === f.target.id)!, e = d.events.find(e => e.kind === 'rights_private_note_erased')!;
    if (drift === 'epoch') m.revocationEpoch++; if (drift === 'event-kind') e.kind = 'memory_deleted'; if (drift === 'event-result') e.resultId = 'qa-unrelated'; if (drift === 'event-revision') e.revision++; if (drift === 'restored-payload') m.text = CANARY;
  });
  const before = f.raw(), rights = f.ledger(), service = new RightsIntakeService(f.repository, f.options);
  expect(service.privateNoteErasureStatus(OWN, f.row.requestId, 'work').operations[0]).toMatchObject({ technical: 'unknown', recording: 'recorded', effectRevision: null, observedAt: null, coverage: { canonicalSelectedNote: 'unknown', canonicalDependentNotes: 'unknown', providers: 'not_implemented', backups: 'not_implemented', queuedDerivedUse: 'unknown' } });
  same(f.raw(), before); same(f.ledger(), rights);
});

for (const drift of ['cancellation', 'policy', 'rights-busy'] as const) it(`RF2 independent: final synchronous fence rejects ${drift} without canonical publication`, async () => {
  const f = await fixture(), p = f.plan(), before = f.raw(), transact = f.storage.transact.bind(f.storage);
  vi.spyOn(f.storage, 'transact').mockImplementationOnce((id, mutate, fence) => transact(id, mutate, () => {
    if (drift === 'cancellation') f.cancel(); if (drift === 'policy') f.setPolicy(undefined);
    if (drift === 'rights-busy') vi.spyOn(f.rightsStorage, 'readCommittedForEffect').mockReturnValue({ status: 'busy' });
    fence?.();
  }));
  await expect(f.execute(p)).rejects.toThrow(); vi.restoreAllMocks(); same(f.raw(), before);
  expect(f.ledger().localErasure.operations).toHaveLength(1); expect(f.ledger().localErasure.operations[0].acknowledgement).toBeUndefined();
});

it('RF2 independent: fresh request and policy authority can record existing proof without rebasing immutable intent', async () => {
  const f = await fixture(), p = await lostAcknowledgement(f), original = structuredClone(f.ledger().localErasure.operations[0]), canonical = f.raw();
  const old = await operationRow(f);
  await f.service.operatorAction(OPERATOR, f.row.requestId, { version: 1, eventId: randomUUID(), expectedRevision: old.revision, action: 'begin_review', reasonCode: 'review_pending', operationHandle: old.operationHandle });
  const nextPolicy = reviewedPolicy(); nextPolicy.revision++; nextPolicy.localErasure.approvalReference = 'SYNTHETIC refreshed reconcile approval'; f.setPolicy(nextPolicy);
  const current = await operationRow(f); expect(current.revision).toBe(original.requestRevision + 1); expect(current.localErasures?.[0].reconcileAllowed).toBe(true);
  await expect(f.service.reconcilePrivateNoteErasure(OPERATOR, f.row.requestId, old.operationHandle, p.eventId, randomUUID())).rejects.toThrow();
  const reconcileId = randomUUID(); const response = await f.service.reconcilePrivateNoteErasure(OPERATOR, f.row.requestId, current.operationHandle, p.eventId, reconcileId);
  expect(response.operations[0]).toMatchObject({ technical: 'note_content_removed', recording: 'recorded' });
  const { acknowledgement, ...intent } = f.ledger().localErasure.operations[0]; expect(acknowledgement).toBeDefined(); same(intent, original); same(f.raw(), canonical);
  const receipts = f.ledger().commandReceipts.filter(r => r.eventId === reconcileId); expect(receipts).toHaveLength(1); expect(receipts[0].action).toBe('private_note_erasure_reconcile');
  const stable = f.ledger(); await f.service.reconcilePrivateNoteErasure(OPERATOR, f.row.requestId, current.operationHandle, p.eventId, reconcileId); same(f.ledger(), stable); same(f.raw(), canonical);
  const operator = await operationRow(f); expect(JSON.stringify(operator)).not.toContain(f.target.id); expect(JSON.stringify(operator)).not.toContain(CANARY);
});

it('RF2 independent: a closed request or revoked operator cannot reconcile a durable effect', async () => {
  const f = await fixture(), p = await lostAcknowledgement(f), current = await operationRow(f), canonical = f.raw();
  await f.service.requesterAction(OWN, 'work', f.row.requestId, { version: 1, eventId: randomUUID(), expectedRevision: current.revision, action: 'withdraw_request' });
  const closed = await operationRow(f); expect(closed.localErasures?.[0]?.reconcileAllowed ?? false).toBe(false);
  await expect(f.service.reconcilePrivateNoteErasure(OPERATOR, f.row.requestId, closed.operationHandle, p.eventId, randomUUID())).rejects.toThrow();
  f.denyOperator(); await expect(f.service.reconcilePrivateNoteErasure(OPERATOR, f.row.requestId, closed.operationHandle, p.eventId, randomUUID())).rejects.toThrow(); same(f.raw(), canonical);
  expect(f.ledger().localErasure.operations[0].acknowledgement).toBeUndefined();
});

for (const field of ['account', 'space', 'request-kind', 'origin', 'sourceRefs'] as const) it(`RF2 independent: rejects ${field} authority/target mismatch without deletion`, async () => {
  const f = await fixture();
  if (field === 'origin' || field === 'sourceRefs') await f.write(d => { const m = d.memories.find(m => m.id === f.target.id)!; if (field === 'origin') m.origin = 'user_reviewed_claim'; else m.sourceRefs = [{ id: 'qa-unrelated', revision: 1 }]; });
  const before = f.raw();
  if (field === 'account') expect(() => f.service.privateNoteErasureStatus(102, f.row.requestId, 'work')).toThrow();
  else if (field === 'space') expect(() => f.service.privateNoteErasureStatus(OWN, f.row.requestId, 'personal')).toThrow();
  else if (field === 'request-kind') expect(() => f.service.privateNoteErasurePlan(OWN, f.restriction.requestId, 'work', { version: 1, eventId: randomUUID(), expectedRequestRevision: f.restriction.revision, space: 'work', memoryId: f.target.id, expectedMemoryRevision: f.target.revision, locale: 'en' })).toThrow();
  else expect(() => f.plan()).toThrow();
  same(f.raw(), before); expect(f.ledger().localErasure.operations).toHaveLength(0);
});

it('RF2 independent: target counter exhaustion cannot admit an effect or manufacture a witness', async () => {
  const f = await fixture(); await f.write(d => { d.memories.find(m => m.id === f.target.id)!.revocationEpoch = Number.MAX_SAFE_INTEGER; }); const before = f.raw();
  expect(() => f.plan()).toThrow(); same(f.raw(), before); expect(f.ledger().localErasure.operations).toHaveLength(0);
});

it('RF2 independent: escaped UTF8 witness bytes reject admission before an intent or canonical effect', async () => {
  const f = await fixture();
  const ids = Array.from({ length: 64 }, (_, i) => String(i).padStart(3, '0') + '\u0000'.repeat(197));
  // IDs alone exceed the complete rights-ledger byte budget when JSON escaped;
  // the closure is within the independent 300-row and depth-eight limits.
  expect(Buffer.byteLength(JSON.stringify(ids), 'utf8')).toBeGreaterThan(65_536);
  await f.write(d => { for (const id of ids) d.memories.push({ ...structuredClone(f.target), id, sourceRefs: [{ id: f.target.id, revision: f.target.revision }] }); });
  const canonical = f.raw();
  await expect(Promise.resolve().then(() => f.execute(f.plan()))).rejects.toThrow();
  same(f.raw(), canonical); expect(f.ledger().localErasure.operations).toHaveLength(0);
});

it('RF2 independent: ordinary ledger writers reserve a pending RF2 receipt alongside pending RF1 recovery', async () => {
  const f = await fixture(), p = f.plan();
  vi.spyOn(f.backend, 'eraseSelectedPrivateNote').mockRejectedValueOnce(Error('synthetic_before_effect'));
  await expect(f.execute(p)).rejects.toThrow(); vi.restoreAllMocks();
  const rf1 = f.service.localUsePlan(OWN, f.restriction.requestId, 'work', { version: 1, action: 'apply', purpose: 'optional.personalization', locale: 'en' });
  vi.spyOn(f.options.localUse, 'apply').mockRejectedValueOnce(Error('synthetic_rf1_before_effect'));
  await expect(f.service.localUseAction(OWN, f.restriction.requestId, 'work', { version: 1, eventId: randomUUID(), action: 'apply', planHandle: rf1.planHandle })).rejects.toThrow(); vi.restoreAllMocks();
  const before = f.ledger(), canonical = f.raw(); expect(before.localUse.intents).toHaveLength(1); expect(before.localErasure.operations).toHaveLength(1);
  const full = structuredClone(before);
  while (full.commandReceipts.length < 128) full.commandReceipts.push({ eventId: randomUUID(), fingerprint: 'f'.repeat(64), requestId: f.row.requestId, resultingRequestRevision: f.row.revision, action: 'synthetic', recordedAt: RF1_NOW, retainUntil: RF1_NOW + 86_400_000 });
  expect(Buffer.byteLength(JSON.stringify(full), 'utf8')).toBeLessThan(65_536);
  // Actual count fits 128; the already-admitted operation's future receipt would
  // require 129. This oracle does not call the production reservation helper.
  await expect(f.repository.transaction(accountIdFor(OWN), () => RF1_NOW, d => { d.commandReceipts = full.commandReceipts; d.revision++; }, () => {})).rejects.toThrow();
  same(f.ledger(), before); same(f.raw(), canonical);
});

it('RF2 independent: an RF1 command cannot reuse an admitted RF2 event identity', async () => {
  const f = await fixture(), p = f.plan(); vi.spyOn(f.backend, 'eraseSelectedPrivateNote').mockRejectedValueOnce(Error('synthetic_before_effect'));
  await expect(f.execute(p)).rejects.toThrow(); vi.restoreAllMocks();
  const rf1 = f.service.localUsePlan(OWN, f.restriction.requestId, 'work', { version: 1, action: 'apply', purpose: 'optional.personalization', locale: 'en' });
  const before = f.ledger(), canonical = f.raw(), apply = vi.spyOn(f.options.localUse, 'apply');
  await expect(f.service.localUseAction(OWN, f.restriction.requestId, 'work', { version: 1, eventId: p.eventId, action: 'apply', planHandle: rf1.planHandle })).rejects.toThrow();
  expect(apply).not.toHaveBeenCalled(); expect(f.ledger().localUse.intents).toHaveLength(0); same(f.raw(), canonical);
  same(f.ledger().localErasure.operations, before.localErasure.operations);
});
