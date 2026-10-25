// Main-lineage (9a6751e) memory-v2-stores cases that pass against the chosen wave A stores.
// Cases that could not be kept are listed in the S06 merge report.
// Default (jsdom) environment: src/test/setup.ts dereferences `window`, so a
// node-environment pragma fails before any test runs. Paths use os.tmpdir().
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createFileStores } from '../memory/file-store';
import { InMemoryMemoryStore, StaleMemoryWriteError, type MemoryStore, type NewMemory } from '../memory/store';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vox-s06-'));
  dirs.push(dir);
  return join(dir, 'state.json');
}

type Harness = { store: MemoryStore & Required<Pick<MemoryStore, 'tombstonesOf' | 'addTombstones'>>; reopen: () => MemoryStore & Required<Pick<MemoryStore, 'tombstonesOf' | 'addTombstones'>> };

const harnesses: Array<[string, () => Harness]> = [
  ['InMemoryMemoryStore', () => { const store = new InMemoryMemoryStore(); return { store, reopen: () => store }; }],
  ['file store', () => {
    const path = tempPath();
    const store = createFileStores(path).memories;
    return { store, reopen: () => createFileStores(path).memories };
  }],
];

const legacy: NewMemory = {
  personaId: 'aria',
  content: 'GameEnd launch is Feb 20',
  type: 'decision',
  scope: { kind: 'project', projectId: 'gameend' },
  sensitivity: 'normal',
  source: { personId: 'parastoo', chatKind: 'group', groupId: 'gameend-team', at: new Date('2026-10-10T10:00:00Z'), eventIds: ['e-legacy'] },
  aboutPersonIds: [],
  confidence: 0.9,
};

const V2_DATES = {
  validFrom: new Date('2026-10-01T00:00:00Z'),
  invalidatedAt: new Date('2026-10-02T00:00:00Z'),
  lastRetrievedAt: new Date('2026-10-03T00:00:00Z'),
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  reviewAfter: new Date('2026-11-01T00:00:00Z'),
};

const EMBEDDING = { embedding: [0.6, 0.8, 0], embeddingModel: 'text-embedding-3-small', embeddingVersion: 1 };

describe.each(harnesses)('%s v2 support', (_name, make) => {
  it('legacy records round-trip deep-equal with no new keys', async () => {
    const { store, reopen } = make();
    const added = await store.add(legacy);
    expect(Object.keys(added).sort()).toEqual([...Object.keys(legacy), 'id', 'createdAt', 'updatedAt'].sort());
    const loaded = await reopen().get(added.id);
    expect(loaded).toEqual(added);
    expect(Object.keys(loaded!).sort()).toEqual(Object.keys(added).sort());
  });

  it('revives all five v2 date fields as Date after a reload', async () => {
    const { store, reopen } = make();
    const added = await store.add({ ...legacy, ...V2_DATES, importance: 8, status: 'confirmed', space: 'work', retrievalCount: 2, subjectConfirmed: true, contentHash: 'abc' });
    const loaded = (await reopen().get(added.id))!;
    for (const key of Object.keys(V2_DATES) as Array<keyof typeof V2_DATES>) {
      expect(loaded[key]).toBeInstanceOf(Date);
      expect(loaded[key]!.getTime()).toBe(V2_DATES[key].getTime());
    }
    expect(loaded).toMatchObject({ importance: 8, status: 'confirmed', space: 'work', retrievalCount: 2, subjectConfirmed: true, contentHash: 'abc' });
  });

  it('keeps embedding, model and version for normal records', async () => {
    const { store, reopen } = make();
    const added = await store.add({ ...legacy, ...EMBEDDING });
    expect(await reopen().get(added.id)).toMatchObject(EMBEDDING);
  });

  it.each(['personal', 'confidential'] as const)('strips embedding keys on add when sensitivity is %s', async (sensitivity) => {
    const { store, reopen } = make();
    const added = await store.add({ ...legacy, scope: { kind: 'private', personId: 'reza' }, sensitivity, ...EMBEDDING });
    const loaded = (await reopen().get(added.id))!;
    for (const key of ['embedding', 'embeddingModel', 'embeddingVersion']) {
      expect(added).not.toHaveProperty(key);
      expect(loaded).not.toHaveProperty(key);
    }
  });

  it('update() that changes sensitivity to personal strips the embedding', async () => {
    const { store, reopen } = make();
    const added = await store.add({ ...legacy, scope: { kind: 'private', personId: 'reza' }, ...EMBEDDING });
    await store.update(added.id, { sensitivity: 'personal' });
    const loaded = (await reopen().get(added.id))!;
    expect(loaded.sensitivity).toBe('personal');
    expect(loaded).not.toHaveProperty('embedding');
    expect(loaded).not.toHaveProperty('embeddingModel');
    expect(loaded).not.toHaveProperty('embeddingVersion');
  });

  it('update() adding an embedding to a confidential record is stripped; a normal update keeps it', async () => {
    const { store, reopen } = make();
    const secret = await store.add({ ...legacy, scope: { kind: 'private', personId: 'reza' }, sensitivity: 'confidential' });
    await store.update(secret.id, { ...EMBEDDING });
    expect(await reopen().get(secret.id)).not.toHaveProperty('embedding');
    const normal = await store.add({ ...legacy, source: { ...legacy.source, eventIds: ['e-normal'] } });
    await store.update(normal.id, { ...EMBEDDING });
    expect(await reopen().get(normal.id)).toMatchObject(EMBEDDING);
  });

  it('updateIfShareVersion strips embeddings when the result is not normal', async () => {
    const { store, reopen } = make();
    const added = await store.add({ ...legacy, scope: { kind: 'private', personId: 'reza' }, ...EMBEDDING });
    expect(await store.updateIfShareVersion(added.id, 0, { sensitivity: 'personal', shareVersion: 1 })).toBe(true);
    expect(await reopen().get(added.id)).not.toHaveProperty('embedding');
    const kept = await store.add({ ...legacy, source: { ...legacy.source, eventIds: ['e-kept'] }, ...EMBEDDING });
    expect(await store.updateIfShareVersion(kept.id, 0, { shareVersion: 1 })).toBe(true);
    expect(await reopen().get(kept.id)).toMatchObject(EMBEDDING);
  });

  it('add() with v2 fields does not change safetyRevision', async () => {
    const { store } = make();
    const before = await store.safetyRevision('aria');
    await store.add({ ...legacy, ...V2_DATES, ...EMBEDDING, importance: 9 });
    expect(await store.safetyRevision('aria')).toBe(before);
  });

  it('a tombstoned lineage makes add() throw StaleMemoryWriteError', async () => {
    const { store } = make();
    await store.addTombstones('aria', ['e-legacy']);
    await expect(store.add(legacy)).rejects.toBeInstanceOf(StaleMemoryWriteError);
    await expect(store.add({ ...legacy, source: { ...legacy.source, eventIds: ['fresh'], derivedFromEventIds: ['e-legacy'] } })).rejects.toBeInstanceOf(StaleMemoryWriteError);
    await expect(store.add({ ...legacy, source: { ...legacy.source, eventIds: ['fresh'] } })).resolves.toBeTruthy();
  });

  it('delete() still tombstones and the accessor reports it', async () => {
    const { store } = make();
    const added = await store.add(legacy);
    await store.delete(added.id);
    expect(await store.tombstonesOf('aria')).toEqual(['e-legacy']);
  });
});

describe('file store tombstone persistence', () => {
  it('persists tombstones across createFileStores re-open', async () => {
    const path = tempPath();
    await createFileStores(path).memories.addTombstones('aria', ['z', 'y']);
    const reopened = createFileStores(path).memories;
    expect(await reopened.tombstonesOf('aria')).toEqual(['y', 'z']);
    await expect(reopened.add({ ...legacy, source: { ...legacy.source, eventIds: ['y'] } })).rejects.toBeInstanceOf(StaleMemoryWriteError);
  });
});

describe('InMemoryMemoryStore', () => {
  it('has no findNearest (in-process scoring only)', () => {
    expect((new InMemoryMemoryStore() as MemoryStore).findNearest).toBeUndefined();
    expect((createFileStores(tempPath()).memories as MemoryStore).findNearest).toBeUndefined();
  });

  it('returns the same record identity for legacy writes (no strip copy)', async () => {
    const store = new InMemoryMemoryStore();
    const added = await store.add(legacy);
    expect(store.records.get(added.id)).toBe(added);
  });
});
