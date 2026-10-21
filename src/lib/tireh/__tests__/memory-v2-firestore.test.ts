// Default (jsdom) environment: src/test/setup.ts dereferences `window`, so a
// node-environment pragma fails before any test runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreMemoryStore } from '../memory/firestore-store';
import { scopeKey } from '../memory/visibility';
import type { MemoryRecord } from '../types';

type Doc = Record<string, unknown>;
const isVector = (v: unknown): v is { toArray(): number[] } => !!v && typeof v === 'object' && typeof (v as { toArray?: unknown }).toArray === 'function';
const isDelete = (v: unknown) => !!v && typeof v === 'object' && (v as { methodName?: string }).methodName === 'FieldValue.delete';

/** Clone that keeps Dates as Dates and VectorValues (immutable) by reference. */
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (isVector(value) || isDelete(value)) return value;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

function cos(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}

/** Copied from firestore-store.test.ts and extended: 'in' filters, findNearest, vector-preserving clone, write log. */
function fakeFirestore() {
  const data = new Map<string, Doc>();
  const writes: Array<{ op: 'set' | 'update'; path: string; value: Doc }> = [];
  const nearestCalls: Array<{ options: Record<string, unknown>; filters: Array<[string, string, unknown]> }> = [];
  let collectionCalls = 0;
  let auto = 0;

  function assertNoUndefined(value: unknown, path = ''): void {
    if (value === undefined) throw new Error(`undefined value at ${path}`);
    if (value && typeof value === 'object' && !(value instanceof Date) && !isVector(value) && !isDelete(value)) {
      for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
    }
  }

  function docRef(path: string) {
    return {
      id: path.split('/').pop()!,
      path,
      async set(value: Doc) {
        assertNoUndefined(value);
        writes.push({ op: 'set', path, value });
        data.set(path, clone(value));
      },
      async create(value: Doc) {
        if (data.has(path)) throw Object.assign(new Error('exists'), { code: 6 });
        data.set(path, clone(value));
      },
      async update(value: Doc) {
        assertNoUndefined(value);
        if (!data.has(path)) throw new Error('missing');
        writes.push({ op: 'update', path, value });
        const next = { ...data.get(path) };
        for (const [k, v] of Object.entries(value)) {
          if (isDelete(v)) delete next[k]; else next[k] = clone(v);
        }
        data.set(path, next);
      },
      async delete() { data.delete(path); },
      async get() {
        const value = data.get(path);
        return { id: path.split('/').pop()!, exists: value !== undefined, data: () => value };
      },
      collection: (name: string) => collectionRef(`${path}/${name}`),
    };
  }

  function matches(value: Doc, filters: Array<[string, string, unknown]>) {
    return filters.every(([f, op, v]) => op === 'in' ? (v as unknown[]).includes(value[f]) : value[f] === v);
  }

  type Row = { id: string; ref: unknown; data: () => Doc };
  function rows(path: string, filters: Array<[string, string, unknown]>): Row[] {
    return [...data.entries()]
      .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
      .filter(([, value]) => matches(value, filters))
      .map(([key, value]) => ({ id: key.split('/').pop()!, ref: docRef(key), data: () => value }));
  }

  function collectionRef(path: string, filters: Array<[string, string, unknown]> = []) {
    return {
      doc: (id?: string) => docRef(`${path}/${id ?? `auto${++auto}`}`),
      where: (field: string, op: string, value: unknown) => collectionRef(path, [...filters, [field, op, value]]),
      findNearest(options: { vectorField: string; queryVector: number[]; limit: number; distanceMeasure: string }) {
        nearestCalls.push({ options: { ...options }, filters: [...filters] });
        return {
          async get() {
            const docs = rows(path, filters)
              .filter((d) => isVector(d.data()[options.vectorField]))
              .map((d) => ({ d, score: cos((d.data()[options.vectorField] as { toArray(): number[] }).toArray(), options.queryVector) }))
              .sort((a, b) => b.score - a.score)
              .slice(0, options.limit)
              .map(({ d }) => d);
            return { docs };
          },
        };
      },
      async get() { return { docs: rows(path, filters) }; },
    };
  }

  type Ref = ReturnType<typeof docRef>;
  let queue = Promise.resolve();
  const db = {
    collection: (name: string) => { collectionCalls++; return collectionRef(name); },
    async runTransaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      let release!: () => void;
      const previous = queue;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const pending: Array<() => Promise<unknown>> = [];
      try {
        const result = await operation({
          get: (ref: { get(): Promise<unknown> }) => ref.get(),
          set: (ref: Ref, value: Doc) => pending.push(() => ref.set(value)),
          update: (ref: Ref, value: Doc) => pending.push(() => ref.update(value)),
          delete: (ref: Ref) => pending.push(() => ref.delete()),
        });
        for (const write of pending) await write();
        return result;
      } finally { release(); }
    },
  };
  return { db: db as unknown as Firestore, data, writes, nearestCalls, collectionCalls: () => collectionCalls };
}

/** Verbatim base (6d00b80) memoryFromDoc: the legacy-parity oracle. */
function baseToDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') return (value as { toDate: () => Date }).toDate();
  return new Date(value as string);
}
function baseMemoryFromDoc(id: string, data: Doc): MemoryRecord {
  const source = data.source as MemoryRecord['source'];
  return { ...(data as unknown as MemoryRecord), id, source: { ...source, at: baseToDate(source.at) }, createdAt: baseToDate(data.createdAt), updatedAt: baseToDate(data.updatedAt) };
}
/** Verbatim base clean(). */
function baseClean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(baseClean) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, baseClean(v)])) as T;
  }
  return value;
}

const ts = (iso: string) => ({ toDate: () => new Date(iso) });
const VECTOR_CLASS = FieldValue.vector([0]).constructor;
const NOW = new Date('2026-10-20T09:00:00Z');

const base = {
  personaId: 'aria',
  content: 'GameEnd launch is Feb 20',
  type: 'decision' as const,
  scope: { kind: 'project' as const, projectId: 'gameend' },
  sensitivity: 'normal' as const,
  source: { personId: 'parastoo', chatKind: 'group' as const, groupId: 'gameend-team', at: new Date('2026-10-10T00:00:00Z'), eventIds: ['e1'] },
  aboutPersonIds: [],
  confidence: 0.9,
  topic: undefined,
};
const vec = (...xs: number[]) => xs;
const EMB = { embedding: vec(1, 0, 0), embeddingModel: 'text-embedding-3-small', embeddingVersion: 1 };

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('memoryFromDoc', () => {
  it('maps a legacy doc deep-equal to the base shape, adding no keys', async () => {
    const { db, data } = fakeFirestore();
    const doc = { ...base, topic: 'launch', source: { ...base.source, at: ts('2026-10-10T00:00:00Z') }, createdAt: ts('2026-10-11T00:00:00Z'), updatedAt: ts('2026-10-12T00:00:00Z'), active: true, scopeKey: 'project:gameend' };
    delete (doc as Partial<typeof doc>).topic;
    data.set('tireh_memories/legacy', doc);
    const got = await new FirestoreMemoryStore(db).get('legacy');
    expect(got).toEqual(baseMemoryFromDoc('legacy', doc));
    expect(Object.keys(got!).sort()).toEqual(Object.keys(baseMemoryFromDoc('legacy', doc)).sort());
  });

  it('converts Timestamp-like v2 dates to Date and a VectorValue to number[]', async () => {
    const { db, data } = fakeFirestore();
    data.set('tireh_memories/v2', { ...base, createdAt: NOW, updatedAt: NOW, active: true, scopeKey: 'project:gameend',
      validFrom: ts('2026-10-01T00:00:00Z'), invalidatedAt: ts('2026-10-02T00:00:00Z'), lastRetrievedAt: ts('2026-10-03T00:00:00Z'),
      expiresAt: ts('2026-12-01T00:00:00Z'), reviewAfter: ts('2026-11-01T00:00:00Z'), embedding: FieldValue.vector([0.6, 0.8]), embeddingModel: 'm', embeddingVersion: 1, invalidatedBy: null });
    const got = (await new FirestoreMemoryStore(db).get('v2'))!;
    for (const key of ['validFrom', 'invalidatedAt', 'lastRetrievedAt', 'expiresAt', 'reviewAfter'] as const) expect(got[key]).toBeInstanceOf(Date);
    expect(got.validFrom!.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(got.embedding).toEqual([0.6, 0.8]);
    expect(Array.isArray(got.embedding)).toBe(true);
  });
});

describe('writes', () => {
  it('add() and addIfEpoch() store a real VectorValue for normal records', async () => {
    const { db, data } = fakeFirestore();
    const store = new FirestoreMemoryStore(db);
    const a = await store.add({ ...base, ...EMB });
    const b = (await store.addIfEpoch({ ...base, source: { ...base.source, eventIds: ['e2'] }, ...EMB }, 0))!;
    for (const id of [a.id, b.id]) {
      const stored = data.get(`tireh_memories/${id}`)!;
      expect(stored.embedding).toBeInstanceOf(VECTOR_CLASS);
      expect((stored.embedding as { toArray(): number[] }).toArray()).toEqual([1, 0, 0]);
      expect(stored.embeddingModel).toBe('text-embedding-3-small');
      expect((await store.get(id))!.embedding).toEqual([1, 0, 0]);
    }
    expect(a.embedding).toEqual([1, 0, 0]);
  });

  it.each(['personal', 'confidential'] as const)('a %s record stores no embedding keys', async (sensitivity) => {
    const { db, data } = fakeFirestore();
    const store = new FirestoreMemoryStore(db);
    const record = { ...base, scope: { kind: 'private' as const, personId: 'reza' }, sensitivity, ...EMB };
    const a = await store.add(record);
    const b = (await store.addIfEpoch({ ...record, source: { ...record.source, eventIds: ['e2'] } }, 0))!;
    for (const r of [a, b]) {
      const stored = data.get(`tireh_memories/${r.id}`)!;
      for (const key of ['embedding', 'embeddingModel', 'embeddingVersion']) {
        expect(stored).not.toHaveProperty(key);
        expect(r).not.toHaveProperty(key);
      }
    }
  });

  it('updateIfShareVersion on a doc holding a VectorValue keeps a VectorValue', async () => {
    const { db, data } = fakeFirestore();
    const store = new FirestoreMemoryStore(db);
    const a = await store.add({ ...base, ...EMB });
    expect(await store.updateIfShareVersion(a.id, 0, { shareVersion: 1, authorizedPersonIds: ['reza'] })).toBe(true);
    const stored = data.get(`tireh_memories/${a.id}`)!;
    expect(stored.embedding).toBeInstanceOf(VECTOR_CLASS);
    expect((stored.embedding as { toArray(): number[] }).toArray()).toEqual([1, 0, 0]);
  });

  it('updateIfShareVersion to personal drops the embedding keys', async () => {
    const { db, data } = fakeFirestore();
    const store = new FirestoreMemoryStore(db);
    const a = await store.add({ ...base, scope: { kind: 'private', personId: 'reza' }, ...EMB });
    expect(await store.updateIfShareVersion(a.id, 0, { sensitivity: 'personal', shareVersion: 1 })).toBe(true);
    const stored = data.get(`tireh_memories/${a.id}`)!;
    expect(stored).not.toHaveProperty('embedding');
    expect(stored).not.toHaveProperty('embeddingModel');
  });

  it('update() changing sensitivity to personal deletes the embedding keys', async () => {
    const { db, data, writes } = fakeFirestore();
    const store = new FirestoreMemoryStore(db);
    const a = await store.add({ ...base, scope: { kind: 'private', personId: 'reza' }, ...EMB });
    await store.update(a.id, { sensitivity: 'personal' });
    const stored = data.get(`tireh_memories/${a.id}`)!;
    expect(stored.sensitivity).toBe('personal');
    for (const key of ['embedding', 'embeddingModel', 'embeddingVersion']) expect(stored).not.toHaveProperty(key);
    const patch = writes.filter((w) => w.op === 'update' && w.path === `tireh_memories/${a.id}`).at(-1)!.value;
    for (const key of ['embedding', 'embeddingModel', 'embeddingVersion']) expect(isDelete(patch[key])).toBe(true);
  });

  it('update() with a normal patch embedding converts it to a vector; a confidential doc refuses one', async () => {
    const { db, data } = fakeFirestore();
    const store = new FirestoreMemoryStore(db);
    const a = await store.add(base);
    await store.update(a.id, { ...EMB });
    expect(data.get(`tireh_memories/${a.id}`)!.embedding).toBeInstanceOf(VECTOR_CLASS);
    const secret = await store.add({ ...base, source: { ...base.source, eventIds: ['e9'] }, scope: { kind: 'private', personId: 'reza' }, sensitivity: 'confidential' });
    await store.update(secret.id, { ...EMB });
    expect(data.get(`tireh_memories/${secret.id}`)).not.toHaveProperty('embedding');
  });

  it('without embeddings, every write payload equals the base payload', async () => {
    const { db, writes } = fakeFirestore();
    const store = new FirestoreMemoryStore(db);
    const memory = { ...base, validFrom: new Date('2026-10-01T00:00:00Z'), importance: 7 };
    const a = await store.add(memory);
    const expectAdd = baseClean({ ...memory, createdAt: NOW, updatedAt: NOW, active: true, scopeKey: scopeKey(memory.scope) });
    expect(writes.find((w) => w.path === `tireh_memories/${a.id}`)!.value).toEqual(expectAdd);
    expect(a).toEqual({ ...memory, createdAt: NOW, updatedAt: NOW, id: a.id });

    const b = (await store.addIfEpoch({ ...base, source: { ...base.source, eventIds: ['e2'] } }, 0))!;
    expect(writes.find((w) => w.path === `tireh_memories/${b.id}`)!.value)
      .toEqual(baseClean({ ...base, source: { ...base.source, eventIds: ['e2'] }, createdAt: NOW, updatedAt: NOW, active: true, scopeKey: 'project:gameend' }));

    writes.length = 0;
    await store.update(a.id, { scope: { kind: 'org' }, confidence: 0.5 });
    expect(writes.find((w) => w.op === 'update')!.value).toEqual(baseClean({ scope: { kind: 'org' }, confidence: 0.5, updatedAt: NOW, scopeKey: 'org' }));

    writes.length = 0;
    const before = (await db.collection('tireh_memories').doc(b.id).get()).data() as Doc;
    expect(await store.updateIfShareVersion(b.id, 0, { shareVersion: 1 })).toBe(true);
    const merged = { ...before, shareVersion: 1, updatedAt: NOW };
    expect(writes.find((w) => w.path === `tireh_memories/${b.id}`)!.value)
      .toEqual(baseClean({ ...merged, active: true, scopeKey: 'project:gameend' }));
  });
});

describe('findNearest', () => {
  async function seeded() {
    const f = fakeFirestore();
    const store = new FirestoreMemoryStore(f.db);
    const near = await store.add({ ...base, ...EMB });
    const far = await store.add({ ...base, source: { ...base.source, eventIds: ['e2'] }, ...EMB, embedding: [0, 1, 0] });
    const other = await store.add({ ...base, source: { ...base.source, eventIds: ['e3'] }, scope: { kind: 'org' }, ...EMB });
    return { ...f, store, near, far, other };
  }

  it('flag off returns [] without touching Firestore', async () => {
    vi.stubEnv('TIREH_RETRIEVAL_V2', '');
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '');
    const { store, collectionCalls, nearestCalls } = await seeded();
    const calls = collectionCalls();
    expect(await store.findNearest('aria', ['project:gameend'], [1, 0, 0], 5)).toEqual([]);
    expect(collectionCalls()).toBe(calls);
    expect(nearestCalls).toHaveLength(0);
  });

  it('TIREH_VECTOR_RETRIEVAL=1 without TIREH_RETRIEVAL_V2 counts as off', async () => {
    vi.stubEnv('TIREH_RETRIEVAL_V2', '');
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '1');
    const { store, nearestCalls } = await seeded();
    expect(await store.findNearest('aria', ['project:gameend'], [1, 0, 0], 5)).toEqual([]);
    expect(nearestCalls).toHaveLength(0);
  });

  it('flag on: exact filters, vector options and clamped limit', async () => {
    vi.stubEnv('TIREH_RETRIEVAL_V2', '1');
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '1');
    const { store, nearestCalls, near, far } = await seeded();
    const got = await store.findNearest('aria', ['project:gameend', 'project:gameend'], [1, 0, 0], 5000);
    expect(got.map((m) => m.id)).toEqual([near.id, far.id]);
    expect(got[0].embedding).toEqual([1, 0, 0]);
    expect(nearestCalls).toHaveLength(1);
    expect(nearestCalls[0].filters).toEqual([['personaId', '==', 'aria'], ['active', '==', true], ['scopeKey', 'in', ['project:gameend']]]);
    expect(nearestCalls[0].options).toEqual({ vectorField: 'embedding', queryVector: [1, 0, 0], limit: 1000, distanceMeasure: 'COSINE' });
    await store.findNearest('aria', ['org'], [1, 0, 0], 0);
    expect(nearestCalls[1].options.limit).toBe(1);
  });

  it('31 keys throw RangeError; empty keys give []', async () => {
    vi.stubEnv('TIREH_RETRIEVAL_V2', '1');
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '1');
    const { store, nearestCalls } = await seeded();
    const keys = Array.from({ length: 31 }, (_, i) => `group:g${i}`);
    await expect(store.findNearest('aria', keys, [1, 0, 0], 5)).rejects.toBeInstanceOf(RangeError);
    expect(await store.findNearest('aria', [], [1, 0, 0], 5)).toEqual([]);
    expect(await store.findNearest('aria', keys.slice(0, 30), [1, 0, 0], 5)).toEqual([]);
    expect(nearestCalls).toHaveLength(1);
  });

  it('filters out personal and superseded docs even if the index returns them', async () => {
    vi.stubEnv('TIREH_RETRIEVAL_V2', '1');
    vi.stubEnv('TIREH_VECTOR_RETRIEVAL', '1');
    const { store, data, near } = await seeded();
    data.set('tireh_memories/leaky-personal', { ...base, sensitivity: 'personal', createdAt: NOW, updatedAt: NOW, active: true, scopeKey: 'project:gameend', embedding: FieldValue.vector([1, 0, 0]) });
    data.set('tireh_memories/leaky-superseded', { ...base, supersededBy: 'x', createdAt: NOW, updatedAt: NOW, active: true, scopeKey: 'project:gameend', embedding: FieldValue.vector([1, 0, 0]) });
    const got = await store.findNearest('aria', ['project:gameend'], [1, 0, 0], 10);
    expect(got.map((m) => m.id)).toContain(near.id);
    expect(got.map((m) => m.id)).not.toContain('leaky-personal');
    expect(got.map((m) => m.id)).not.toContain('leaky-superseded');
  });
});

describe('tombstones', () => {
  it('tombstonesOf/addTombstones round-trip with the revision unchanged', async () => {
    const { db, data } = fakeFirestore();
    const store = new FirestoreMemoryStore(db);
    expect(await store.tombstonesOf('aria')).toEqual([]);
    await store.addTombstones('aria', ['b', 'a']);
    expect(data.get('tireh_memory_state/aria')).toEqual({ tombstones: ['a', 'b'] });
    await store.invalidate('aria');
    const revision = await store.safetyRevision('aria');
    await store.addTombstones('aria', ['c', 'a', '']);
    expect(await store.tombstonesOf('aria')).toEqual(['a', 'b', 'c']);
    expect(await store.safetyRevision('aria')).toBe(revision);
    await expect(store.add({ ...base, source: { ...base.source, eventIds: ['c'] } })).rejects.toThrow('Memory context was invalidated');
  });
});

describe('firestore.indexes.json', () => {
  it('declares exactly the contract vector index', () => {
    const parsed = JSON.parse(readFileSync(join(process.cwd(), 'firestore.indexes.json'), 'utf8'));
    expect(parsed).toEqual({
      indexes: [{
        collectionGroup: 'tireh_memories',
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'personaId', order: 'ASCENDING' },
          { fieldPath: 'active', order: 'ASCENDING' },
          { fieldPath: 'scopeKey', order: 'ASCENDING' },
          { fieldPath: 'embedding', vectorConfig: { dimension: 1536, flat: {} } },
        ],
      }],
      fieldOverrides: [],
    });
  });
});
