import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import { AdaptiveRepository, accountIdFor, containerIdFor, digest, spaceIdFor, tenantIdFor, type AdaptiveDocument } from '../repository';
import { SqliteAdaptiveStorage } from './sqlite-storage';
import { IndexedStorageError, type CandidateHandle, type IndexedScope, type RuntimeAuthorityReceipt } from './contracts';
import { accountKey } from './projection';
const directories: string[] = [], stores: SqliteAdaptiveStorage[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }); });
async function fixture(count = 3) {
  const directory = mkdtempSync(join(tmpdir(), 'vox-indexed-synthetic-')); directories.push(directory);
  const path = join(directory, 'private.sqlite'); let now = 1000;
  const storage = new SqliteAdaptiveStorage(path, { now: () => now }); stores.push(storage);
  const repo = new AdaptiveRepository(storage), accountId = accountIdFor(123);
  await repo.transaction(accountId, () => now, d => {
    d.binding = { schemaVersion: 1, id: 'synthetic-binding', revision: 1, accountId, personId: d.personId, status: 'verified',
      method: 'account_confirmation', createdAt: now, updatedAt: now, verifiedAt: now, expiresAt: 100_000 };
    for (const p of d.permissions) { p.state = 'granted'; p.expiresAt = 90_000; }
    d.agentGrants.push({ agentId: 'agent', space: 'work', allowed: true, revision: 1, updatedAt: now });
    d.memories = Array.from({ length: count }, (_, i) => ({ id: `note-${String(i).padStart(3, '0')}`, revision: 1,
      space: 'work', text: i === 0 ? 'Old fact: appointment Helsinki 2026, not Tuesday.' : i === 1 ? 'قرار کاری در تهران ۱۴۰۵، سه‌شنبه نیست.' : `Recent unrelated bicycle ${i}`,
      status: 'active', createdAt: now, updatedAt: now + i, expiresAt: 80_000, revocationEpoch: 0 }));
    // Freshness ordering is synthetic but never future-dated relative to query time.
  });
  now = 2000;
  const scope: IndexedScope = { accountId, personId: `account-profile:${digest(accountId).slice(0, 32)}`,
    tenantId: tenantIdFor(accountId), space: 'work', spaceId: spaceIdFor(accountId, 'work'),
    containerId: containerIdFor(accountId, 'work'), agentId: 'agent', purpose: 'optional.personalization' };
  const authority = () => { const a = storage.indexed.readRuntimeAuthority(scope); expect(a.status).toBe('ready'); if (a.status !== 'ready') throw Error(a.reason); return a; };
  const candidates = (query = 'appointment Helsinki') => { const a = authority(), q = storage.indexed.queryCandidateIds(scope, query, a.receipt); expect(q.status).toBe('ready'); if (q.status !== 'ready') throw Error(q.reason); return { ...q, receipt: a.receipt }; };
  return { storage, repo, directory, path, scope, authority, candidates, setNow: (value: number) => { now = value; },
    mutate: (fn: (d: AdaptiveDocument) => void, guard?: () => void) => repo.transaction(accountId, () => now, d => { fn(d); d.revision++; d.updatedAt = now; }, guard) };
}
describe('staged SQLite adaptive storage — synthetic fixtures only', () => {
  it('cold 300-row authority and exact scoped candidate reads do not load the canonical image or bodies', async () => {
    const f = await fixture(300); f.storage.close();
    const cold = new SqliteAdaptiveStorage(f.path, { now: () => 2000 }); stores.push(cold);
    const a = cold.indexed.readRuntimeAuthority(f.scope); expect(a.status).toBe('ready'); if (a.status !== 'ready') return;
    const q = cold.indexed.queryCandidateIds(f.scope, 'Helsinki', a.receipt); expect(q.status).toBe('ready'); if (q.status !== 'ready') return;
    expect(q.handles.map(h => h.id)).toEqual(['note-000']);
    expect(cold.io.canonicalImageReads).toBe(0); expect(cold.io.bodyRowsRead).toBe(0);
    expect(q.io.postingRowsRead).toBe(1); expect(q.io.metadataRowsRead).toBeLessThanOrEqual(2);
    const body = cold.indexed.loadCandidateBodies(a.receipt, q.handles); expect(body.status).toBe('ready');
    expect(body.io.bodyRowsRead).toBe(1); expect(cold.io.canonicalImageReads).toBe(0);
    expect(cold.indexed.queryPlans().every(plan => /SEARCH .*USING (?:COVERING )?INDEX/.test(plan))).toBe(true);
  });
  it('uses EN/FA keyboard/digit normalization and exact private scope without scanning text', async () => {
    const f = await fixture(300), a = f.authority();
    const q = f.storage.indexed.queryCandidateIds(f.scope, 'كاري تهران ١٤٠٥', a.receipt);
    expect(q.status).toBe('ready'); if (q.status !== 'ready') return;
    expect(q.handles[0].id).toBe('note-001');
    const loaded = f.storage.indexed.loadCandidateBodies(a.receipt, q.handles); expect(loaded.status).toBe('ready');
    if (loaded.status === 'ready') expect(loaded.bodies[0].text).toContain('نیست');
    const wrong = f.storage.indexed.readRuntimeAuthority({ ...f.scope, containerId: 'other' });
    expect(wrong).toMatchObject({ status: 'unavailable', reason: 'invalid_scope' }); expect(wrong.io.bodyRowsRead).toBe(0);
    expect(f.storage.indexed.readRuntimeAuthority({ ...f.scope, agentId: 'different' })).toMatchObject({ status: 'unavailable', reason: 'denied' });
  });
  it('reports bounded common/empty queries, deterministic cursors and no substitute bodies', async () => {
    const f = await fixture(300), q = f.candidates('');
    expect(q.handles).toHaveLength(64); expect(q.completion).toBe('partial'); expect(q.cursor).toBeDefined();
    const next = f.storage.indexed.queryCandidateIds(f.scope, '', q.receipt, q.cursor);
    expect(next.status).toBe('ready'); if (next.status === 'ready') {
      expect(next.handles).toHaveLength(64); expect(next.handles.some(h => q.handles.some(p => p.id === h.id))).toBe(false);
    }
    expect(f.storage.indexed.queryCandidateIds(f.scope, 'changed', q.receipt, q.cursor)).toMatchObject({ status: 'unavailable', reason: 'stale_cursor' });
    const forged = { ...q.handles[0], id: 'note-000' };
    const bad = f.storage.indexed.loadCandidateBodies(q.receipt, [forged]); expect(bad).toMatchObject({ status: 'unavailable', reason: 'stale_handle' }); expect(bad.io.bodyRowsRead).toBe(0);
  });
  it('rejects receipts after any unselected source correction, but preserves them across observer-only work', async () => {
    const f = await fixture(), q = f.candidates();
    await f.mutate(d => { d.events.push({ eventId: 'synthetic-event', fingerprint: digest('event'), kind: 'observer', resultId: 'x', revision: 1 }); });
    expect(f.storage.indexed.validateRuntimeReceiptNow(q.receipt).status).toBe('ready');
    await f.mutate(d => { d.memories[2].text = 'Corrected unrelated content'; d.memories[2].revision++; });
    expect(f.storage.indexed.validateRuntimeReceiptNow(q.receipt)).toMatchObject({ status: 'unavailable', reason: 'stale_receipt' });
    const denied = f.storage.indexed.loadCandidateBodies(q.receipt, q.handles); expect(denied.io.bodyRowsRead).toBe(0);
  });
  it('commits canonical correction, invalid descendant body/postings, lineage and outbox atomically', async () => {
    const f = await fixture();
    await f.mutate(d => { d.memories[1].sourceRefs = [{ id: d.memories[0].id, revision: 1 }]; });
    const q = f.candidates('appointment');
    await expect(f.mutate(d => { d.memories[0].text = 'Corrected Tallinn'; d.memories[0].revision++;
      d.memories[1].status = 'deleted'; delete d.memories[1].text; d.memories[1].revision++;
      d.outbox.push({ eventId: 'correction-derived', kind: 'memory_deleted', space: 'work', personId: d.personId, revision: 2,
        memoryId: d.memories[1].id, epoch: 1, createdAt: 2000 }); }, () => { throw Error('synthetic fence'); })).rejects.toThrow('synthetic fence');
    expect(f.storage.indexed.validateRuntimeReceiptNow(q.receipt).status).toBe('ready');
    expect((f.storage.database.prepare('SELECT COUNT(*) AS n FROM outbox').get() as { n: number }).n).toBe(0);
    await f.mutate(d => { d.memories[0].text = 'Corrected Tallinn'; d.memories[0].revision++;
      d.memories[1].status = 'deleted'; delete d.memories[1].text; d.memories[1].revision++;
      d.outbox.push({ eventId: 'correction-derived', kind: 'memory_deleted', space: 'work', personId: d.personId, revision: 2,
        memoryId: d.memories[1].id, epoch: 1, createdAt: 2000 }); });
    expect(f.storage.indexed.validateRuntimeReceiptNow(q.receipt).status).toBe('unavailable');
    expect(f.storage.database.prepare("SELECT id FROM bodies WHERE id='note-001'").all()).toHaveLength(0);
    expect(f.storage.database.prepare("SELECT id FROM postings WHERE id='note-001'").all()).toHaveLength(0);
    expect(f.storage.database.prepare('SELECT event_id FROM outbox').all()).toEqual([{ event_id: 'correction-derived' }]);
    f.storage.close(); const reopened = new SqliteAdaptiveStorage(f.path, { now: () => 2000 }); stores.push(reopened);
    expect((reopened.readCommittedForEffect(f.scope.accountId) as { document: AdaptiveDocument }).document.memories[0].text).toBe('Corrected Tallinn');
  });
  it('checks current metadata lineage, source revisions, expiry, cycles and inherited unverified claim labels before body reads', async () => {
    const f = await fixture(12);
    await f.mutate(d => { d.memories[0].origin = 'user_reviewed_claim';
      for (let i = 1; i < 10; i++) { d.memories[i].sourceRefs = [{ id: d.memories[i - 1].id, revision: 1 }]; d.memories[i].text = `summarykeyword ${i}`; }
      d.memories[10].sourceRefs = [{ id: 'note-011', revision: 1 }]; d.memories[10].text = 'cyclekeyword';
      d.memories[11].sourceRefs = [{ id: 'note-010', revision: 1 }]; d.memories[11].text = 'cyclekeyword'; });
    const q = f.candidates('summarykeyword'); expect(q.handles.some(h => h.id === 'note-009')).toBe(false);
    expect(q.handles).toHaveLength(7); expect(q.handles.every(h => h.claim)).toBe(true);
    const body = f.storage.indexed.loadCandidateBodies(q.receipt, [q.handles[0]]);
    expect(body.status).toBe('ready'); if (body.status === 'ready') expect(body.bodies[0].text).toMatch(/^User-reviewed claim/);
    expect(f.candidates('cyclekeyword').handles).toHaveLength(0);
  });
  it('persists read-only expiry observations and refuses clock regression after restart', async () => {
    const f = await fixture(); f.authority(); f.setNow(100_000);
    const denial = f.storage.indexed.readRuntimeAuthority(f.scope); expect(denial).toMatchObject({ status: 'unavailable', reason: 'expired' });
    expect(denial.io.watermarkWrites).toBe(1); expect(denial.io.bodyRowsRead).toBe(0);
    f.storage.close(); const reopened = new SqliteAdaptiveStorage(f.path, { now: () => 2000 }); stores.push(reopened);
    expect(reopened.indexed.readRuntimeAuthority(f.scope)).toMatchObject({ status: 'unavailable', reason: 'clock_regression' });
    expect(reopened.indexed.readRuntimeAuthority(f.scope).io.bodyRowsRead).toBe(0);
  });
  it('binds every receipt and handle to non-reusable store/connection incarnation and prevents shape forgery', async () => {
    const f = await fixture(), q = f.candidates();
    const otherDirectory = mkdtempSync(join(tmpdir(), 'vox-indexed-other-')); directories.push(otherDirectory);
    const other = new SqliteAdaptiveStorage(join(otherDirectory, 'private.sqlite'), { now: () => 2000 }); stores.push(other);
    expect(other.indexed.validateRuntimeReceiptNow(q.receipt)).toMatchObject({ status: 'unavailable', reason: 'stale_receipt' });
    f.storage.close(); const reopen = new SqliteAdaptiveStorage(f.path, { now: () => 2000 }); stores.push(reopen);
    expect(reopen.indexed.validateRuntimeReceiptNow(q.receipt).status).toBe('unavailable');
    const a = reopen.indexed.readRuntimeAuthority(f.scope); if (a.status !== 'ready') throw Error(a.reason);
    expect(reopen.indexed.loadCandidateBodies(a.receipt, q.handles)).toMatchObject({ status: 'unavailable', reason: 'stale_handle' });
  });
  it('fails effect reads promptly while a real transaction is open and prevents a second process/connection topology', async () => {
    const f = await fixture(); let seen: unknown;
    await f.mutate(() => {}, () => { seen = f.storage.indexed.readRuntimeAuthority(f.scope); });
    expect(seen).toMatchObject({ status: 'unavailable', reason: 'busy' });
    expect(() => new SqliteAdaptiveStorage(f.path)).toThrow(/busy/);
    const raw = new Database(f.path, { timeout: 0 });
    try { expect(() => raw.exec('BEGIN IMMEDIATE')).toThrow(/locked/); } finally { raw.close(); }
  });
  it('suppresses post-COMMIT protected success without claiming that the committed event rolled back', async () => {
    const f = await fixture(); const exec = f.storage.database.exec.bind(f.storage.database);
    let advance = true;
    f.storage.database.exec = ((sql: string) => { const value = exec(sql); if (sql === 'COMMIT' && advance) { advance = false; f.setNow(100_000); } return value; }) as typeof f.storage.database.exec;
    const guard = () => { if (f.storage.clock() >= 90_000) throw Error('expired guard'); };
    await expect(f.mutate(d => { d.events.push({ eventId: 'committed-event', fingerprint: digest('committed'), kind: 'synthetic', resultId: 'x', revision: 1 }); }, guard)).rejects.toMatchObject({ committed: true, reason: 'denied' });
    const row = f.storage.database.prepare('SELECT canonical FROM accounts').get() as { canonical: string };
    expect((JSON.parse(row.canonical) as AdaptiveDocument).events.filter(e => e.eventId === 'committed-event')).toHaveLength(1);
    expect(f.storage.readMetadata().lifecycleWatermark).toBe(100_000);
    f.storage.close(); const reopen = new SqliteAdaptiveStorage(f.path, { now: () => 50_000 }); stores.push(reopen);
    expect(reopen.indexed.readRuntimeAuthority(f.scope)).toMatchObject({ status: 'unavailable', reason: 'clock_regression' });
  });
  it('rechecks expiry after watermark native COMMIT and releases no body on a crossed deadline', async () => {
    const f = await fixture(), a = f.authority(); const exec = f.storage.database.exec.bind(f.storage.database);
    f.setNow(3000);
    f.storage.database.exec = ((sql: string) => { const value = exec(sql); if (sql === 'COMMIT') f.setNow(80_000); return value; }) as typeof f.storage.database.exec;
    expect(f.storage.indexed.validateRuntimeReceiptNow(a.receipt)).toMatchObject({ status: 'unavailable', reason: 'expired' });
    expect(f.storage.io.bodyRowsRead).toBe(0);
    expect(f.storage.readMetadata().lifecycleWatermark).toBe(80_000);
    f.storage.close(); const reopen = new SqliteAdaptiveStorage(f.path, { now: () => 50_000 }); stores.push(reopen);
    expect(reopen.indexed.readRuntimeAuthority(f.scope)).toMatchObject({ status: 'unavailable', reason: 'clock_regression' });
  });
  it('fails malformed controls/body/edge mismatches closed, without aggregate fallback', async () => {
    const f = await fixture(), q = f.candidates();
    f.storage.database.prepare("UPDATE bodies SET text='tampered'").run();
    expect(f.storage.indexed.loadCandidateBodies(q.receipt, q.handles)).toMatchObject({ status: 'unavailable', reason: 'corrupt' });
    const canonicalReads = f.storage.io.canonicalImageReads;
    f.storage.database.prepare("UPDATE controls SET json='{}'").run();
    expect(f.storage.indexed.readRuntimeAuthority(f.scope)).toMatchObject({ status: 'unavailable', reason: 'invalid_controls' });
    expect(f.storage.io.canonicalImageReads).toBe(canonicalReads);
  });
  it('rejects unsupported/malformed metadata and schema on reopen, and enforces account/aggregate capacity', async () => {
    const f = await fixture();
    await expect(f.storage.transact('telegram-account:9007199254740992', () => ({ document: {}, result: 0 }))).rejects.toThrow();
    await expect(f.mutate(d => { d.memories.push(...Array.from({ length: 300 }, (_, i) => ({ ...d.memories[0], id: `over-${i}` }))); })).rejects.toThrow();
    f.storage.close(); const raw = new Database(f.path); raw.pragma('user_version = 99'); raw.close();
    expect(() => new SqliteAdaptiveStorage(f.path)).toThrow(/corrupt/);
  });
  it('enumerates account keys without materializing canonical bodies and avoids unchanged watermark writes', async () => {
    const f = await fixture(); f.authority(); const before = { ...f.storage.io };
    expect(await f.storage.listAccounts({ limit: 1 })).toEqual({ accountIds: [f.scope.accountId] });
    expect(f.storage.io.canonicalImageReads).toBe(before.canonicalImageReads);
    const authority = f.authority(); expect(authority.io.watermarkWrites).toBe(0);
    expect(f.storage.database.pragma('journal_mode', { simple: true })).toBe('delete');
    expect(f.storage.database.pragma('secure_delete', { simple: true })).toBe(1);
    expect(f.storage.database.prepare('SELECT account_key FROM accounts').all()).toEqual([{ account_key: accountKey(f.scope.accountId) }]);
  });
  it('caps whole candidate body bytes and honestly reports partial materialization', async () => {
    const f = await fixture(64);
    await f.mutate(d => { for (const m of d.memories) m.text = 'budgetkeyword ' + 'ژ'.repeat(1900); });
    const q = f.candidates('budgetkeyword'); expect(q.handles).toHaveLength(64);
    const bodies = f.storage.indexed.loadCandidateBodies(q.receipt, q.handles);
    expect(bodies.status).toBe('ready'); if (bodies.status !== 'ready') return;
    expect(bodies.completion).toBe('partial'); expect(bodies.io.bodyBytesRead).toBeLessThanOrEqual(128 * 1024);
    expect(bodies.bodies.length).toBeLessThan(64); expect(bodies.io.bodyRowsRead).toBe(bodies.bodies.length);
  });
  it('rejects a full valid-schema account over 700000 canonical bytes before publication', async () => {
    const f = await fixture(300), receipt = f.authority().receipt;
    await expect(f.mutate(d => { for (const m of d.memories) m.text = 'ژ'.repeat(1900); })).rejects.toMatchObject({ reason: 'capacity' });
    expect(f.storage.indexed.validateRuntimeReceiptNow(receipt).status).toBe('ready');
  });
  it('accepts shared DAG ancestors in different path orders and suppresses expired or version-mismatched sources', async () => {
    const f = await fixture(4);
    await f.mutate(d => {
      d.memories[1].sourceRefs = [{ id: 'note-000', revision: 1 }];
      d.memories[2].sourceRefs = [{ id: 'note-000', revision: 1 }];
      d.memories[3].sourceRefs = [{ id: 'note-002', revision: 1 }, { id: 'note-001', revision: 1 }];
      d.memories[3].text = 'dagkeyword';
    });
    expect(f.candidates('dagkeyword').handles).toHaveLength(1);
    await f.mutate(d => { d.memories[0].revision++; });
    expect(f.candidates('dagkeyword').handles).toHaveLength(0);
    await f.mutate(d => { d.memories[0].revision = 1; d.memories[0].expiresAt = 1900; });
    expect(f.candidates('dagkeyword').handles).toHaveLength(0);
  });
  it('never labels a post-COMMIT regressed-clock mutation as rolled back', async () => {
    const f = await fixture(); const exec = f.storage.database.exec.bind(f.storage.database);
    f.storage.database.exec = ((sql: string) => { const value = exec(sql); if (sql === 'COMMIT') f.setNow(500); return value; }) as typeof f.storage.database.exec;
    await expect(f.mutate(d => { d.events.push({ eventId: 'regression-commit', fingerprint: digest('regression'), kind: 'synthetic', resultId: 'x', revision: 1 }); }))
      .rejects.toMatchObject({ reason: 'clock_regression', committed: true });
    const row = f.storage.database.prepare('SELECT canonical FROM accounts').get() as { canonical: string };
    expect(row.canonical).toContain('regression-commit');
  });

  it('readControls exposes denied identity/consent state as data without minting body authority', async () => {
    const f = await fixture();
    await f.mutate(d => { delete d.binding; d.permissions.find(p => p.id === 'permission:work:optional.personalization')!.state = 'withdrawn'; });
    const controls = f.storage.indexed.readControls(f.scope.accountId, 'work');
    expect(controls.status).toBe('ready'); if (controls.status !== 'ready') return;
    expect(controls.controls.binding).toBeUndefined(); expect(controls.observedAt).toBe(2000);
    expect(controls).not.toHaveProperty('receipt'); expect(controls.io.bodyRowsRead).toBe(0);
    expect(controls.io.canonicalImageReads).toBe(0); expect(controls.controls.revision).toBe(2);
    expect(f.storage.indexed.readRuntimeAuthority(f.scope).status).toBe('unavailable');
  });
  it('durably records an expiry observed by a failed pre-COMMIT guard without committing the mutation', async () => {
    const f = await fixture();
    await expect(f.mutate(d => { d.memories[0].text = 'must not commit'; }, () => { f.setNow(100_000); throw Error('synthetic expiry'); })).rejects.toThrow('synthetic expiry');
    expect(f.storage.readMetadata().lifecycleWatermark).toBe(100_000);
    f.storage.close(); const reopen = new SqliteAdaptiveStorage(f.path, { now: () => 50_000 }); stores.push(reopen);
    expect(reopen.indexed.readControls(f.scope.accountId, 'work')).toMatchObject({ status: 'unavailable', reason: 'clock_regression' });
    expect((reopen.database.prepare('SELECT canonical FROM accounts').get() as { canonical: string }).canonical).not.toContain('must not commit');
  });

  it('evaluates external policy at fresh time after native publication with the same data-only store stamp', async () => {
    const f = await fixture(); const exec = f.storage.database.exec.bind(f.storage.database); let commits = 0, calls = 0;
    f.storage.database.exec = ((sql: string) => { const result = exec(sql); if (sql === 'COMMIT') { commits++; f.setNow(commits === 1 ? 3000 : 4000); } return result; }) as typeof f.storage.database.exec;
    const controls = f.storage.indexed.readControls(f.scope.accountId, 'work', (c, now, stamp) => {
      calls++; expect(now).toBe(4000); expect(c.accountId).toBe(f.scope.accountId);
      expect(stamp.incarnation).toBe(f.storage.readMetadata().incarnation);
      expect(f.storage.indexed.readControls(f.scope.accountId, 'work')).toMatchObject({ status: 'unavailable', reason: 'busy' });
      return { deadline: 5000 };
    });
    expect(controls.status).toBe('ready'); if (controls.status !== 'ready') return;
    expect(controls.observedAt).toBe(4000); expect(calls).toBe(1); expect(commits).toBe(2);
    expect(controls.io.canonicalImageReads).toBe(0); expect(controls.io.bodyRowsRead).toBe(0);
    expect(controls.io.watermarkWrites).toBe(1);
  });
  it('durably publishes external-policy denial observed after COMMIT while returning data-only denied controls', async () => {
    const f = await fixture(); const exec = f.storage.database.exec.bind(f.storage.database); let commits = 0;
    f.storage.database.exec = ((sql: string) => { const result = exec(sql); if (sql === 'COMMIT') { commits++; f.setNow(commits === 1 ? 3000 : 4000); } return result; }) as typeof f.storage.database.exec;
    const controls = f.storage.indexed.readControls(f.scope.accountId, 'work', (_c, now) => ({ denied: now >= 3500, deadline: 3500 }));
    expect(controls.status).toBe('ready'); expect(f.storage.readMetadata().lifecycleWatermark).toBe(4000);
    expect(controls).not.toHaveProperty('receipt');
    f.storage.close(); const reopen = new SqliteAdaptiveStorage(f.path, { now: () => 3500 }); stores.push(reopen);
    expect(reopen.indexed.readControls(f.scope.accountId, 'work')).toMatchObject({ status: 'unavailable', reason: 'clock_regression' });
  });
  it('suppresses expired external-policy controls and durably fences the later observation', async () => {
    const f = await fixture(); const exec = f.storage.database.exec.bind(f.storage.database); let commits = 0;
    f.storage.database.exec = ((sql: string) => { const result = exec(sql); if (sql === 'COMMIT') { commits++; f.setNow(commits === 1 ? 3000 : 4000); } return result; }) as typeof f.storage.database.exec;
    const controls = f.storage.indexed.readControls(f.scope.accountId, 'work', () => { throw new IndexedStorageError('expired'); });
    expect(controls).toMatchObject({ status: 'unavailable', reason: 'expired' });
    expect(f.storage.readMetadata().lifecycleWatermark).toBe(4000);
    f.storage.close(); const reopen = new SqliteAdaptiveStorage(f.path, { now: () => 3500 }); stores.push(reopen);
    expect(reopen.indexed.readControls(f.scope.accountId, 'work').status).toBe('unavailable');
  });
  it('rejects malformed/asynchronous evaluator results and fails unavailable if denial publication cannot commit', async () => {
    const f = await fixture();
    expect(f.storage.indexed.readControls(f.scope.accountId, 'work', () => ({ deadline: Infinity }))).toMatchObject({ status: 'unavailable', reason: 'invalid_controls' });
    expect(f.storage.indexed.readControls(f.scope.accountId, 'work', (() => Promise.resolve({})) as never)).toMatchObject({ status: 'unavailable', reason: 'invalid_controls' });
    const prepare = f.storage.database.prepare.bind(f.storage.database); let failPublication = false;
    f.storage.database.prepare = ((sql: string) => { if (failPublication && sql.startsWith('UPDATE store_meta')) throw Object.assign(Error('synthetic full'), { code: 'SQLITE_FULL' }); return prepare(sql); }) as typeof f.storage.database.prepare;
    const controls = f.storage.indexed.readControls(f.scope.accountId, 'work', () => { f.setNow(3000); failPublication = true; throw new IndexedStorageError('expired'); });
    // The later observed clock is sampled by the evaluator before this throw;
    // no expired data or positive result may escape a failed durability write.
    expect(controls).toMatchObject({ status: 'unavailable', reason: 'corrupt' }); expect(controls.io.bodyRowsRead).toBe(0);
  });

  it('rechecks the declared external deadline after evaluator work and persists expiry observed inside it', async () => {
    const f = await fixture();
    const controls = f.storage.indexed.readControls(f.scope.accountId, 'work', (_c, at) => {
      expect(at).toBe(2000); f.setNow(3000); return { deadline: 2500 };
    });
    expect(controls).toMatchObject({ status: 'unavailable', reason: 'expired' });
    expect(f.storage.readMetadata().lifecycleWatermark).toBe(3000);
    f.storage.close(); const reopen = new SqliteAdaptiveStorage(f.path, { now: () => 2500 }); stores.push(reopen);
    expect(reopen.indexed.readControls(f.scope.accountId, 'work')).toMatchObject({ status: 'unavailable', reason: 'clock_regression' });
  });

  it('gives evaluators deeply immutable canonical facts and stamps, including retained references after return', async () => {
    const f = await fixture(); let capturedControls: unknown, capturedStamp: unknown;
    const controls = f.storage.indexed.readControls(f.scope.accountId, 'work', (c, _now, stamp) => {
      capturedControls = c; capturedStamp = stamp;
      expect(Object.isFrozen(c)).toBe(true); expect(Object.isFrozen(c.permissions)).toBe(true);
      expect(Object.isFrozen(c.permissions[0])).toBe(true); expect(Object.isFrozen(c.settings.work)).toBe(true);
      expect(Object.isFrozen(stamp)).toBe(true);
      expect(() => { c.permissions[0].state = 'withdrawn'; }).toThrow();
      expect(() => { (stamp as { incarnation: string }).incarnation = 'forged'; }).toThrow();
      return {};
    });
    expect(controls.status).toBe('ready'); if (controls.status !== 'ready') return;
    expect(capturedControls).toBe(controls.controls); expect(capturedStamp).toBe(controls.stamp);
    expect(() => { controls.controls.permissions[0].state = 'withdrawn'; }).toThrow();
    expect(() => { controls.stamp.catalogVersion = 999; }).toThrow();
    expect(f.storage.indexed.readRuntimeAuthority(f.scope).status).toBe('ready');
    const denied = f.storage.indexed.readControls(f.scope.accountId, 'work', c => { c.agentGrants.splice(0); return {}; });
    expect(denied.status).toBe('unavailable'); expect(denied.io.bodyRowsRead).toBe(0);
  });

  it('observes rejected asynchronous evaluators while failing closed without an unhandled Node rejection', async () => {
    const f = await fixture();
    const result = f.storage.indexed.readControls(f.scope.accountId, 'work', (() => Promise.reject(Error('synthetic rejected async evaluator'))) as never);
    expect(result).toMatchObject({ status: 'unavailable', reason: 'invalid_controls' });
    await new Promise(resolve => setImmediate(resolve));
    expect(f.storage.indexed.readControls(f.scope.accountId, 'work').status).toBe('ready');
  });

  it('rejects arbitrary thenables without executing them and keeps rejected async callbacks safe in a real Node child', async () => {
    const f = await fixture(); let executed = false;
    expect(f.storage.indexed.readControls(f.scope.accountId, 'work', (() => ({ then: () => { executed = true; } })) as never))
      .toMatchObject({ status: 'unavailable', reason: 'invalid_controls' });
    await new Promise(resolve => setImmediate(resolve)); expect(executed).toBe(false);
    f.storage.close();
    const moduleUrl = pathToFileURL(join(process.cwd(), 'src/lib/adaptive/persistence/indexed/sqlite-storage.ts')).href;
    const script = `import { SqliteAdaptiveStorage } from ${JSON.stringify(moduleUrl)};
      const s = new SqliteAdaptiveStorage(${JSON.stringify(f.path)}, { now: () => 2000 });
      const r = s.indexed.readControls(${JSON.stringify(f.scope.accountId)}, 'work', () => Promise.reject(Error('synthetic child rejection')));
      if (r.status !== 'unavailable' || r.reason !== 'invalid_controls') process.exitCode = 2;
      setImmediate(() => { s.close(); console.log('synthetic-child-safe'); });`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
    expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain('synthetic-child-safe');
  });

  it('exposes an immutable store namespace without SQL even inside a canonical writer callback', async () => {
    const f = await fixture(); const expected = { incarnation: f.storage.readMetadata().incarnation, generation: 1 };
    expect(f.storage.indexed.identity).toEqual(expected); expect(Object.isFrozen(f.storage.indexed.identity)).toBe(true);
    const prepare = f.storage.database.prepare; let sql = 0;
    f.storage.database.prepare = function (...args: Parameters<typeof prepare>) { sql++; return prepare.apply(this, args); } as typeof prepare;
    try { expect(f.storage.indexed.identity).toEqual(expected); expect(sql).toBe(0); }
    finally { f.storage.database.prepare = prepare; }
    await f.mutate(() => { expect(f.storage.indexed.identity).toEqual(expected); });
    expect(() => { (f.storage.indexed.identity as { generation: number }).generation = 999; }).toThrow();
    expect(f.storage.indexed.identity).not.toHaveProperty('catalogVersion');
    expect(f.storage.indexed.identity).not.toHaveProperty('lifecycleWatermark');
  });

});
