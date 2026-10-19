import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreRelationshipStore, InMemoryRelationshipStore } from '..';
import type { RelationshipKey, RelationshipStore } from '..';
const key: RelationshipKey = { personaId: 'aria', chatKey: 'private-a', audience: { kind: 'private', personId: 'a' } };
/** This verifies adapter contracts/atomic commits, not production Firestore availability. */
function fakeFirestore() {
  const rows = new Map<string, Record<string, unknown>>(); let queue = Promise.resolve(); let fail = false;
  const snap = (path: string) => ({ exists: rows.has(path), get: (field: string) => rows.get(path)?.[field], data: () => rows.get(path) });
  const ref = (path: string) => ({ path, get: async () => snap(path) });
  function collection(name: string, filters: Array<[string, string, unknown]> = [], order = '', max = 1000) {
    return { doc: (id: string) => ref(`${name}/${id}`), where: (f: string, op: string, value: unknown) => collection(name, [...filters, [f, op, value]], order, max),
      orderBy: (f: string) => collection(name, filters, f, max), limit: (n: number) => collection(name, filters, order, n),
      get: async () => ({ docs: [...rows.entries()].filter(([p, row]) => p.startsWith(`${name}/`) && filters.every(([f, op, v]) => op === '==' ? row[f] === v : typeof row[f] === typeof v && (op === '>' ? (row[f] as string) > (v as string) : (row[f] as string) <= (v as string)))).sort(([,a], [,b]) => String(a[order]).localeCompare(String(b[order]))).slice(0, max).map(([p]) => snap(p)) }) };
  }
  const db = { collection, runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => {
    const task = queue.then(async () => { const writes = new Map<string, Record<string, unknown>>();
      const result = await fn({ get: async (r: { path: string }) => snap(r.path), set: (r: { path: string }, value: Record<string, unknown>) => writes.set(r.path, structuredClone(value)) });
      if (fail) { fail = false; throw new Error('Commit failed'); } for (const [p, v] of writes) rows.set(p, v); return result;
    }); queue = task.then(() => undefined, () => undefined); return task;
  } } as unknown as Firestore;
  return { db, rows, fail: () => { fail = true; } };
}
for (const kind of ['memory', 'firestore'] as const) describe(`${kind} relationship store contract`, () => {
  const create = (): RelationshipStore => kind === 'memory' ? new InMemoryRelationshipStore() : new FirestoreRelationshipStore(fakeFirestore().db);
  it('serializes concurrent updates and aborts mutations when a callback throws', async () => {
    const store = create(); await Promise.all(Array.from({ length: 30 }, () => store.update(key, (s) => { s.revision++; })));
    expect((await store.read(key)).revision).toBe(30);
    await expect(store.update(key, (s) => { s.revision = 999; throw new Error('Abort'); })).rejects.toThrow('Abort'); expect((await store.read(key)).revision).toBe(30);
  });
  it('purges prior epoch content while preserving explicit stop settings', async () => {
    const store = create(); await store.update(key, (s) => { s.disabled = true; s.preferences.push({ key: 'private', value: 'secret', sourceId: 'event', updatedAt: '2026-10-19T12:00:00Z' }); });
    await store.bumpEpoch(key.personaId); const fresh = await store.read(key); expect(fresh.disabled).toBe(true); expect(fresh.preferences).toEqual([]); expect(fresh.epoch).toBe(1);
  });
  it('queries only due active jobs with bounded results', async () => {
    const store = create(); await store.update(key, (s) => { s.intentions.push({ id: 'job', key, topic: 'topic', purpose: 'follow up', sourceIds: ['event'], status: 'pending', dueAt: '2026-10-19T13:00:00.000Z', expiresAt: '2026-10-20T13:00:00.000Z', revision: 0, attempts: 0 }); });
    expect(await store.due(new Date('2026-10-19T12:00:00Z'), 5)).toEqual([]); expect(await store.due(new Date('2026-10-19T14:00:00Z'), 5)).toEqual([key]);
    await store.update(key, (s) => { s.intentions[0].status = 'closed'; }); expect(await store.due(new Date('2026-10-19T14:00:00Z'), 5)).toEqual([]);
  });
  it('finds all scoped account records including orphaned personas, excluding legacy and other accounts', async () => {
    const store = create();
    const scoped = (accountId: string, space: 'work' | 'personal', personaId: string): RelationshipKey => ({ ...key, personaId,
      scope: { schemaVersion: 1, accountId, personId: 'a', bindingId: 'binding', tenantId: 'tenant', space, spaceId: space, containerId: `container-${space}` } });
    const personal = scoped('telegram-account:300', 'personal', 'removed-agent');
    const work = scoped('telegram-account:300', 'work', 'other-agent');
    for (const target of [key, personal, work, scoped('telegram-account:301', 'personal', 'removed-agent')]) await store.update(target, () => undefined);
    expect(await store.keysForAccount('telegram-account:300')).toEqual(expect.arrayContaining([personal, work]));
    expect(await store.keysForAccount('telegram-account:300')).toHaveLength(2);
    expect(await store.keysForAccount('telegram-account:999')).toEqual([]);
  });
});
it('shares Firestore epochs across independent adapter instances and preserves failed commits', async () => {
  const fake = fakeFirestore(); const a = new FirestoreRelationshipStore(fake.db); const b = new FirestoreRelationshipStore(fake.db);
  await a.update(key, (s) => { s.revision = 5; }); fake.fail(); await expect(b.update(key, (s) => { s.revision = 100; })).rejects.toThrow('Commit failed'); expect((await a.read(key)).revision).toBe(5);
  await b.bumpEpoch(key.personaId); expect((await a.read(key)).epoch).toBe(1);
});

it('Firestore private data expires without resetting durable stop and quiet-hour controls', async () => {
  const fake = fakeFirestore(); let now = new Date('2026-10-19T12:00:00Z');
  const store = new FirestoreRelationshipStore(fake.db, 'retention-test', () => now);
  await store.update(key, (s) => { s.disabled = true; s.timeZone = 'Europe/Tallinn'; s.unansweredCount = 1; s.preferences.push({ key: 'secret', value: 'private fact', sourceId: 'event', updatedAt: now.toISOString() }); });
  const dataRow = [...fake.rows.values()].find((r) => 'expiresAt' in r)!; expect(dataRow.expiresAt).toBeInstanceOf(Date);
  now = new Date(now.getTime() + 91 * 86400_000);
  const restored = await store.read(key); expect(restored.preferences).toEqual([]); expect(restored.disabled).toBe(true); expect(restored.timeZone).toBe('Europe/Tallinn'); expect(restored.unansweredCount).toBe(1);
  for (const [path] of fake.rows) if (path.startsWith('retention-test/')) fake.rows.delete(path);
  const afterTtlDeletion = await store.read(key); expect(afterTtlDeletion.disabled).toBe(true); expect(afterTtlDeletion.preferences).toEqual([]);
});
