import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreMemoryStore } from '../memory/firestore-store';
import type { NewMemory } from '../memory/store';
import type { MemoryRecord } from '../types';
import { FakeVector, fakeFirestore, vectorStore } from './memory-v2-fakes';

const at = new Date('2026-10-10T10:00:00Z');
function newMemory(overrides: Partial<NewMemory> = {}): NewMemory {
  return {
    personaId: 'aria',
    content: 'GameEnd launch is Feb 20',
    type: 'decision',
    scope: { kind: 'project', projectId: 'gameend' },
    authorizedPersonIds: ['milad', 'parastoo', 'reza'],
    sensitivity: 'normal',
    source: { personId: 'parastoo', chatKind: 'group', groupId: 'gameend-team', eventIds: ['evt-1'], at },
    aboutPersonIds: [],
    confidence: 0.9,
    ...overrides,
  };
}

const EMBEDDED = { embedding: [0.6, 0.8], embeddingModel: 'fake-embedding', embeddingVersion: 1 };
const EMBEDDING_KEYS = ['embedding', 'embeddingModel', 'embeddingVersion'];
const DATE_KEYS = ['validFrom', 'invalidatedAt', 'lastRetrievedAt', 'expiresAt', 'reviewAfter'] as const;

/** Frozen copy of the base memoryFromDoc (6d00b80). */
function baseMemoryFromDoc(id: string, data: Record<string, unknown>): MemoryRecord {
  const toDate = (value: unknown): Date => value instanceof Date ? value
    : value && typeof (value as { toDate?: () => Date }).toDate === 'function' ? (value as { toDate: () => Date }).toDate()
    : new Date(value as string);
  const source = data.source as MemoryRecord['source'];
  return { ...(data as unknown as MemoryRecord), id, source: { ...source, at: toDate(source.at) }, createdAt: toDate(data.createdAt), updatedAt: toDate(data.updatedAt) };
}

describe('FirestoreMemoryStore v2 fields', () => {
  it('writes a normal-sensitivity embedding as a vector value and reads it back as number[]', async () => {
    const { db, data } = fakeFirestore();
    const store = vectorStore(db);
    const added = await store.add(newMemory(EMBEDDED));
    expect(added.embedding).toEqual([0.6, 0.8]);
    const raw = data.get(`tireh_memories/${added.id}`)!;
    expect(raw.embedding).toBeInstanceOf(FakeVector);
    expect((raw.embedding as FakeVector).toArray()).toEqual([0.6, 0.8]);
    const loaded = (await store.get(added.id))!;
    expect(loaded.embedding).toEqual([0.6, 0.8]);
    expect(Array.isArray(loaded.embedding)).toBe(true);
    const [listed] = await store.listActive('aria');
    expect(listed.embedding).toEqual([0.6, 0.8]);

    const epochAdded = await store.addIfEpoch(newMemory({ ...EMBEDDED, source: { ...newMemory().source, eventIds: ['evt-2'] } }), 0);
    expect(data.get(`tireh_memories/${epochAdded!.id}`)!.embedding).toBeInstanceOf(FakeVector);
  });

  it('converts Timestamp-like v2 dates to Date', async () => {
    const { db, data } = fakeFirestore();
    const store = vectorStore(db);
    const stamp = (iso: string) => ({ toDate: () => new Date(iso) });
    data.set('tireh_memories/m1', {
      ...newMemory(), createdAt: stamp('2026-10-10T10:00:00Z'), updatedAt: stamp('2026-10-10T10:00:00Z'), active: true, scopeKey: 'project:gameend',
      validFrom: stamp('2026-10-01T00:00:00Z'), invalidatedAt: stamp('2026-10-02T00:00:00Z'), lastRetrievedAt: stamp('2026-10-03T00:00:00Z'),
      expiresAt: stamp('2026-10-04T00:00:00Z'), reviewAfter: stamp('2026-10-05T00:00:00Z'),
    });
    const loaded = (await store.get('m1'))!;
    for (const [i, key] of DATE_KEYS.entries()) {
      expect(loaded[key]).toBeInstanceOf(Date);
      expect(loaded[key]!.toISOString()).toBe(`2026-10-0${i + 1}T00:00:00.000Z`);
    }
  });

  it('maps a legacy doc to exactly the base object with no new keys', async () => {
    const { db, data } = fakeFirestore();
    const store = vectorStore(db);
    const doc = { ...newMemory(), createdAt: at, updatedAt: at, active: true, scopeKey: 'project:gameend' };
    data.set('tireh_memories/legacy', doc);
    const loaded = (await store.get('legacy'))!;
    expect(loaded).toEqual(baseMemoryFromDoc('legacy', doc));
    expect(Object.keys(loaded).sort()).toEqual(Object.keys(baseMemoryFromDoc('legacy', doc)).sort());
    for (const key of [...DATE_KEYS, ...EMBEDDING_KEYS]) expect(key in loaded).toBe(false);
  });

  it('writes a legacy add without any vector call', async () => {
    const { db, data } = fakeFirestore();
    let vectorCalls = 0;
    const store = new FirestoreMemoryStore(db, { vectorValue: (values) => { vectorCalls++; return new FakeVector(values); } });
    const added = await store.add(newMemory());
    expect(vectorCalls).toBe(0);
    expect(Object.keys(data.get(`tireh_memories/${added.id}`)!).sort()).toEqual([...Object.keys(newMemory()), 'createdAt', 'updatedAt', 'active', 'scopeKey'].sort());
  });

  it('strips personal and confidential embeddings on add, update and updateIfShareVersion', async () => {
    for (const sensitivity of ['personal', 'confidential'] as const) {
      const { db, data } = fakeFirestore();
      const store = vectorStore(db);
      const priv = { sensitivity, scope: { kind: 'private' as const, personId: 'reza' }, authorizedPersonIds: ['reza'] };
      const added = await store.add(newMemory({ ...priv, ...EMBEDDED }));
      for (const key of EMBEDDING_KEYS) {
        expect(key in added).toBe(false);
        expect(key in data.get(`tireh_memories/${added.id}`)!).toBe(false);
      }
      const viaEpoch = await store.addIfEpoch(newMemory({ ...priv, ...EMBEDDED, source: { ...newMemory().source, eventIds: ['evt-e'] } }), 0);
      for (const key of EMBEDDING_KEYS) expect(key in data.get(`tireh_memories/${viaEpoch!.id}`)!).toBe(false);

      await store.update(added.id, EMBEDDED);
      for (const key of EMBEDDING_KEYS) expect(key in data.get(`tireh_memories/${added.id}`)!).toBe(false);
      expect(await store.updateIfShareVersion(added.id, 0, EMBEDDED)).toBe(true);
      for (const key of EMBEDDING_KEYS) expect(key in data.get(`tireh_memories/${added.id}`)!).toBe(false);
    }
  });

  it('deletes existing embedding fields when an update makes a record personal', async () => {
    const { db, data } = fakeFirestore();
    const store = vectorStore(db);
    const added = await store.add(newMemory(EMBEDDED));
    expect(data.get(`tireh_memories/${added.id}`)!.embedding).toBeInstanceOf(FakeVector);
    await store.update(added.id, { sensitivity: 'personal', scope: { kind: 'private', personId: 'parastoo' } });
    const raw = data.get(`tireh_memories/${added.id}`)!;
    expect(raw.sensitivity).toBe('personal');
    for (const key of EMBEDDING_KEYS) expect(key in raw).toBe(false);

    const second = await store.add(newMemory({ ...EMBEDDED, source: { ...newMemory().source, eventIds: ['evt-9'] } }));
    expect(await store.updateIfShareVersion(second.id, 0, { sensitivity: 'confidential' })).toBe(true);
    for (const key of EMBEDDING_KEYS) expect(key in data.get(`tireh_memories/${second.id}`)!).toBe(false);
  });

  it('updates a normal embedding as a vector value', async () => {
    const { db, data } = fakeFirestore();
    const store = vectorStore(db);
    const added = await store.add(newMemory());
    await store.update(added.id, EMBEDDED);
    expect(data.get(`tireh_memories/${added.id}`)!.embedding).toBeInstanceOf(FakeVector);
    expect((await store.get(added.id))!.embedding).toEqual([0.6, 0.8]);
  });

  it('keeps an existing vector value intact through updateIfShareVersion', async () => {
    const { db, data } = fakeFirestore();
    const store = vectorStore(db);
    const added = await store.add(newMemory(EMBEDDED));
    const before = data.get(`tireh_memories/${added.id}`)!.embedding as FakeVector;
    expect(await store.updateIfShareVersion(added.id, 0, { scope: { kind: 'people', personIds: ['parastoo', 'reza'] }, authorizedPersonIds: ['parastoo', 'reza'], shareVersion: 1 })).toBe(true);
    const after = data.get(`tireh_memories/${added.id}`)!;
    expect(after.embedding).toBeInstanceOf(FakeVector);
    expect((after.embedding as FakeVector).isEqual(before)).toBe(true);
    expect(after.scopeKey).toBe('people:parastoo,reza');
    expect((await store.get(added.id))!.embedding).toEqual([0.6, 0.8]);
  });
});

describe('FirestoreMemoryStore.findNearest', () => {
  // The store keeps main's defence-in-depth gate: findNearest queries only under TIREH_VECTOR_RETRIEVAL (with TIREH_RETRIEVAL_V2).
  beforeEach(() => { vi.stubEnv('TIREH_RETRIEVAL_V2', '1'); vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '1'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('makes no Firestore call while the vector flag is off', async () => {
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '');
    const { db, nearest } = fakeFirestore();
    const store = vectorStore(db);
    await store.add(newMemory({ ...EMBEDDED, scope: { kind: 'org' } }));
    expect(await store.findNearest('aria', ['org'], [0.6, 0.8], 5)).toEqual([]);
    expect(nearest).toHaveLength(0);
  });

  it('drops a non-normal row even when the index returns it', async () => {
    const fake = fakeFirestore({ ignoreNearestFilters: true });
    const store = vectorStore(fake.db);
    const kept = await store.add(newMemory({ ...EMBEDDED, scope: { kind: 'org' }, source: { ...newMemory().source, eventIds: ['n1'] } }));
    fake.data.set('tireh_memories/forged', { ...fake.data.get(`tireh_memories/${kept.id}`), sensitivity: 'personal' });
    const found = await store.findNearest('aria', ['org'], [0.6, 0.8], 10);
    expect(found.map((m) => m.id)).toEqual([kept.id]);
  });
  async function seeded() {
    const fake = fakeFirestore();
    const store = vectorStore(fake.db);
    const a = await store.add(newMemory({ ...EMBEDDED, scope: { kind: 'org' }, source: { ...newMemory().source, eventIds: ['a'] } }));
    const b = await store.add(newMemory({ ...EMBEDDED, embedding: [0.8, 0.6], source: { ...newMemory().source, eventIds: ['b'] } }));
    const c = await store.add(newMemory({ ...EMBEDDED, scope: { kind: 'group', groupId: 'leads' }, source: { ...newMemory().source, eventIds: ['c'] } }));
    return { ...fake, store, a, b, c };
  }

  it('pre-filters by persona, active and deduplicated scope keys, and queries by cosine', async () => {
    const { store, nearest, a, b } = await seeded();
    const found = await store.findNearest('aria', ['org', 'project:gameend', 'org'], [0.6, 0.8], 5);
    expect(nearest).toHaveLength(1);
    expect(nearest[0].filters).toEqual([['personaId', '==', 'aria'], ['active', '==', true], ['scopeKey', 'in', ['org', 'project:gameend']]]);
    expect(nearest[0].options).toEqual({ vectorField: 'embedding', queryVector: [0.6, 0.8], limit: 5, distanceMeasure: 'COSINE' });
    expect(found.map((m) => m.id)).toEqual([a.id, b.id]);
    expect(found[0].embedding).toEqual([0.6, 0.8]);
  });

  it('returns [] for empty keys or vector without querying, and rejects more than 30 keys', async () => {
    const { store, nearest } = await seeded();
    expect(await store.findNearest('aria', [], [1, 0], 5)).toEqual([]);
    expect(await store.findNearest('aria', ['org'], [], 5)).toEqual([]);
    expect(nearest).toHaveLength(0);
    await expect(store.findNearest('aria', Array.from({ length: 31 }, (_, i) => `group:g${i}`), [1, 0], 5)).rejects.toThrow(RangeError);
    await expect(store.findNearest('aria', Array.from({ length: 31 }, (_, i) => `group:g${i}`), [1, 0], 5)).rejects.toThrow('find_nearest_scope_keys');
    expect(nearest).toHaveLength(0);
  });

  it('clamps the limit to an integer in 1..1000', async () => {
    const { store, nearest } = await seeded();
    await store.findNearest('aria', ['org'], [1, 0], 0);
    await store.findNearest('aria', ['org'], [1, 0], 5000);
    await store.findNearest('aria', ['org'], [1, 0], 7.9);
    await store.findNearest('aria', ['org'], [1, 0], NaN);
    expect(nearest.map((n) => n.options.limit)).toEqual([1, 1000, 7, 1]);
  });

  it('filters superseded rows even when the index returns them', async () => {
    const fake = fakeFirestore({ ignoreNearestFilters: true });
    const store = vectorStore(fake.db);
    const old = await store.add(newMemory({ ...EMBEDDED, scope: { kind: 'org' }, source: { ...newMemory().source, eventIds: ['x'] } }));
    const next = await store.add(newMemory({ ...EMBEDDED, scope: { kind: 'org' }, supersedes: old.id, source: { ...newMemory().source, eventIds: ['y'] } }));
    const found = await store.findNearest('aria', ['org'], [0.6, 0.8], 10);
    expect(found.map((m) => m.id)).toEqual([next.id]);
  });
});

describe('FirestoreMemoryStore tombstones', () => {
  it('reads and unions tombstones in tireh_memory_state without changing revision', async () => {
    const { db, data } = fakeFirestore();
    const store = vectorStore(db);
    data.set('tireh_memory_state/aria', { revision: 4, tombstones: ['m', 'c'] });
    expect(await store.tombstonesOf('aria')).toEqual(['c', 'm']);
    expect(await store.tombstonesOf('nobody')).toEqual([]);
    await store.addTombstones('aria', ['b', 'm']);
    await store.addTombstones('aria', []);
    expect(data.get('tireh_memory_state/aria')).toEqual({ revision: 4, tombstones: ['b', 'c', 'm'] });
    expect(await store.safetyRevision('aria')).toBe(4);
    await store.addTombstones('fresh', ['z']);
    expect(data.get('tireh_memory_state/fresh')).toEqual({ tombstones: ['z'] });
    expect(await store.safetyRevision('fresh')).toBe(0);
    await expect(store.addTombstones('aria', [''])).rejects.toThrow(TypeError);
    await expect(store.addTombstones('aria', ['x'.repeat(513)])).rejects.toThrow(TypeError);
    await expect(store.add(newMemory({ source: { ...newMemory().source, eventIds: ['b'] } }))).rejects.toThrow('Memory context was invalidated');
  });
});
