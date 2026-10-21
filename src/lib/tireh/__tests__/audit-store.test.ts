import { mkdtempSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  auditRetentionCutoff, auditRowSchema, AUDIT_RETENTION_DAYS, chatKeyHash, createFileAuditStore, createFileSupersededNoticeStore,
  FirestoreAuditStore, FirestoreSupersededNoticeStore, InMemoryAuditStore, InMemorySupersededNoticeStore, normalizeAuditRow,
  sourceChatKey, type AuditStore, type NewAuditRow, type SupersededNoticeStore,
} from '../audit';

const CANARY = 'AUDIT_STORE_CANARY_91c';
const T = (iso: string) => new Date(iso);

function row(overrides: Partial<NewAuditRow> = {}): NewAuditRow {
  return {
    kind: 'write', personaId: 'aria', chatKeyHash: chatKeyHash('private-reza'), audiencePersonIds: ['reza'], memoryIds: ['m-1'],
    policyKey: 'tireh.visibility.v1:private:normal', actorPersonId: 'reza', outcome: 'applied', at: T('2026-10-20T10:00:00Z'), ...overrides,
  };
}

/** Minimal Admin SDK stand-in (firestore-store.test.ts pattern) with where/orderBy/limit/batch. */
function fakeFirestore() {
  const data = new Map<string, Record<string, unknown>>();
  const writes: Array<{ path: string; value: Record<string, unknown> }> = [];
  function assertNoUndefined(value: unknown, path = ''): void {
    if (value === undefined) throw new Error(`undefined value at ${path}`);
    if (value && typeof value === 'object' && !(value instanceof Date)) for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
  }
  type Filter = [string, string, unknown];
  const test = (doc: Record<string, unknown>, [field, op, value]: Filter) => {
    const actual = doc[field];
    const time = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v));
    switch (op) {
      case '==': return actual === value;
      case 'array-contains': return Array.isArray(actual) && actual.includes(value);
      case '>=': return time(actual) >= time(value);
      case '<': return time(actual) < time(value);
      default: throw new Error(`unsupported op ${op}`);
    }
  };
  function docRef(path: string) {
    return {
      id: path.split('/').pop()!, path,
      async create(value: Record<string, unknown>) {
        assertNoUndefined(value);
        if (data.has(path)) throw Object.assign(new Error('exists'), { code: 6 });
        writes.push({ path, value: structuredClone(value) });
        data.set(path, structuredClone(value));
      },
      async delete() { data.delete(path); },
    };
  }
  function collectionRef(path: string, filters: Filter[] = [], order?: [string, 'asc' | 'desc'], max?: number) {
    return {
      doc: (id: string) => docRef(`${path}/${id}`),
      where: (field: string, op: string, value: unknown) => collectionRef(path, [...filters, [field, op, value]], order, max),
      orderBy: (field: string, dir: 'asc' | 'desc') => collectionRef(path, filters, [field, dir], max),
      limit: (n: number) => collectionRef(path, filters, order, n),
      async get() {
        let docs = [...data.entries()]
          .filter(([key]) => key.startsWith(`${path}/`))
          .filter(([, value]) => filters.every((f) => test(value, f)))
          .map(([key, value]) => ({ id: key.split('/').pop()!, ref: docRef(key), data: () => structuredClone(value) }));
        if (order) {
          const [field, dir] = order;
          docs.sort((a, b) => ((a.data()[field] as Date).getTime() - (b.data()[field] as Date).getTime()) * (dir === 'asc' ? 1 : -1));
        }
        if (max !== undefined) docs = docs.slice(0, max);
        return { docs };
      },
    };
  }
  const db = {
    collection: (name: string) => collectionRef(name),
    batch: () => {
      const ops: Array<() => Promise<void>> = [];
      return { delete: (ref: { delete(): Promise<void> }) => { ops.push(() => ref.delete()); }, commit: async () => { for (const op of ops) await op(); } };
    },
  };
  return { db: db as unknown as Firestore, data, writes };
}

describe('audit row rules', () => {
  it('normalizes arrays and rejects content-bearing or malformed rows', () => {
    const many = Array.from({ length: 250 }, (_, i) => `p${String(i).padStart(3, '0')}`);
    const normalized = normalizeAuditRow(row({ audiencePersonIds: ['b', 'a', 'b', ...many], memoryIds: ['m2', 'm1', 'm2'] }));
    expect(normalized.audiencePersonIds).toHaveLength(200);
    expect(normalized.audiencePersonIds.slice(0, 2)).toEqual(['a', 'b']);
    expect(normalized.memoryIds).toEqual(['m1', 'm2']);
    expect(() => auditRowSchema.parse({ ...row(), content: CANARY })).toThrow();
    expect(() => auditRowSchema.parse({ ...row(), topic: 'x' })).toThrow();
    expect(() => auditRowSchema.parse(row({ policyKey: 'has spaces in it' }))).toThrow();
    expect(() => auditRowSchema.parse(row({ actorPersonId: 'reza said hi' }))).toThrow();
    expect(() => auditRowSchema.parse(row({ memoryIds: ['line\nbreak'] }))).toThrow();
    expect(() => auditRowSchema.parse(row({ chatKeyHash: 'not-a-hash' }))).toThrow();
  });

  it('hashes chat keys deterministically and maps sources to gateway chat keys', () => {
    expect(chatKeyHash('group-leads')).toMatch(/^[0-9a-f]{32}$/);
    expect(chatKeyHash('group-leads')).toBe(chatKeyHash('group-leads'));
    expect(chatKeyHash('group-leads')).not.toBe(chatKeyHash('group-other'));
    expect(sourceChatKey({ source: { personId: 'reza', chatKind: 'group', groupId: 'leads', at: new Date() } })).toBe('group-leads');
    expect(sourceChatKey({ source: { personId: 'reza', chatKind: 'private', at: new Date() } })).toBe('private-reza');
    expect(AUDIT_RETENTION_DAYS).toBe(365);
    expect(auditRetentionCutoff(T('2026-10-20T00:00:00Z')).toISOString()).toBe('2025-10-20T00:00:00.000Z');
  });
});

async function exerciseStore(store: AuditStore) {
  const first = await store.append(row({ at: T('2026-01-01T00:00:00Z'), memoryIds: ['m-old'] }));
  expect(first.id).toBeTruthy();
  await store.append(row({ at: T('2026-10-19T00:00:00Z'), memoryIds: ['m-1', 'm-2'] }));
  await store.append(row({ at: T('2026-10-20T00:00:00Z'), memoryIds: ['m-2'] }));
  await store.append(row({ personaId: 'other', at: T('2026-10-20T00:00:00Z') }));
  const all = await store.list({ personaId: 'aria' });
  expect(all.map((r) => r.at.toISOString())).toEqual(['2026-10-20T00:00:00.000Z', '2026-10-19T00:00:00.000Z', '2026-01-01T00:00:00.000Z']);
  expect(all.every((r) => r.at instanceof Date)).toBe(true);
  expect((await store.list({ personaId: 'aria', memoryId: 'm-2' })).map((r) => r.memoryIds)).toEqual([['m-2'], ['m-1', 'm-2']]);
  expect(await store.list({ personaId: 'aria', since: T('2026-10-19T00:00:00Z') })).toHaveLength(2);
  expect(await store.list({ personaId: 'aria', limit: 1 })).toHaveLength(1);
  expect(await store.sweep(T('2026-06-01T00:00:00Z'))).toBe(1);
  expect((await store.list({ personaId: 'aria' })).map((r) => r.memoryIds)).toEqual([['m-2'], ['m-1', 'm-2']]);
  expect(await store.list({ personaId: 'other' })).toHaveLength(1);
}

describe('AuditStore implementations', () => {
  it('in memory: append, list filters, newest first, sweep', async () => {
    const store = new InMemoryAuditStore();
    await exerciseStore(store);
    expect(store.rows).toHaveLength(3);
  });

  it('file: append-only JSONL with mode 0o600, readable by a new instance, sweep rewrites', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vox-audit-'));
    const path = join(dir, 'vox-audit.jsonl');
    const store = createFileAuditStore(path);
    await store.append(row({ memoryIds: ['m-x'] }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).memoryIds).toEqual(['m-x']);
    const reopened = createFileAuditStore(path);
    expect((await reopened.list({ personaId: 'aria' }))[0].at).toBeInstanceOf(Date);
    const fresh = createFileAuditStore(join(dir, 'second.jsonl'));
    await exerciseStore(fresh);
    expect(readFileSync(join(dir, 'second.jsonl'), 'utf8').trim().split('\n')).toHaveLength(3);
    // A memory's content elsewhere never reaches the audit file.
    expect(readFileSync(path, 'utf8')).not.toContain(CANARY);
    await expect(store.append({ ...row(), content: CANARY } as NewAuditRow)).rejects.toThrow();
    expect(readFileSync(path, 'utf8')).not.toContain(CANARY);
  });

  it('firestore: vox_audit collection, no undefined fields, filtered queries, batched sweep', async () => {
    const { db, data, writes } = fakeFirestore();
    const store = new FirestoreAuditStore(db);
    await store.append(row({ chatKeyHash: undefined, actorPersonId: undefined }));
    expect(writes[0].path.startsWith('vox_audit/')).toBe(true);
    expect('actorPersonId' in writes[0].value).toBe(false);
    data.clear();
    await exerciseStore(store);
    expect([...data.keys()].every((key) => key.startsWith('vox_audit/'))).toBe(true);
    expect(JSON.stringify([...data.values()])).not.toContain(CANARY);
  });
});

async function exerciseNotices(store: SupersededNoticeStore) {
  const base = { personaId: 'aria', oldMemoryId: 'm-old', newMemoryId: 'm-new', ownerPersonId: 'reza' };
  await store.record({ ...base, recipientPersonIds: ['parastoo', 'milad'], at: T('2026-10-01T00:00:00Z') });
  await store.record({ ...base, oldMemoryId: 'm-2', recipientPersonIds: ['parastoo'], at: T('2026-10-19T00:00:00Z') });
  await store.record({ ...base, personaId: 'other', recipientPersonIds: ['parastoo'], at: T('2026-10-19T00:00:00Z') });
  expect((await store.listFor('aria', 'parastoo')).map((n) => n.oldMemoryId)).toEqual(['m-2', 'm-old']);
  expect((await store.listFor('aria', 'parastoo', T('2026-10-10T00:00:00Z'))).map((n) => n.oldMemoryId)).toEqual(['m-2']);
  expect((await store.listFor('aria', 'milad')).map((n) => n.oldMemoryId)).toEqual(['m-old']);
  expect(await store.listFor('aria', 'sina')).toEqual([]);
  expect((await store.listFor('aria', 'milad'))[0].at).toBeInstanceOf(Date);
  await expect(store.record({ ...base, recipientPersonIds: [], at: new Date() })).rejects.toThrow();
  await expect(store.record({ ...base, recipientPersonIds: ['x'], at: new Date(), content: CANARY } as never)).rejects.toThrow();
}

describe('SupersededNoticeStore implementations', () => {
  it('in memory', async () => {
    const store = new InMemorySupersededNoticeStore();
    await exerciseNotices(store);
    expect(JSON.stringify(store.notices)).not.toContain(CANARY);
  });

  it('file: JSON array, mode 0o600, survives a new instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vox-audit-'));
    const path = join(dir, 'supersede-notices.json');
    await exerciseNotices(createFileSupersededNoticeStore(path));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(await createFileSupersededNoticeStore(path).listFor('aria', 'parastoo')).toHaveLength(2);
    expect(readFileSync(path, 'utf8')).not.toContain(CANARY);
  });

  it('firestore: tireh_supersede_notices collection and recipient filter', async () => {
    const { db, data } = fakeFirestore();
    await exerciseNotices(new FirestoreSupersededNoticeStore(db));
    expect([...data.keys()].every((key) => key.startsWith('tireh_supersede_notices/'))).toBe(true);
  });
});
