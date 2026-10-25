import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createFileStores } from '../memory/file-store';
import { InMemoryMemoryStore, StaleMemoryWriteError, sourceEventIds, type MemoryStore, type NewMemory } from '../memory/store';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tireh-s06-'));
  dirs.push(dir);
  return join(dir, 'state.json');
}

const at = new Date('2026-10-10T10:00:00Z');

function legacy(overrides: Partial<NewMemory> = {}): NewMemory {
  return {
    personaId: 'aria',
    content: 'GameEnd launch is Feb 20',
    type: 'decision',
    scope: { kind: 'project', projectId: 'gameend' },
    authorizedPersonIds: ['milad', 'parastoo', 'reza'],
    sensitivity: 'normal',
    source: { personId: 'parastoo', chatKind: 'group', groupId: 'gameend-team', eventIds: ['evt-1'], at },
    aboutPersonIds: [],
    topic: 'gameend launch',
    confidence: 0.9,
    ...overrides,
  };
}

const V2 = {
  space: 'work' as const,
  status: 'confirmed' as const,
  validFrom: new Date('2026-10-01T00:00:00Z'),
  invalidatedAt: new Date('2026-12-01T00:00:00Z'),
  invalidatedBy: 'next-id',
  importance: 8,
  lastRetrievedAt: new Date('2026-10-12T00:00:00Z'),
  retrievalCount: 3,
  expiresAt: new Date('2027-01-01T00:00:00Z'),
  reviewAfter: new Date('2026-11-01T00:00:00Z'),
  subjectConfirmed: true,
  contentHash: 'abc123',
  embedding: [0.6, 0.8],
  embeddingModel: 'fake-embedding',
  embeddingVersion: 1,
};

const EMBEDDING_KEYS = ['embedding', 'embeddingModel', 'embeddingVersion'];

type Kind = 'memory' | 'file';
function storeOf(kind: Kind, path?: string): MemoryStore & Required<Pick<MemoryStore, 'tombstonesOf' | 'addTombstones'>> {
  const store = kind === 'memory' ? new InMemoryMemoryStore() : createFileStores(path ?? tempPath()).memories;
  return store as MemoryStore & Required<Pick<MemoryStore, 'tombstonesOf' | 'addTombstones'>>;
}

describe.each<Kind>(['memory', 'file'])('%s store: v2 fields', (kind) => {
  it('round-trips every v2 field through add() without bumping safetyRevision', async () => {
    const store = storeOf(kind);
    const before = await store.safetyRevision('aria');
    const added = await store.add(legacy(V2));
    expect(await store.safetyRevision('aria')).toBe(before);
    const loaded = await store.get(added.id);
    expect(loaded).toMatchObject(V2);
    for (const key of ['validFrom', 'invalidatedAt', 'lastRetrievedAt', 'expiresAt', 'reviewAfter'] as const) {
      expect(loaded?.[key]).toBeInstanceOf(Date);
    }
  });

  it('never stores an embedding for personal or confidential records', async () => {
    for (const sensitivity of ['personal', 'confidential'] as const) {
      const store = storeOf(kind);
      const added = await store.add(legacy({ ...V2, sensitivity, scope: { kind: 'private', personId: 'reza' }, authorizedPersonIds: ['reza'] }));
      for (const key of EMBEDDING_KEYS) expect(key in added).toBe(false);
      const loaded = (await store.get(added.id))!;
      for (const key of EMBEDDING_KEYS) expect(key in loaded).toBe(false);
      expect(loaded.importance).toBe(8);

      const plain = await store.add(legacy({ sensitivity, scope: { kind: 'private', personId: 'reza' }, authorizedPersonIds: ['reza'], source: { ...legacy().source, eventIds: [`e-${sensitivity}`] } }));
      await store.update(plain.id, { embedding: [1, 0], embeddingModel: 'm', embeddingVersion: 1 });
      for (const key of EMBEDDING_KEYS) expect(key in (await store.get(plain.id))!).toBe(false);
      expect(await store.updateIfShareVersion(plain.id, 0, { embedding: [1, 0], embeddingModel: 'm', embeddingVersion: 1 })).toBe(true);
      for (const key of EMBEDDING_KEYS) expect(key in (await store.get(plain.id))!).toBe(false);
    }
  });

  it('drops the embedding when an update changes sensitivity from normal to personal', async () => {
    const store = storeOf(kind);
    const added = await store.add(legacy({ embedding: [0.6, 0.8], embeddingModel: 'fake-embedding', embeddingVersion: 1 }));
    expect((await store.get(added.id))!.embedding).toEqual([0.6, 0.8]);
    await store.update(added.id, { sensitivity: 'personal' });
    const loaded = (await store.get(added.id))!;
    expect(loaded.sensitivity).toBe('personal');
    for (const key of EMBEDDING_KEYS) expect(key in loaded).toBe(false);

    const second = await store.add(legacy({ embedding: [0.6, 0.8], embeddingModel: 'fake-embedding', embeddingVersion: 1, source: { ...legacy().source, eventIds: ['evt-2'] } }));
    expect(await store.updateIfShareVersion(second.id, 0, { sensitivity: 'confidential' })).toBe(true);
    for (const key of EMBEDDING_KEYS) expect(key in (await store.get(second.id))!).toBe(false);
  });

  it('stores a record without v2 fields in exactly the base shape', async () => {
    const store = storeOf(kind);
    const input = legacy();
    const added = await store.add(input);
    expect(Object.keys(added).sort()).toEqual([...Object.keys(input), 'id', 'createdAt', 'updatedAt'].sort());
    const loaded = (await store.get(added.id))!;
    expect(loaded).toEqual({ ...input, id: added.id, createdAt: added.createdAt, updatedAt: added.updatedAt });
    expect(Object.keys(loaded).sort()).toEqual(Object.keys(added).sort());
  });

  it('adds tombstones as a sorted, idempotent union without a revision bump or record removal', async () => {
    const store = storeOf(kind);
    const kept = await store.add(legacy());
    const revision = await store.safetyRevision('aria');
    expect(await store.tombstonesOf('aria')).toEqual([]);
    await store.addTombstones('aria', ['evt-z', 'evt-b']);
    await store.addTombstones('aria', ['evt-b', 'evt-a']);
    await store.addTombstones('aria', []);
    expect(await store.tombstonesOf('aria')).toEqual(['evt-a', 'evt-b', 'evt-z']);
    expect(await store.tombstonesOf('other')).toEqual([]);
    expect(await store.safetyRevision('aria')).toBe(revision);
    expect((await store.listActive('aria')).map((m) => m.id)).toEqual([kept.id]);

    for (const bad of [[''], ['x'.repeat(513)], [42 as unknown as string], [null as unknown as string]]) {
      await expect(store.addTombstones('aria', bad)).rejects.toThrow(TypeError);
    }
    expect(await store.tombstonesOf('aria')).toEqual(['evt-a', 'evt-b', 'evt-z']);

    await expect(store.add(legacy({ source: { ...legacy().source, eventIds: ['evt-b'] } }))).rejects.toThrow(StaleMemoryWriteError);
    await expect(store.add(legacy({ source: { ...legacy().source, eventIds: ['fresh'], derivedFromEventIds: ['evt-z'] } }))).rejects.toThrow(StaleMemoryWriteError);
  });

  it('returns a copy from tombstonesOf', async () => {
    const store = storeOf(kind);
    await store.addTombstones('aria', ['a']);
    const list = await store.tombstonesOf('aria');
    list.push('mutated');
    expect(await store.tombstonesOf('aria')).toEqual(['a']);
  });
});

describe('file store persistence of v2 fields and tombstones', () => {
  it('revives the five v2 date keys as Dates after a restart', async () => {
    const path = tempPath();
    const added = await createFileStores(path).memories.add(legacy(V2));
    const loaded = (await createFileStores(path).memories.get(added.id))!;
    expect(loaded).toMatchObject(V2);
    for (const key of ['validFrom', 'invalidatedAt', 'lastRetrievedAt', 'expiresAt', 'reviewAfter'] as const) {
      expect(loaded[key]).toBeInstanceOf(Date);
      expect(loaded[key]!.toISOString()).toBe(V2[key].toISOString());
    }
  });

  it('loads a legacy state file written in the base format unchanged', async () => {
    const path = tempPath();
    const record = { ...legacy(), id: 'legacy-1', createdAt: at, updatedAt: at };
    writeFileSync(path, JSON.stringify({ revisions: { aria: 2 }, tombstones: { aria: ['old'] }, memories: [record], offers: [], chats: {}, epochs: {} }, null, 2));
    const stores = createFileStores(path);
    expect(await stores.memories.get('legacy-1')).toEqual(record);
    expect(await stores.memories.safetyRevision('aria')).toBe(2);
    expect(await (stores.memories as InMemoryMemoryStore).tombstonesOf('aria')).toEqual(['old']);
  });

  it('persists addTombstones across a restart and sees writes from a second instance', async () => {
    const path = tempPath();
    const first = createFileStores(path).memories as InMemoryMemoryStore;
    const second = createFileStores(path).memories as InMemoryMemoryStore;
    await first.addTombstones('aria', ['evt-1']);
    expect(await second.tombstonesOf('aria')).toEqual(['evt-1']);
    await second.addTombstones('aria', ['evt-0']);
    expect(await first.tombstonesOf('aria')).toEqual(['evt-0', 'evt-1']);
    expect(await (createFileStores(path).memories as InMemoryMemoryStore).tombstonesOf('aria')).toEqual(['evt-0', 'evt-1']);
    expect(await createFileStores(path).memories.safetyRevision('aria')).toBe(0);
  });

  it('keeps delete() tombstones visible through tombstonesOf', async () => {
    const path = tempPath();
    const stores = createFileStores(path);
    const added = await stores.memories.add(legacy());
    await stores.memories.delete(added.id);
    expect(await (createFileStores(path).memories as InMemoryMemoryStore).tombstonesOf('aria')).toEqual(sourceEventIds(added).sort());
  });
});
