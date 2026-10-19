import { describe, it, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  FirestoreChatHistoryStore,
  FirestoreMemoryStore,
  FirestoreShareOfferStore,
  FirestoreUpdateDeduper,
} from '../memory/firestore-store';

/** Tiny in-memory stand-in for the parts of the Admin SDK the stores use */
function fakeFirestore() {
  const data = new Map<string, Record<string, unknown>>();
  let auto = 0;

  function assertNoUndefined(value: unknown, path = ''): void {
    if (value === undefined) throw new Error(`undefined value at ${path}`);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
    }
  }

  function docRef(path: string) {
    return {
      id: path.split('/').pop()!,
      async set(value: Record<string, unknown>) {
        assertNoUndefined(value);
        data.set(path, structuredClone(value));
      },
      async create(value: Record<string, unknown>) {
        if (data.has(path)) throw Object.assign(new Error('exists'), { code: 6 });
        data.set(path, structuredClone(value));
      },
      async update(value: Record<string, unknown>) {
        assertNoUndefined(value);
        if (!data.has(path)) throw new Error('missing');
        data.set(path, { ...data.get(path), ...structuredClone(value) });
      },
      async delete() {
        data.delete(path);
      },
      async get() {
        const value = data.get(path);
        return { id: path.split('/').pop()!, exists: value !== undefined, data: () => value };
      },
      collection: (name: string) => collectionRef(`${path}/${name}`),
    };
  }

  function collectionRef(path: string, filters: Array<[string, unknown]> = [], order?: [string, 'asc' | 'desc'], max?: number) {
    return {
      doc: (id?: string) => docRef(`${path}/${id ?? `auto${++auto}`}`),
      async add(value: Record<string, unknown>) {
        await docRef(`${path}/auto${++auto}`).set(value);
      },
      where: (field: string, _op: string, value: unknown) => collectionRef(path, [...filters, [field, value]], order, max),
      orderBy: (field: string, dir: 'asc' | 'desc') => collectionRef(path, filters, [field, dir], max),
      limit: (n: number) => collectionRef(path, filters, order, n),
      async get() {
        let docs = [...data.entries()]
          .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .filter(([, value]) => filters.every(([f, v]) => value[f] === v))
          .map(([key, value]) => ({ id: key.split('/').pop()!, data: () => value }));
        if (order) {
          const [field, dir] = order;
          docs.sort((a, b) => {
            const av = (a.data()[field] as Date).getTime();
            const bv = (b.data()[field] as Date).getTime();
            return dir === 'asc' ? av - bv : bv - av;
          });
        }
        if (max !== undefined) docs = docs.slice(0, max);
        return { docs };
      },
    };
  }

  return { db: { collection: (name: string) => collectionRef(name) } as unknown as Firestore, data };
}

const baseMemory = {
  personaId: 'aria',
  content: 'GameEnd launch is Feb 20',
  type: 'decision' as const,
  scope: { kind: 'project' as const, projectId: 'gameend' },
  sensitivity: 'normal' as const,
  source: { personId: 'parastoo', chatKind: 'group' as const, groupId: 'gameend-team', at: new Date('2026-10-10') },
  aboutPersonIds: [],
  confidence: 0.9,
};

describe('FirestoreMemoryStore', () => {
  it('stores memories without undefined fields and reads them back with dates', async () => {
    const { db, data } = fakeFirestore();
    const store = new FirestoreMemoryStore(db);
    const saved = await store.add({ ...baseMemory, topic: undefined, supersedes: undefined });

    const raw = data.get(`tireh_memories/${saved.id}`)!;
    expect(raw).toMatchObject({ active: true, scopeKey: 'project:gameend' });
    expect('topic' in raw).toBe(false);

    const loaded = await store.get(saved.id);
    expect(loaded?.source.at).toBeInstanceOf(Date);
    expect(loaded?.content).toBe(baseMemory.content);
  });

  it('lists only active memories for the persona and tracks scope changes', async () => {
    const { db, data } = fakeFirestore();
    const store = new FirestoreMemoryStore(db);
    const a = await store.add(baseMemory);
    const b = await store.add({ ...baseMemory, content: 'GameEnd launch is March 5' });
    await store.add({ ...baseMemory, personaId: 'other' });
    await store.update(a.id, { supersededBy: b.id });
    await store.update(b.id, { scope: { kind: 'org' } });

    const active = await store.listActive('aria');
    expect(active.map((m) => m.id)).toEqual([b.id]);
    expect(data.get(`tireh_memories/${b.id}`)!.scopeKey).toBe('org');

    await store.delete(b.id);
    expect(await store.listActive('aria')).toEqual([]);
    expect(await store.get(b.id)).toBeNull();
  });
});

describe('FirestoreShareOfferStore', () => {
  it('creates short ids that fit Telegram callback data and updates status', async () => {
    const { db } = fakeFirestore();
    const store = new FirestoreShareOfferStore(db);
    const offer = await store.create({
      personaId: 'aria',
      memoryId: 'm1',
      ownerPersonId: 'reza',
      proposedScope: { kind: 'project', projectId: 'gameend' },
    });
    expect(`share:${offer.id}`.length).toBeLessThanOrEqual(64);
    await store.setStatus(offer.id, 'approved');
    expect((await store.get(offer.id))?.status).toBe('approved');
    expect(await store.get('missing')).toBeNull();
  });
});

describe('FirestoreChatHistoryStore', () => {
  it('returns the most recent messages in chronological order', async () => {
    const { db } = fakeFirestore();
    const store = new FirestoreChatHistoryStore(db);
    for (let i = 0; i < 5; i++) {
      await store.append('aria', 'private-reza', { role: 'user', personId: 'reza', text: `m${i}`, at: new Date(2026, 0, 1, 0, i) });
    }
    const recent = await store.recent('aria', 'private-reza', 3);
    expect(recent.map((m) => m.text)).toEqual(['m2', 'm3', 'm4']);
    expect(await store.recent('aria', 'private-parastoo', 3)).toEqual([]);
  });
});

describe('FirestoreUpdateDeduper', () => {
  it('accepts an update once', async () => {
    const { db } = fakeFirestore();
    const deduper = new FirestoreUpdateDeduper(db);
    expect(await deduper.firstSeen('aria__1')).toBe(true);
    expect(await deduper.firstSeen('aria__1')).toBe(false);
    expect(await deduper.firstSeen('aria__2')).toBe(true);
  });
});
