/**
 * Hardening H1 (F049, F090, F175, F256): FirestoreAuditStore.list runs the
 * memoryId and since filters in the query, before the limit, so it returns
 * the same rows as the in-memory store. Local Firestore fake: where (==, >=,
 * array-contains), orderBy (desc), limit, get. No Firestore, no network.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { AUDIT_COLLECTION, FirestoreAuditStore, InMemoryAuditStore, type NewAuditRow } from '../audit';

type Doc = Record<string, unknown>;
type Op = '==' | '>=' | '<' | 'array-contains';
type Filter = [string, Op, unknown];

function fakeFirestore() {
  const data = new Map<string, Doc>();
  const queries: Array<{ filters: Filter[]; order: string | null; limit: number }> = [];
  const time = (value: unknown) => (value instanceof Date ? value.getTime() : Number.NaN);
  const matches = (doc: Doc, [field, op, value]: Filter) => {
    switch (op) {
      case '==': return doc[field] === value;
      case '>=': return time(doc[field]) >= time(value);
      case '<': return time(doc[field]) < time(value);
      case 'array-contains': return Array.isArray(doc[field]) && (doc[field] as unknown[]).includes(value);
    }
  };
  const ref = (path: string) => ({ path, async create(value: Doc) { if (data.has(path)) throw new Error('exists'); data.set(path, { ...value }); } });
  const query = (name: string, filters: Filter[], order: { field: string; dir: string } | null, max: number) => ({
    where: (field: string, op: Op, value: unknown) => query(name, [...filters, [field, op, value]], order, max),
    orderBy: (field: string, dir = 'asc') => query(name, filters, { field, dir }, max),
    limit: (n: number) => query(name, filters, order, n),
    async get() {
      queries.push({ filters, order: order ? `${order.field} ${order.dir}` : null, limit: max });
      let docs = [...data.entries()].filter(([path, doc]) => path.startsWith(`${name}/`) && filters.every((f) => matches(doc, f)));
      if (order) docs = docs.sort(([, a], [, b]) => (time(a[order.field]) - time(b[order.field])) * (order.dir === 'desc' ? -1 : 1));
      const out = docs.slice(0, max).map(([path, doc]) => ({ id: path.slice(name.length + 1), ref: ref(path), data: () => ({ ...doc }) }));
      return { docs: out, empty: out.length === 0, size: out.length };
    },
  });
  const db = { collection: (name: string) => ({ ...query(name, [], null, Infinity), doc: (id: string) => ref(`${name}/${id}`) }) };
  return { db: db as unknown as Firestore, queries };
}

const T0 = Date.parse('2026-10-01T00:00:00Z');
const row = (i: number, memoryId: string, personaId = 'aria'): NewAuditRow => ({
  kind: 'write', personaId, memoryIds: [memoryId], audiencePersonIds: ['reza'], outcome: 'applied', at: new Date(T0 + i * 60_000),
});

async function seed(stores: Array<{ append(row: NewAuditRow): Promise<unknown> }>) {
  // The oldest row names m-old; 300 newer rows name other memories; another persona's rows are mixed in.
  for (const store of stores) {
    await store.append(row(0, 'm-old'));
    for (let i = 1; i <= 300; i++) await store.append(row(i, `m-${i}`));
    await store.append(row(5, 'm-old', 'nova'));
  }
}

describe('FirestoreAuditStore.list filters before the limit (H1)', () => {
  it('returns a memory older than the newest 100 rows, like the in-memory store', async () => {
    const { db, queries } = fakeFirestore();
    const firestore = new FirestoreAuditStore(db);
    const memory = new InMemoryAuditStore();
    await seed([firestore, memory]);

    const got = await firestore.list({ personaId: 'aria', memoryId: 'm-old' });
    expect(got.map((r) => r.memoryIds)).toEqual([['m-old']]);
    expect(got[0].at.getTime()).toBe(T0);
    expect(got.map((r) => r.id)).toHaveLength(1);
    expect((await memory.list({ personaId: 'aria', memoryId: 'm-old' })).map((r) => r.memoryIds)).toEqual([['m-old']]);

    const last = queries.at(-1)!;
    expect(last.filters).toEqual([['personaId', '==', 'aria'], ['memoryIds', 'array-contains', 'm-old']]);
    expect(last.order).toBe('at desc');
    expect(last.limit).toBe(100);
  });

  it('since narrows the query itself (where at >= since), newest first, and the limit applies after it', async () => {
    const { db, queries } = fakeFirestore();
    const firestore = new FirestoreAuditStore(db);
    const memory = new InMemoryAuditStore();
    await seed([firestore, memory]);
    const since = new Date(T0 + 250 * 60_000);

    const got = await firestore.list({ personaId: 'aria', since, limit: 500 });
    expect(got).toHaveLength(51);
    expect(got[0].memoryIds).toEqual(['m-300']);
    expect(got.every((r) => r.at.getTime() >= since.getTime())).toBe(true);
    expect(got.map((r) => r.memoryIds)).toEqual((await memory.list({ personaId: 'aria', since, limit: 500 })).map((r) => r.memoryIds));

    const last = queries.at(-1)!;
    expect(last.filters).toEqual([['personaId', '==', 'aria'], ['at', '>=', since]]);
    expect(last.order).toBe('at desc');
    expect(last.limit).toBe(500);
  });

  it('memoryId and since together, and a since after the memory returns nothing', async () => {
    const { db, queries } = fakeFirestore();
    const firestore = new FirestoreAuditStore(db);
    await seed([firestore]);
    expect(await firestore.list({ personaId: 'aria', memoryId: 'm-old', since: new Date(T0 + 1) })).toEqual([]);
    expect(queries.at(-1)!.filters).toEqual([['personaId', '==', 'aria'], ['memoryIds', 'array-contains', 'm-old'], ['at', '>=', new Date(T0 + 1)]]);
    expect(await firestore.list({ personaId: 'aria', memoryId: 'm-old', since: new Date(T0) })).toHaveLength(1);
  });

  it('without filters the query is personaId only, ordered and limited as before', async () => {
    const { db, queries } = fakeFirestore();
    const firestore = new FirestoreAuditStore(db);
    await seed([firestore]);
    const got = await firestore.list({ personaId: 'aria' });
    expect(got).toHaveLength(100);
    expect(got[0].memoryIds).toEqual(['m-300']);
    expect(queries.at(-1)).toEqual({ filters: [['personaId', '==', 'aria']], order: 'at desc', limit: 100 });
    expect(AUDIT_COLLECTION).toBe('vox_audit');
  });

  it('the header no longer says list() fails, and names the indexes in firestore.indexes.json', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/tireh/audit/firestore.ts'), 'utf8');
    const header = source.slice(0, source.indexOf('*/'));
    expect(header).not.toMatch(/list\(\) fails/);
    expect(header).not.toMatch(/filtered in memory so no further index/);
    expect(header).toContain('firestore.indexes.json');
  });

  it('firestore.indexes.json holds both vox_audit composites', () => {
    const parsed = JSON.parse(readFileSync(join(process.cwd(), 'firestore.indexes.json'), 'utf8')) as { indexes: Array<{ collectionGroup: string; fields: unknown[] }> };
    const audit = parsed.indexes.filter((index) => index.collectionGroup === 'vox_audit').map((index) => index.fields);
    expect(audit).toContainEqual([{ fieldPath: 'personaId', order: 'ASCENDING' }, { fieldPath: 'at', order: 'DESCENDING' }]);
    expect(audit).toContainEqual([{ fieldPath: 'personaId', order: 'ASCENDING' }, { fieldPath: 'memoryIds', arrayConfig: 'CONTAINS' }, { fieldPath: 'at', order: 'DESCENDING' }]);
  });
});
