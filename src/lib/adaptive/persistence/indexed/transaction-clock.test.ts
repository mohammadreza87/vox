import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AdaptiveRepository, accountIdFor, containerIdFor, digest, spaceIdFor, tenantIdFor, validateAdaptiveDocument, type AdaptiveDocument } from '../repository';
import { AdaptiveService } from '../service';
import { adaptiveOptionsFromManifest } from '../config';
import { MessageMemoryService } from '../../message-memory/service';
import { ReviewedMemoryService } from '../../reviewed-memory/service';
import { SqliteAdaptiveStorage } from './sqlite-storage';
import { ManagedFileV2Storage } from './managed-storage';
import { IndexedStorageError } from './contracts';
const NOW = 1_800_000_000_000, ACCOUNT = accountIdFor(123);
const paths: string[] = [], stores: (SqliteAdaptiveStorage | ManagedFileV2Storage)[] = [];
afterEach(() => { for (const storage of stores.splice(0)) storage.close(); for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
function open(format: 'sqlite-v1' | 'file-v2', path: string, now: () => number) {
  const storage = format === 'sqlite-v1' ? new SqliteAdaptiveStorage(path, { now }) : new ManagedFileV2Storage(path, { now });
  stores.push(storage); return storage;
}
async function fixture(format: 'sqlite-v1' | 'file-v2') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'vox-transaction-clock-'))); paths.push(directory);
  const path = join(directory, 'store'); let time = NOW;
  const now = () => time, storage = open(format, path, now), repo = new AdaptiveRepository(storage);
  await repo.transaction(ACCOUNT, now, () => {});
  return { storage, repo, path, now, setNow: (value: number) => { time = value; } };
}
function serializeAt(document: AdaptiveDocument, changeClock: () => void): void {
  // The logical schema remains a complete canonical document. A prototype hook
  // lets the test move time precisely during serialization, outside validation.
  Object.setPrototypeOf(document, Object.create(Object.prototype, { toJSON: {
    value(this: AdaptiveDocument) { changeClock(); return { ...this }; }, enumerable: false,
  } }));
}
describe.each(['sqlite-v1', 'file-v2'] as const)('%s transaction clock coherence', format => {
  it('accepts a valid later callback timestamp and publishes its time before both guards', async () => {
    const f = await fixture(format), guard = vi.fn();
    await f.repo.transaction(ACCOUNT, f.now, d => {
      f.setNow(NOW + 1); d.revision++; d.updatedAt = f.now(); d.declaration = { adultConfirmed: true, declaredAt: f.now() };
    }, guard);
    expect(guard).toHaveBeenCalledTimes(2);
    const current = f.repo.readCommittedForEffect(ACCOUNT, f.now);
    expect(current.status === 'ready' && current.document?.updatedAt).toBe(NOW + 1);
    expect(f.storage.readMetadata().lifecycleWatermark).toBe(NOW + 1);
  });
  it('samples again after serialization and carries that later valid observation', async () => {
    const f = await fixture(format), guard = vi.fn();
    await f.storage.transact(ACCOUNT, raw => {
      const d = validateAdaptiveDocument(raw, ACCOUNT, f.now());
      f.setNow(NOW + 10); d.updatedAt = f.now(); d.revision++;
      serializeAt(d, () => { f.setNow(NOW + 20); });
      return { document: d, result: undefined };
    }, guard);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(f.storage.readMetadata().lifecycleWatermark).toBe(NOW + 20);
    expect(f.repo.readCommittedForEffect(ACCOUNT, f.now)).toMatchObject({ status: 'ready', document: { updatedAt: NOW + 10 } });
  });
  it('keeps future draft timestamps invalid and never imports them into the watermark', async () => {
    const f = await fixture(format), guard = vi.fn();
    await expect(f.repo.transaction(ACCOUNT, f.now, d => { f.setNow(NOW + 1); d.updatedAt = NOW + 1000; d.revision++; }, guard)).rejects.toThrow('Invalid adaptive document');
    expect(guard).not.toHaveBeenCalled();
    expect(f.storage.readMetadata().lifecycleWatermark).toBe(NOW + 1);
    expect(f.repo.readCommittedForEffect(ACCOUNT, f.now)).toMatchObject({ status: 'ready', document: { updatedAt: NOW } });
  });
  it('rejects callback clock regression even above the previous durable floor', async () => {
    const f = await fixture(format), guard = vi.fn(); f.setNow(NOW + 20);
    await expect(f.repo.transaction(ACCOUNT, f.now, d => { d.revision++; f.setNow(NOW + 10); }, guard)).rejects.toMatchObject({ reason: 'clock_regression' });
    expect(guard).not.toHaveBeenCalled(); expect(f.storage.readMetadata().lifecycleWatermark).toBe(NOW + 20);
  });
  it('suppresses a post-publication clock regression without claiming canonical rollback', async () => {
    const f = await fixture(format); let serializations = 0, guards = 0;
    await expect(f.storage.transact(ACCOUNT, raw => {
      const d = validateAdaptiveDocument(raw, ACCOUNT, f.now());
      f.setNow(NOW + 10); d.updatedAt = f.now(); d.revision++;
      serializeAt(d, () => { f.setNow(++serializations === 1 ? NOW + 10 : NOW + 20); });
      return { document: d, result: undefined };
    }, () => { guards++; f.setNow(NOW + 15); })).rejects.toMatchObject({ reason: 'clock_regression', committed: true });
    expect(guards).toBe(1); expect(f.storage.readMetadata().lifecycleWatermark).toBe(NOW + 20);
    f.setNow(NOW + 20);
    expect(f.repo.readCommittedForEffect(ACCOUNT, f.now)).toMatchObject({ status: 'ready', document: { updatedAt: NOW + 10, revision: 2 } });
  });
  it.each([NOW + 5, NaN, -1, Number.MAX_SAFE_INTEGER + 1])('retains the valid post-callback observation when serialization changes clock to %s', async invalid => {
    const f = await fixture(format), guard = vi.fn();
    await expect(f.storage.transact(ACCOUNT, raw => {
      const d = validateAdaptiveDocument(raw, ACCOUNT, f.now());
      f.setNow(NOW + 10); d.updatedAt = f.now(); d.revision++;
      serializeAt(d, () => { f.setNow(invalid); });
      return { document: d, result: undefined };
    }, guard)).rejects.toMatchObject({ reason: 'clock_regression' });
    expect(guard).not.toHaveBeenCalled(); expect(f.storage.readMetadata().lifecycleWatermark).toBe(NOW + 10);
    f.storage.close();
    let denied: unknown;
    try { const reopened = open(format, f.path, () => NOW + 5); reopened.readCommittedForEffect(ACCOUNT); } catch (error) { denied = error; }
    expect(denied).toMatchObject({ reason: 'clock_regression' });
  });
  it('saves real selected-message claims and reviewed summaries while every clock sample advances', async () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'vox-service-clock-'))); paths.push(directory);
    let time = NOW; const now = () => ++time, storage = open(format, join(directory, 'store'), now), repo = new AdaptiveRepository(storage);
    const configurationVersion = 'synthetic-clock';
    const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion,
      enabledCapabilities: ['core_text'], accounts: [{ accountId: ACCOUNT, jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
      approvals: [{ schemaVersion: 1, id: 'synthetic-core', revision: 1, createdAt: NOW, updatedAt: NOW, jurisdiction: 'SYNTHETIC', capability: 'core_text',
        state: 'approved', configurationVersion, effectiveAt: NOW, reviewExpiresAt: NOW + 100_000, owner: 'synthetic', approvalReference: 'synthetic-only' }] }));
    const adaptive = new AdaptiveService(repo, { ...options, now });
    await adaptive.confirm(123, { confirm: true, adultConfirmed: true });
    await repo.transaction(ACCOUNT, now, d => {
      const at = now(); d.updatedAt = at; d.revision++;
      d.agentGrants = [{ agentId: 'agent', space: 'work', allowed: true, revision: 1, updatedAt: at }];
      d.memories = ['source-a', 'source-b'].map(id => ({ id, revision: 1, space: 'work', status: 'active', text: `Synthetic ${id}.`,
        createdAt: at, updatedAt: at, expiresAt: NOW + 90_000, revocationEpoch: 0 }));
    });
    const common = { secret: 'synthetic-advancing-clock-secret-only', now, agentAuthority: async () => 'synthetic-studio', agentAuthorityNow: () => 'synthetic-studio' };
    const message = new MessageMemoryService(adaptive, { ...common, llm: { identity: { provider: 'synthetic', model: 'clock' }, committedExportFence: true,
      complete: async request => { now(); expect(await request.authorize?.()).toBe(true); expect(request.authorizeNow?.()).toBe(true); return '{"claims":["Synthetic reviewed claim."]}'; } } });
    const preview = await message.preview(123, { space: 'work', agentId: 'agent', locale: 'en', text: 'Synthetic selected source.' });
    const messageInput = { space: 'work' as const, agentId: 'agent', claims: preview.claims, sourceTextHash: preview.sourceTextHash, receipt: preview.receipt };
    expect((await message.accept(123, messageInput)).memoryIds).toHaveLength(1); message.revalidateNow(123, messageInput);
    const reviewed = new ReviewedMemoryService(adaptive, { ...common, llm: { committedExportFence: true,
      complete: async request => { now(); expect(await request.authorize?.()).toBe(true); expect(request.authorizeNow?.()).toBe(true); return 'Synthetic reviewed summary.'; } } });
    const summary = await reviewed.preview(123, { space: 'work', agentId: 'agent', locale: 'en', sourceRefs: [{ id: 'source-a', revision: 1 }, { id: 'source-b', revision: 1 }] });
    const summaryInput = { space: 'work' as const, agentId: 'agent', text: summary.text, receipt: summary.receipt };
    expect((await reviewed.accept(123, summaryInput)).memoryId).toBeTruthy(); reviewed.revalidateNow(123, summaryInput);
    const current = repo.readCommittedForEffect(ACCOUNT, now);
    expect(current.status === 'ready' && current.document?.memories.map(m => m.text)).toEqual([
      'Synthetic source-a.', 'Synthetic source-b.', 'Synthetic reviewed claim.', 'Synthetic reviewed summary.',
    ]);
  });
});

async function receiptFixture(format: 'sqlite-v1' | 'file-v2') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'vox-receipt-clock-'))); paths.push(directory);
  const time = { value: NOW, next: undefined as number | undefined };
  const clock = () => { const at = time.next ?? time.value; if (time.next !== undefined) { time.next = undefined; time.value = at - 1; } return at; };
  const path = join(directory, 'store'), storage = open(format, path, clock), repo = new AdaptiveRepository(storage);
  const options = adaptiveOptionsFromManifest(JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-clock', enabledCapabilities: ['core_text'],
    accounts: [{ accountId: ACCOUNT, jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: [{ schemaVersion: 1, id: 'synthetic-core', revision: 1, createdAt: NOW, updatedAt: NOW, jurisdiction: 'SYNTHETIC', capability: 'core_text',
      state: 'approved', configurationVersion: 'synthetic-clock', effectiveAt: NOW, reviewExpiresAt: NOW + 1_000_000, owner: 'synthetic', approvalReference: 'synthetic-only' }] }));
  const adaptive = new AdaptiveService(repo, { ...options, now: clock });
  await adaptive.confirm(123, { confirm: true, adultConfirmed: true });
  await repo.transaction(ACCOUNT, clock, d => {
    d.agentGrants = [{ agentId: 'agent', space: 'work', allowed: true, revision: 1, updatedAt: NOW }];
    d.memories = ['source-a', 'source-b'].map(id => ({ id, revision: 1, space: 'work', status: 'active', text: `Synthetic ${id}.`,
      createdAt: NOW, updatedAt: NOW, expiresAt: NOW + 500_000, revocationEpoch: 0 }));
  });
  const injection = { target: 0, expiry: 0, calls: 0 };
  const authorityNow = () => {
    if (++injection.calls === injection.target) { time.next = injection.expiry; injection.target = 0; }
    return 'synthetic-studio';
  };
  const common = { secret: 'synthetic-clock-replay-secret-only', now: clock, agentAuthority: async () => 'synthetic-studio', agentAuthorityNow: authorityNow };
  const message = new MessageMemoryService(adaptive, { ...common, llm: { committedExportFence: true, complete: async () => '{"claims":["Synthetic clock claim."]}' } });
  const summary = new ReviewedMemoryService(adaptive, { ...common, llm: { committedExportFence: true, complete: async () => 'Synthetic clock summary.' } });
  return { path, storage, repo, adaptive, time, clock, injection, message, summary };
}
for (const format of ['sqlite-v1', 'file-v2'] as const) for (const kind of ['message', 'summary'] as const) {
  it.each(['initial', 'callback', 'guard'] as const)(`${format} ${kind} retains an actual expired %s observation before raw clock regression`, async phase => {
    const f = await receiptFixture(format), scope = { space: 'work' as const, agentId: 'agent', locale: 'en' as const };
    const preview = kind === 'message' ? await f.message.preview(123, { ...scope, text: 'Synthetic selected source.' })
      : await f.summary.preview(123, { ...scope, sourceRefs: [{ id: 'source-a', revision: 1 }, { id: 'source-b', revision: 1 }] });
    const accept = () => 'claims' in preview ? f.message.accept(123, { space: scope.space, agentId: scope.agentId, claims: preview.claims,
      sourceTextHash: preview.sourceTextHash, receipt: preview.receipt }) : f.summary.accept(123, { space: scope.space, agentId: scope.agentId, text: preview.text, receipt: preview.receipt });
    f.injection.calls = 0; f.injection.expiry = preview.expiresAt;
    if (phase === 'initial') f.time.next = preview.expiresAt;
    else f.injection.target = phase === 'callback' ? 2 : 3;
    await expect(accept()).rejects.toThrow();
    expect(f.storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(preview.expiresAt);
    await expect(accept()).rejects.toThrow();
    f.storage.close(); let denied: unknown;
    try { const reopened = open(format, f.path, () => preview.expiresAt - 1); reopened.readCommittedForEffect(ACCOUNT); } catch (error) { denied = error; }
    expect(denied).toMatchObject({ reason: 'clock_regression' });
  });
}

it.each(['sqlite-v1', 'file-v2'] as const)('%s records trusted writer samples without metadata or body I/O', async format => {
  const f = await fixture(format);
  await f.repo.transaction(ACCOUNT, f.now, d => {
    const before = { ...f.storage.io }; f.setNow(NOW + 10);
    expect(f.storage.sampleClock(f.now)).toBe(NOW + 10);
    expect(f.storage.io).toEqual(before);
    d.updatedAt = f.now(); d.revision++;
  });
  expect(f.storage.readMetadata().lifecycleWatermark).toBe(NOW + 10);
  expect(() => f.storage.sampleClock(() => f.storage.sampleClock(f.now))).toThrow(/busy/);
});

for (const format of ['sqlite-v1', 'file-v2'] as const) {
  it(`${format} evaluates final authority after publication and suppresses a deadline crossed by that I/O`, async () => {
    const f = await fixture(format), adaptive = new AdaptiveService(f.repo);
    const moveClock = () => { f.setNow(NOW + 20); };
    let restore: () => void;
    if (f.storage instanceof SqliteAdaptiveStorage) {
      const exec = f.storage.database.exec.bind(f.storage.database);
      const spy = vi.spyOn(f.storage.database, 'exec').mockImplementation(sql => { const result = exec(sql); if (sql === 'COMMIT') moveClock(); return result; }); restore = () => spy.mockRestore();
    } else {
      const publish = f.storage.observeLifecycleTime.bind(f.storage);
      const spy = vi.spyOn(f.storage, 'observeLifecycleTime').mockImplementation(at => { publish(at); moveClock(); }); restore = () => spy.mockRestore();
    }
    let evaluatedAt = 0;
    try { expect(() => adaptive.evaluateAuthorityClock(f.now, now => { evaluatedAt = now; return { value: 'MUST_NOT_ESCAPE', deadline: NOW + 10 }; })).toThrow(); }
    finally { restore(); }
    expect(evaluatedAt).toBe(NOW + 20); expect(f.storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(NOW + 20);
  });
  it.each(['throw', 'denied', 'mixed'] as const)(`${format} retains the exact final %s evaluation time across raw clock regression`, async mode => {
    const f = await fixture(format), adaptive = new AdaptiveService(f.repo); let reads = 0, evaluatedAt = 0;
    const clock = () => { if (++reads === 2) { f.setNow(NOW + 19); return NOW + 20; } return f.now(); };
    expect(() => adaptive.evaluateAuthorityClock(clock, now => {
      evaluatedAt = now;
      if (mode === 'throw') throw Error('synthetic evaluated expiry');
      return { value: false, ...(mode === 'denied' ? { denied: true } : { observedDenial: true, deadline: NOW + 100 }) };
    })).toThrow();
    expect(evaluatedAt).toBe(NOW + 20); expect(f.storage.readMetadata().lifecycleWatermark).toBe(NOW + 20);
    expect(() => f.storage.readCommittedForEffect(ACCOUNT)).toThrow(/clock_regression/);
  });
  it(`${format} rechecks positive deadlines after publishing a mixed negative observation`, async () => {
    const f = await fixture(format), adaptive = new AdaptiveService(f.repo); let publications = 0, restore: () => void;
    const onPublication = () => { if (++publications === 2) f.setNow(NOW + 20); };
    if (f.storage instanceof SqliteAdaptiveStorage) {
      const exec = f.storage.database.exec.bind(f.storage.database);
      const spy = vi.spyOn(f.storage.database, 'exec').mockImplementation(sql => { const result = exec(sql); if (sql === 'COMMIT') onPublication(); return result; }); restore = () => spy.mockRestore();
    } else {
      const publish = f.storage.observeLifecycleTime.bind(f.storage);
      const spy = vi.spyOn(f.storage, 'observeLifecycleTime').mockImplementation(at => { publish(at); onPublication(); }); restore = () => spy.mockRestore();
    }
    try { expect(() => adaptive.evaluateAuthorityClock(f.now, () => ({ value: 'MUST_NOT_ESCAPE', observedDenial: true, deadline: NOW + 10 }))).toThrow(); }
    finally { restore(); }
    expect(f.storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(NOW + 20);
  });
}
it.each(['returned', 'thrown'] as const)('SQLite compact %s expiry denial cannot revive source bodies after evaluator clock regression', async mode => {
  const f = await receiptFixture('sqlite-v1'), storage = f.storage as SqliteAdaptiveStorage, expiry = NOW + 10;
  await f.repo.transaction(ACCOUNT, f.clock, d => { const p = d.permissions.find(row => row.id === 'permission:work:optional.personalization')!; p.state = 'granted'; p.expiresAt = expiry; });
  const scope = { accountId: ACCOUNT, personId: `account-profile:${digest(ACCOUNT).slice(0, 32)}`, tenantId: tenantIdFor(ACCOUNT),
    space: 'work' as const, spaceId: spaceIdFor(ACCOUNT, 'work'), containerId: containerIdFor(ACCOUNT, 'work'), agentId: 'agent', purpose: 'optional.personalization' as const };
  const a = storage.indexed.readRuntimeAuthority(scope); expect(a.status).toBe('ready'); if (a.status !== 'ready') return;
  const q = storage.indexed.queryCandidateIds(scope, 'source', a.receipt); expect(q.status).toBe('ready'); if (q.status !== 'ready') return;
  const before = { canonical: storage.io.canonicalImageReads, bodies: storage.io.bodyRowsRead }, exec = storage.database.exec.bind(storage.database); let commits = 0, observed = 0;
  const spy = vi.spyOn(storage.database, 'exec').mockImplementation(sql => { const result = exec(sql); if (sql === 'COMMIT' && ++commits === 2) f.time.value = expiry; return result; });
  storage.indexed.readControls(ACCOUNT, 'work', (_controls, now) => {
    observed = now; f.time.value = expiry - 1;
    if (mode === 'thrown') throw new IndexedStorageError('expired');
    return { denied: true };
  }); spy.mockRestore();
  expect(observed).toBe(expiry); expect(storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(expiry);
  expect(storage.indexed.loadCandidateBodies(a.receipt, q.handles).status).toBe('unavailable');
  expect(storage.indexed.readRuntimeAuthority(scope).status).toBe('unavailable');
  expect(storage.io.canonicalImageReads).toBe(before.canonical); expect(storage.io.bodyRowsRead).toBe(before.bodies);
});

for (const format of ['sqlite-v1', 'file-v2'] as const) for (const kind of ['message', 'summary'] as const) {
  it(`${format} ${kind} suppresses a preview whose receipt expires during final preparation`, async () => {
    const f = await receiptFixture(format), service = kind === 'message' ? f.message : f.summary;
    const encoder = service as unknown as { encode(value: { expiresAt: number }): string };
    const encode = encoder.encode.bind(service);
    const spy = vi.spyOn(encoder, 'encode').mockImplementation(value => {
      const receipt = encode(value); f.time.next = value.expiresAt; return receipt;
    });
    try {
      const scope = { space: 'work' as const, agentId: 'agent', locale: 'en' as const };
      const preview = kind === 'message' ? f.message.preview(123, { ...scope, text: 'Synthetic selected source.' })
        : f.summary.preview(123, { ...scope, sourceRefs: [{ id: 'source-a', revision: 1 }, { id: 'source-b', revision: 1 }] });
      await expect(preview).rejects.toThrow();
      expect(f.storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(NOW + 120_000);
      expect(() => f.storage.readCommittedForEffect(ACCOUNT)).toThrow(/clock_regression/);
    } finally { spy.mockRestore(); }
  });
}

it('FILEv2 publishes filtered-source expiry observed only by the final private-context evaluation', async () => {
  const f = await receiptFixture('file-v2'), storage = f.storage as ManagedFileV2Storage, expiry = NOW + 500_000;
  const publish = storage.observeLifecycleTime.bind(storage); let first = true;
  const spy = vi.spyOn(storage, 'observeLifecycleTime').mockImplementation(at => {
    publish(at); if (first) { first = false; f.time.value = expiry; }
  });
  try { f.adaptive.readPrivateContextAuthorityNow(123, 'work', 'agent'); }
  finally { spy.mockRestore(); }
  expect(storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(expiry);
  f.time.value = expiry - 1;
  expect(() => f.adaptive.readPrivateContextAuthorityNow(123, 'work', 'agent')).toThrow(/clock_regression/);
});
