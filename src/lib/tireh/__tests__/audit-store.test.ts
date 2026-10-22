/**
 * S08 content-free audit log and supersede-notice stores: in memory, JSONL file
 * (under os.tmpdir(), i.e. $TMPDIR) and Firestore through a minimal fake
 * defined here.
 */
import { appendFileSync, mkdtempSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  AUDIT_RETENTION_DAYS, auditCutoff, chatKeyHash, createFileAuditStore, createFileSupersededNoticeStore, FirestoreAuditStore,
  FirestoreSupersededNoticeStore, InMemoryAuditStore, InMemorySupersededNoticeStore, memoryPolicyKey, newAuditRowSchema, normalizeAuditRow,
  POLICY_KEY_PATTERN, type AuditStore, type NewAuditRow, type SupersededNoticeStore,
} from '../audit';

const CANARY = 'AUDIT_STORE_CANARY_91c';
const T = (iso: string) => new Date(iso);
const POLICY = memoryPolicyKey({ scope: { kind: 'private', personId: 'reza' }, shareVersion: 0, sensitivity: 'normal' });

function row(overrides: Partial<NewAuditRow> = {}): NewAuditRow {
  return {
    kind: 'write', personaId: 'aria', chatKeyHash: chatKeyHash('private-reza'), audiencePersonIds: ['reza'], memoryIds: ['m-1'],
    policyKey: POLICY, actorPersonId: 'reza', outcome: 'applied', at: T('2026-10-20T10:00:00Z'), ...overrides,
  };
}

/** Minimal Admin SDK stand-in: collection/doc.create/where/orderBy/limit/get and batch create/delete. */
function fakeFirestore() {
  const data = new Map<string, Record<string, unknown>>();
  const creates: Array<{ path: string; value: Record<string, unknown> }> = [];
  const queries: Array<{ path: string; filters: Filter[]; order?: [string, string]; max?: number }> = [];
  type Filter = [string, string, unknown];
  function assertNoUndefined(value: unknown, path = ''): void {
    if (value === undefined) throw new Error(`undefined value at ${path}`);
    if (value && typeof value === 'object' && !(value instanceof Date)) for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
  }
  const time = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v));
  const test = (doc: Record<string, unknown>, [field, op, value]: Filter) => {
    switch (op) {
      case '==': return doc[field] === value;
      case '<': return time(doc[field]) < time(value);
      default: throw new Error(`unsupported op ${op}`);
    }
  };
  function docRef(path: string) {
    return {
      id: path.split('/').pop()!, path,
      async create(value: Record<string, unknown>) {
        assertNoUndefined(value);
        if (data.has(path)) throw Object.assign(new Error('exists'), { code: 6 });
        creates.push({ path, value: structuredClone(value) });
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
        queries.push({ path, filters, order, max });
        let docs = [...data.entries()]
          .filter(([key]) => key.startsWith(`${path}/`))
          .filter(([, value]) => filters.every((f) => test(value, f)))
          .map(([key, value]) => ({ id: key.split('/').pop()!, ref: docRef(key), data: () => structuredClone(value) }));
        if (order) {
          const [field, dir] = order;
          docs.sort((a, b) => (time(a.data()[field]) - time(b.data()[field])) * (dir === 'asc' ? 1 : -1));
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
      return {
        create: (ref: ReturnType<typeof docRef>, value: Record<string, unknown>) => { ops.push(() => ref.create(value)); },
        delete: (ref: { delete(): Promise<void> }) => { ops.push(() => ref.delete()); },
        commit: async () => { for (const op of ops) await op(); },
      };
    },
  };
  return { db: db as unknown as Firestore, data, creates, queries };
}

describe('audit row rules', () => {
  it('normalizes arrays: sorted, unique, capped at 200', () => {
    const many = Array.from({ length: 250 }, (_, i) => `p${String(i).padStart(3, '0')}`);
    const normalized = normalizeAuditRow(row({ audiencePersonIds: ['b', 'a', 'b', ...many], memoryIds: ['m2', 'm1', 'm2', ...many] }));
    expect(normalized.audiencePersonIds).toHaveLength(200);
    expect(normalized.audiencePersonIds.slice(0, 2)).toEqual(['a', 'b']);
    expect(normalized.memoryIds).toHaveLength(200);
    expect(normalized.memoryIds.slice(0, 2)).toEqual(['m1', 'm2']);
  });

  it('the strict schema rejects content, free text, unknown kinds and malformed hashes or policy keys', () => {
    expect(() => newAuditRowSchema.parse({ ...row(), content: CANARY })).toThrow();
    expect(() => newAuditRowSchema.parse({ ...row(), topic: CANARY })).toThrow();
    expect(() => newAuditRowSchema.parse(row({ actorPersonId: 'reza said hi' }))).toThrow();
    expect(() => newAuditRowSchema.parse(row({ memoryIds: ['line\nbreak'] }))).toThrow();
    expect(() => newAuditRowSchema.parse(row({ kind: 'gossip' as never }))).toThrow();
    expect(() => newAuditRowSchema.parse(row({ chatKeyHash: 'not-a-hash' }))).toThrow();
    expect(() => newAuditRowSchema.parse(row({ chatKeyHash: 'A'.repeat(32) }))).toThrow();
    expect(() => newAuditRowSchema.parse(row({ policyKey: 'tireh.visibility.v1:private:normal' }))).toThrow();
    expect(() => newAuditRowSchema.parse(row({ policyKey: `private:${'0'.repeat(16)}:s1:secret` }))).toThrow();
    expect(() => newAuditRowSchema.parse(row({ at: new Date(NaN) }))).toThrow();
    expect(newAuditRowSchema.parse(row())).toEqual(row());
  });

  it('chatKeyHash is 32 lowercase hex characters, deterministic and does not contain the input', () => {
    const key = 'group-chat-100777';
    expect(chatKeyHash(key)).toMatch(/^[0-9a-f]{32}$/);
    expect(chatKeyHash(key)).toBe(chatKeyHash(key));
    expect(chatKeyHash(key)).not.toBe(chatKeyHash('group-chat-100778'));
    expect(chatKeyHash(key)).not.toContain('100777');
  });

  it('memoryPolicyKey is bounded and never contains the person ids of a people scope', () => {
    const key = memoryPolicyKey({ scope: { kind: 'people', personIds: ['parastoo', 'reza'] }, shareVersion: 3, sensitivity: 'normal' });
    expect(key).toMatch(POLICY_KEY_PATTERN);
    expect(key).toMatch(/^people:[0-9a-f]{16}:s3:normal$/);
    expect(key).not.toContain('reza');
    expect(key).not.toContain('parastoo');
    expect(memoryPolicyKey({ scope: { kind: 'org' }, sensitivity: 'confidential' })).toMatch(/^org:[0-9a-f]{16}:s0:confidential$/);
    expect(memoryPolicyKey({ scope: { kind: 'group', groupId: 'leads' }, shareVersion: 1, sensitivity: 'normal' }))
      .not.toBe(memoryPolicyKey({ scope: { kind: 'group', groupId: 'gameend-team' }, shareVersion: 1, sensitivity: 'normal' }));
  });

  it('retention is 365 days', () => {
    expect(AUDIT_RETENTION_DAYS).toBe(365);
    expect(auditCutoff(T('2026-10-20T00:00:00Z')).toISOString()).toBe('2025-10-20T00:00:00.000Z');
  });

  it('the stores expose no update or delete method besides sweep', () => {
    for (const proto of [InMemoryAuditStore.prototype, FirestoreAuditStore.prototype]) {
      const methods = Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor').sort();
      expect(methods).toEqual(['append', 'list', 'sweep']);
    }
    expect(Object.keys(createFileAuditStore(join(tmpdir(), 'never-written.jsonl'))).sort()).toEqual(['append', 'list', 'sweep']);
  });
});

const NOW = T('2026-10-20T00:00:00Z');

async function exerciseStore(store: AuditStore) {
  const first = await store.append(row({ at: T('2025-01-01T00:00:00Z'), memoryIds: ['m-old'] }));
  const second = await store.append(row({ at: T('2025-01-01T00:00:00Z'), memoryIds: ['m-old'] }));
  expect(first.id).toBeTruthy();
  expect(first.id).not.toBe(second.id);
  await store.append(row({ at: T('2026-10-19T00:00:00Z'), memoryIds: ['m-2', 'm-1', 'm-2'] }));
  await store.append(row({ at: T('2026-10-20T00:00:00Z'), memoryIds: ['m-2'] }));
  await store.append(row({ personaId: 'other', at: T('2026-10-20T00:00:00Z') }));
  const all = await store.list({ personaId: 'aria' });
  expect(all.map((r) => r.at.toISOString())).toEqual(['2026-10-20T00:00:00.000Z', '2026-10-19T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z']);
  expect(all.every((r) => r.at instanceof Date)).toBe(true);
  expect((await store.list({ personaId: 'aria', memoryId: 'm-2' })).map((r) => r.memoryIds)).toEqual([['m-2'], ['m-1', 'm-2']]);
  expect(await store.list({ personaId: 'aria', since: T('2026-10-19T00:00:00Z') })).toHaveLength(2);
  expect(await store.list({ personaId: 'aria', limit: 1 })).toHaveLength(1);
  expect(await store.list({ personaId: 'nobody' })).toEqual([]);
  expect(await store.sweep(auditCutoff(NOW))).toBe(2);
  expect((await store.list({ personaId: 'aria' })).map((r) => r.memoryIds)).toEqual([['m-2'], ['m-1', 'm-2']]);
  expect(await store.list({ personaId: 'other' })).toHaveLength(1);
  expect(await store.sweep(auditCutoff(NOW))).toBe(0);
}

async function exerciseLimits(store: AuditStore) {
  for (let i = 0; i < 520; i++) await store.append(row({ at: new Date(NOW.getTime() - i * 1000) }));
  expect(await store.list({ personaId: 'aria' })).toHaveLength(100);
  expect(await store.list({ personaId: 'aria', limit: 10_000 })).toHaveLength(500);
}

describe('AuditStore implementations', () => {
  it('in memory: append, list filters newest first, limit default 100 and max 500, sweep', async () => {
    await exerciseStore(new InMemoryAuditStore());
    await exerciseLimits(new InMemoryAuditStore());
  });

  it('file: append-only JSONL with mode 0o600, skips a corrupted line, sweep rewrites', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vox-audit-'));
    const path = join(dir, 'vox-audit.jsonl');
    const store = createFileAuditStore(path);
    await store.append(row({ memoryIds: ['m-x'] }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    appendFileSync(path, '{not json\n');
    appendFileSync(path, `${JSON.stringify({ id: 'bad', ...row(), content: CANARY })}\n`);
    await store.append(row({ memoryIds: ['m-y'] }));
    const reopened = createFileAuditStore(path);
    const rows = await reopened.list({ personaId: 'aria' });
    expect(rows.map((r) => r.memoryIds[0]).sort()).toEqual(['m-x', 'm-y']);
    expect(rows[0].at).toBeInstanceOf(Date);
    await expect(store.append({ ...row(), content: CANARY } as NewAuditRow)).rejects.toThrow();
    await exerciseStore(createFileAuditStore(join(dir, 'second.jsonl')));
    expect(readFileSync(join(dir, 'second.jsonl'), 'utf8').trim().split('\n')).toHaveLength(3);
    expect(statSync(join(dir, 'second.jsonl')).mode & 0o777).toBe(0o600);
  });

  it('firestore: create() into vox_audit, no undefined fields, bounded query, batched sweep', async () => {
    const { db, data, creates, queries } = fakeFirestore();
    const store = new FirestoreAuditStore(db);
    await store.append(row({ chatKeyHash: undefined, actorPersonId: undefined }));
    expect(creates[0].path.startsWith('vox_audit/')).toBe(true);
    expect('actorPersonId' in creates[0].value).toBe(false);
    data.clear();
    await exerciseStore(store);
    expect([...data.keys()].every((key) => key.startsWith('vox_audit/'))).toBe(true);
    const listQuery = queries.find((q) => q.filters.some(([f]) => f === 'personaId'))!;
    expect(listQuery).toMatchObject({ path: 'vox_audit', filters: [['personaId', '==', 'aria']], order: ['at', 'desc'], max: 100 });
    data.clear();
    await exerciseLimits(store);
    expect(JSON.stringify([...data.values()])).not.toContain(CANARY);
  });
});

async function exerciseNotices(store: SupersededNoticeStore) {
  const base = { personaId: 'aria', oldMemoryId: 'm-old', newMemoryId: 'm-new', ownerPersonId: 'reza' };
  await store.record({ ...base, recipientPersonIds: ['parastoo', 'milad', 'parastoo'], at: T('2026-10-01T00:00:00Z') });
  await store.record({ ...base, oldMemoryId: 'm-2', recipientPersonIds: ['parastoo'], at: T('2026-10-19T00:00:00Z') });
  await store.record({ ...base, personaId: 'other', recipientPersonIds: ['parastoo'], at: T('2026-10-19T00:00:00Z') });
  expect((await store.listFor('aria', 'parastoo')).map((n) => n.oldMemoryId)).toEqual(['m-2', 'm-old']);
  expect((await store.listFor('aria', 'parastoo', T('2026-10-10T00:00:00Z'))).map((n) => n.oldMemoryId)).toEqual(['m-2']);
  const [milad] = await store.listFor('aria', 'milad');
  expect(milad).toMatchObject({ oldMemoryId: 'm-old', recipientPersonIds: ['milad', 'parastoo'] });
  expect(milad.at).toBeInstanceOf(Date);
  expect(await store.listFor('aria', 'sina')).toEqual([]);
  await expect(store.record({ ...base, recipientPersonIds: [], at: new Date() })).rejects.toThrow();
  await expect(store.record({ ...base, recipientPersonIds: ['x y'], at: new Date() })).rejects.toThrow();
  await expect(store.record({ ...base, recipientPersonIds: ['x'], at: new Date(), content: CANARY } as never)).rejects.toThrow();
}

describe('SupersededNoticeStore implementations', () => {
  it('in memory', async () => {
    const store = new InMemorySupersededNoticeStore();
    await exerciseNotices(store);
    expect(JSON.stringify(store.notices)).not.toContain(CANARY);
  });

  it('listFor returns at most 200, newest first', async () => {
    const store = new InMemorySupersededNoticeStore();
    for (let i = 0; i < 210; i++) await store.record({ personaId: 'aria', oldMemoryId: `o${i}`, newMemoryId: `n${i}`, ownerPersonId: 'reza', recipientPersonIds: ['milad'], at: new Date(NOW.getTime() + i) });
    const list = await store.listFor('aria', 'milad');
    expect(list).toHaveLength(200);
    expect(list[0].oldMemoryId).toBe('o209');
  });

  it('file: JSON array, mode 0o600, survives a new instance, capped at 5000 rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vox-notices-'));
    const path = join(dir, 'supersede-notices.json');
    await exerciseNotices(createFileSupersededNoticeStore(path));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(await createFileSupersededNoticeStore(path).listFor('aria', 'parastoo')).toHaveLength(2);
    expect(readFileSync(path, 'utf8')).not.toContain(CANARY);

    const capped = join(dir, 'capped.json');
    const seed = Array.from({ length: 5000 }, (_, i) => ({ id: `id-${i}`, personaId: 'aria', oldMemoryId: `o${i}`, newMemoryId: `n${i}`, ownerPersonId: 'reza', recipientPersonIds: ['milad'], at: new Date(NOW.getTime() + i).toISOString() }));
    appendFileSync(capped, JSON.stringify(seed));
    await createFileSupersededNoticeStore(capped).record({ personaId: 'aria', oldMemoryId: 'newest', newMemoryId: 'n', ownerPersonId: 'reza', recipientPersonIds: ['milad'], at: new Date(NOW.getTime() + 10_000) });
    const stored = JSON.parse(readFileSync(capped, 'utf8')) as Array<{ oldMemoryId: string }>;
    expect(stored).toHaveLength(5000);
    expect(stored.some((n) => n.oldMemoryId === 'o0')).toBe(false);
    expect(stored.at(-1)!.oldMemoryId).toBe('newest');
  });

  it('firestore: one tireh_supersede_notices doc per recipient, two equality filters', async () => {
    const { db, data, queries } = fakeFirestore();
    await exerciseNotices(new FirestoreSupersededNoticeStore(db));
    expect([...data.keys()].every((key) => key.startsWith('tireh_supersede_notices/'))).toBe(true);
    // Three notices: two recipients, one, one.
    expect(data.size).toBe(4);
    expect([...data.keys()].every((key) => /__[0-9a-f]{16}$/.test(key))).toBe(true);
    const listQuery = queries.find((q) => q.path === 'tireh_supersede_notices')!;
    expect(listQuery.filters.map(([field, op]) => `${field}${op}`)).toEqual(['personaId==', 'recipientPersonId==']);
    expect(listQuery.order).toBeUndefined();
  });
});
