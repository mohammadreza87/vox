import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { AdaptiveService } from '../persistence/service';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { FileAdaptiveStorage } from '../persistence/storage';
import { SqliteAdaptiveStorage } from '../persistence/indexed/sqlite-storage';
import { ManagedFileV2Storage } from '../persistence/indexed/managed-storage';
import { SharedMemoryRepository } from './repository';
import { SharedMemoryService, type SharedAuthority } from './service';
const START = 1_800_000_000_000;
const roots: string[] = [];
const stores: Array<{ close(): void }> = [];
afterEach(async () => { for (const store of stores.splice(0)) store.close(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(kind: 'sqlite' | 'file-v2') {
  const root = await mkdtemp(join(tmpdir(), 'vox-shared-clock-')); roots.push(root);
  let time = START, high: number | undefined, delay = 0, armOnSnapshot = false;
  const clock = () => time;
  const sharedClock = () => { if (high !== undefined && delay-- <= 0) { const value = high; high = undefined; time = value - 1; return value; } return time; };
  const path = join(root, kind === 'sqlite' ? 'private.sqlite' : 'private');
  const open = () => kind === 'sqlite' ? new SqliteAdaptiveStorage(path, { now: clock }) : new ManagedFileV2Storage(path, { now: clock });
  const storage = open(); stores.push(storage);
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'shared-clock', enabledCapabilities: ['core_text', 'personalization'],
    accounts: [101, 102].map(id => ({ accountId: accountIdFor(id), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true })),
    approvals: ['core_text', 'personalization'].map((capability, i) => ({ schemaVersion: 1, id: `approval-${i}`, revision: 1, createdAt: START, updatedAt: START,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'shared-clock', effectiveAt: START,
      reviewExpiresAt: START + 400 * 86400_000, owner: 'synthetic', approvalReference: 'synthetic-only' })) });
  const options = { ...adaptiveOptionsFromManifest(manifest), now: clock };
  const adaptive = new AdaptiveService(new AdaptiveRepository(storage), options);
  for (const id of [101, 102]) {
    await adaptive.confirm(id, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
    const initial = await adaptive.read(id, 'work'), purpose = 'optional.personalization' as const;
    const presented = await adaptive.present(id, { space: 'work', purpose, locale: 'en', expectedRevision: initial.purposes.find(p => p.purpose === purpose)!.revision, eventId: `present-${id}` });
    await adaptive.changeConsent(id, { space: 'work', purpose, state: 'granted', receipt: presented.receipt,
      expectedRevision: presented.purposes.find(p => p.purpose === purpose)!.revision, eventId: `grant-${id}` });
  }
  const authority: SharedAuthority = {
    member: async () => ({ active: true, agentIds: ['aria'] }), agent: async () => ({ active: true }), group: async () => null,
    memberNow: () => ({ active: true, agentIds: ['aria'] }), agentNow: () => ({ active: true }), groupNow: () => null,
    readSnapshotNow: ({ telegramIds }) => {
      if (armOnSnapshot) { armOnSnapshot = false; high = time + 1; delay = 0; }
      return { members: telegramIds.map(telegramId => ({ telegramId, active: true, agentIds: ['aria'] })), agent: { active: true }, groups: [] };
    },
  };
  const repository = new SharedMemoryRepository(new FileAdaptiveStorage(join(root, 'shared')), 'clock-test');
  const service = new SharedMemoryService(repository, adaptive, authority, sharedClock);
  const preview = await service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
  await service.create(101, { space: 'work', eventId: 'create', expectedRevision: 0, previewToken: preview.previewToken, agentIds: ['aria'], text: 'SHARED_CLOCK_CANARY' });
  const audience = { audienceTelegramIds: [101] };
  return { storage, adaptive, service, repository, audience, setTime: (at: number) => { time = at; }, arm: () => { armOnSnapshot = true; }, armEvaluation: (expiry: number) => { time = expiry - 1; high = expiry; delay = 1; },
    reopen: () => { storage.close(); stores.splice(stores.indexOf(storage), 1); const reopened = open(); stores.push(reopened); return new AdaptiveService(new AdaptiveRepository(reopened), options); } };
}
for (const kind of ['sqlite', 'file-v2'] as const) {
  it.each(['binding', 'retention'] as const)(`${kind} retains final shared %s expiry when the next raw clock regresses`, async type => {
    const f = await fixture(kind);
    const positive = await f.service.readContext(101, 'work', 'aria', f.audience);
    expect(positive.memories.map(m => m.text)).toEqual(['SHARED_CLOCK_CANARY']);
    expect(f.service.readContextAuthorityNow(101, 'work', 'aria', f.audience).revision).toBe(positive.revision);
    const expiry = type === 'binding' ? START + 12 * 3600_000 : START + 10_000;
    if (type === 'retention') await f.repository.transaction(d => { d.containers[0].memories[0].expiresAt = expiry; });
    f.setTime(expiry - 1); f.arm();
    expect(() => f.service.readContextAuthorityNow(101, 'work', 'aria', f.audience)).toThrow();
    expect(f.storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(expiry);
    expect(() => f.service.readContextAuthorityNow(101, 'work', 'aria', f.audience)).toThrow();
    const reopened = f.reopen();
    await expect(reopened.readAuthority(101, 'work')).rejects.toThrow();
  });
  it(`${kind} retains a pruning expiry even when the shared transaction fails`, async () => {
    const f = await fixture(kind), expiry = START + 10_000;
    await f.repository.transaction(d => { d.containers[0].memories[0].expiresAt = expiry; });
    await expect(f.repository.transaction(d => {
      f.armEvaluation(expiry);
      f.service.pruneDocument(d);
      throw new Error('synthetic downstream failure');
    })).rejects.toThrow();
    expect(f.storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(expiry);
    const source = await f.repository.transaction(d => d.containers[0].memories[0]);
    expect(source.status).toBe('active'); // Failed shared write did not persist a tombstone.
    expect(source.text).toBe('SHARED_CLOCK_CANARY');
    await expect(f.adaptive.readAuthority(101, 'work')).rejects.toThrow();
  });
  it(`${kind} retains preview expiry observed before staging`, async () => {
    const f = await fixture(kind);
    const preview = await f.service.preview(101, { space: 'work', kind: 'selected', recipientTelegramIds: [102] });
    f.setTime(preview.expiresAt - 1);
    const read = f.repository.transaction.bind(f.repository);
    let calls = 0;
    // Arm the raw clock only after the actual preview lookup has finished.
    f.repository.transaction = async fn => { const value = await read(fn); if (++calls === 2) f.setTime(preview.expiresAt); return value; };
    await expect(f.service.create(101, { space: 'work', eventId: 'expired-preview', expectedRevision: 0, previewToken: preview.previewToken, agentIds: [], text: 'MUST_NOT_STAGE' })).rejects.toThrow();
    expect(f.storage.readMetadata().lifecycleWatermark).toBeGreaterThanOrEqual(preview.expiresAt);
    f.setTime(preview.expiresAt - 1);
    await expect(f.service.create(101, { space: 'work', eventId: 'expired-preview', expectedRevision: 0, previewToken: preview.previewToken, agentIds: [], text: 'MUST_NOT_STAGE' })).rejects.toThrow();
    const state = await read(d => d);
    expect(state.containers.flatMap(c => c.memories).some(m => m.text === 'MUST_NOT_STAGE')).toBe(false);
  });
}
