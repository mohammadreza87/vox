/**
 * QA round 3 on main, lens tests-types: pins the Firestore half of fixer r2's
 * rollback erasure (53b9361). After a flag rollback wireSharingAudit keeps an
 * erasure-only notice path, and installs the notice-erasing memory store only
 * when SupersededNoticeStore.hasAny() says notices may be stored. Only the file
 * store's hasAny was exercised (sharing-v2 runtime wiring); replacing
 * FirestoreSupersededNoticeStore.hasAny with `return false` kept every suite
 * green, so on Firestore (production) a rolled-back deployment would keep
 * notices naming a deleted memory. Fakes only: no Firestore, no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreSupersededNoticeStore, NOTICE_COLLECTION } from '../../tireh/audit';
import { InMemoryMemoryStore, InMemoryShareOfferStore } from '../../tireh/memory/store';
import { wireSharingAudit } from '../runtime';
import type { Studio } from '../service';

type Doc = Record<string, unknown>;
type Op = '==' | '<' | '>=' | 'array-contains' | 'in';

/** Just the Firestore surface the audit and notice stores use. */
function fakeFirestore(options: { failNoticeReads?: boolean } = {}) {
  const data = new Map<string, Doc>();
  const writes: string[] = [];
  const at = (value: unknown) => (value instanceof Date ? value.getTime() : Number.NaN);
  const matches = (doc: Doc, [field, op, value]: [string, Op, unknown]) => {
    switch (op) {
      case '==': return doc[field] === value;
      case '<': return at(doc[field]) < at(value);
      case '>=': return at(doc[field]) >= at(value);
      case 'array-contains': return Array.isArray(doc[field]) && (doc[field] as unknown[]).includes(value);
      // The notice erasure queries `in` with at most 30 ids (Firestore's limit).
      case 'in':
        if (!Array.isArray(value) || value.length === 0 || value.length > 30) throw new Error('invalid in filter');
        return (value as unknown[]).includes(doc[field]);
    }
  };
  const ref = (path: string) => ({
    path,
    async create(value: Doc) { if (data.has(path)) throw new Error('exists'); writes.push(path); data.set(path, { ...value }); },
    async delete() { writes.push(`delete ${path}`); data.delete(path); },
  });
  type Ref = ReturnType<typeof ref>;
  const query = (name: string, filters: Array<[string, Op, unknown]>, max = Infinity) => ({
    where: (field: string, op: Op, value: unknown) => query(name, [...filters, [field, op, value]], max),
    orderBy: () => query(name, filters, max),
    limit: (n: number) => query(name, filters, n),
    async get() {
      if (options.failNoticeReads && name === NOTICE_COLLECTION) throw new Error('unavailable');
      const docs = [...data.entries()]
        .filter(([path, doc]) => path.startsWith(`${name}/`) && filters.every((f) => matches(doc, f)))
        .slice(0, max)
        .map(([path, doc]) => ({ id: path.slice(name.length + 1), ref: ref(path), data: () => ({ ...doc }) }));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  const db = {
    collection: (name: string) => ({ ...query(name, []), doc: (id: string) => ref(`${name}/${id}`) }),
    batch() {
      const pending: Array<() => Promise<void>> = [];
      return {
        create: (r: Ref, value: Doc) => { pending.push(() => r.create(value)); },
        delete: (r: Ref) => { pending.push(() => r.delete()); },
        commit: async () => { for (const write of pending) await write(); },
      };
    },
  };
  return { db: db as unknown as Firestore, data, writes };
}

const notice = (oldMemoryId: string) => ({ personaId: 'agent-x', oldMemoryId, newMemoryId: `${oldMemoryId}-next`, ownerPersonId: 'tg-1', recipientPersonIds: ['tg-2'], at: new Date('2026-10-25T10:00:00Z') });
const newMemory = () => ({ personaId: 'agent-x', content: 'x', topic: 't', type: 'fact' as const, sensitivity: 'normal' as const, aboutPersonIds: [], confidence: 0.9,
  scope: { kind: 'people' as const, personIds: ['tg-1', 'tg-2'] }, authorizedPersonIds: ['tg-1', 'tg-2'],
  source: { personId: 'tg-1', chatKind: 'private' as const, at: new Date('2026-10-25T09:00:00Z'), eventIds: [`ev-${Math.random()}`] } });
const studioWith = (memories: InMemoryMemoryStore) => ({ deps: { memory: { memories, offers: new InMemoryShareOfferStore() } } }) as unknown as Pick<Studio, 'deps'>;
const flagsUnset = () => { vi.stubEnv('TIREH_SHARING_V2', ''); vi.stubEnv('TIREH_AUDIT_LOG', ''); };

afterEach(() => { vi.unstubAllEnvs(); });

describe('QA tests-types r3: FirestoreSupersededNoticeStore.hasAny (53b9361)', () => {
  it('is false on an empty collection, true once a notice is stored, false again after erasure, and never writes', async () => {
    const { db, data, writes } = fakeFirestore();
    const store = new FirestoreSupersededNoticeStore(db);
    expect(await store.hasAny()).toBe(false);
    expect(writes).toEqual([]);
    await store.record(notice('m1'));
    const stored = data.size;
    expect(await store.hasAny()).toBe(true);
    expect(data.size).toBe(stored);
    expect(await store.deleteForPerson('tg-1')).toBeGreaterThan(0);
    expect(await store.hasAny()).toBe(false);
  });
});

describe('QA tests-types r3: wireSharingAudit on Firestore with both S08 flags unset (rollback)', () => {
  it('a stored notice installs the erasing memory store: deleting its memory erases the notice', async () => {
    flagsUnset();
    const { db, data } = fakeFirestore();
    const memories = new InMemoryMemoryStore();
    const erased = await memories.add(newMemory());
    const kept = await memories.add(newMemory());
    const notices = new FirestoreSupersededNoticeStore(db);
    await notices.record(notice(erased.id));
    await notices.record(notice(kept.id));
    const studio = studioWith(memories);
    await wireSharingAudit(studio, '/nonexistent-qa-dir', db);
    expect(studio.deps.memoryNotices).toBeUndefined();
    expect(studio.deps.audit).toBeUndefined();
    expect(studio.deps.memory.memories).not.toBe(memories);
    await studio.deps.memory.memories.delete(erased.id);
    const remaining = [...data.entries()].filter(([path]) => path.startsWith(`${NOTICE_COLLECTION}/`)).map(([, doc]) => doc.oldMemoryId);
    expect(remaining).toEqual([kept.id]);
    expect(await memories.get(erased.id)).toBeNull();
  });

  it('an empty notice collection leaves the memory store unwrapped and writes nothing', async () => {
    flagsUnset();
    const { db, writes } = fakeFirestore();
    const memories = new InMemoryMemoryStore();
    const studio = studioWith(memories);
    await wireSharingAudit(studio, '/nonexistent-qa-dir', db);
    expect(studio.deps.memory.memories).toBe(memories);
    expect(typeof studio.deps.noticeEraser?.deleteByMemoryIds).toBe('function');
    expect(writes).toEqual([]);
  });

  it('a failed existence read assumes notices may be stored (erasure wins)', async () => {
    flagsUnset();
    const { db } = fakeFirestore({ failNoticeReads: true });
    const memories = new InMemoryMemoryStore();
    const studio = studioWith(memories);
    await wireSharingAudit(studio, '/nonexistent-qa-dir', db);
    expect(studio.deps.memory.memories).not.toBe(memories);
  });
});
