import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AdaptiveRepository, accountIdFor, validateAdaptiveDocument, type AdaptiveDocument } from '../repository';
import { AdaptiveService } from '../service';
import { adaptiveOptionsFromManifest } from '../config';
import { MessageMemoryService } from '../../message-memory/service';
import { ReviewedMemoryService } from '../../reviewed-memory/service';
import { SqliteAdaptiveStorage } from './sqlite-storage';
import { ManagedFileV2Storage } from './managed-storage';
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
