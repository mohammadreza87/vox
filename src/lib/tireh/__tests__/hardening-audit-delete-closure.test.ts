/**
 * Hardening H1 (F174): MemoryStore.delete removes the whole forget closure
 * (the supersession chain and every record sharing a source event). The audit
 * 'delete' row lists every id the store reports removed, in rows of at most
 * MAX_AUDIT_IDS ids; a failed delete keeps the single requested id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditMemoryStore, InMemoryAuditStore, MAX_AUDIT_IDS } from '../audit';
import { InMemoryMemoryStore, type MemoryStore, type NewMemory } from '../memory/store';

let seq = 0;
function newMemory(overrides: Partial<NewMemory> = {}): NewMemory {
  return {
    personaId: 'aria', content: 'Reza prefers mornings', topic: 'schedule', type: 'fact',
    scope: { kind: 'people', personIds: ['milad', 'reza'] }, authorizedPersonIds: ['milad', 'reza'],
    sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    source: { personId: 'reza', chatKind: 'private', at: new Date('2026-10-19T10:00:00Z'), eventIds: [`ev-delete-closure-${++seq}`] },
    ...overrides,
  };
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('audit delete rows cover the forget closure (H1, F174)', () => {
  it('deleting C in an A -> B -> C supersession chain writes one delete row naming A, B and C', async () => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const inner = new InMemoryMemoryStore();
    const audit = new InMemoryAuditStore();
    const store = auditMemoryStore(inner, audit, undefined, { log: { warn: vi.fn() } });
    const a = await inner.add(newMemory());
    const b = await inner.add(newMemory({ supersedes: a.id }));
    const c = await inner.add(newMemory({ supersedes: b.id }));

    const removed = await store.delete(c.id);

    expect([...removed].sort()).toEqual([a.id, b.id, c.id].sort());
    const deletes = audit.rows.filter((row) => row.kind === 'delete');
    expect(deletes).toHaveLength(1);
    expect([...deletes[0].memoryIds].sort()).toEqual([a.id, b.id, c.id].sort());
    // The audience stays the requested record's audience.
    expect(deletes[0]).toMatchObject({ personaId: 'aria', audiencePersonIds: ['milad', 'reza'], outcome: 'applied' });
    expect(deletes[0].actorPersonId).toBeUndefined();
  });

  it('a closure of 201 ids is split into two rows of at most MAX_AUDIT_IDS ids', async () => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const inner = new InMemoryMemoryStore();
    const target = await inner.add(newMemory());
    const cascaded = Array.from({ length: MAX_AUDIT_IDS }, (_, i) => `m-cascade-${String(i).padStart(3, '0')}`);
    const stub = Object.assign(Object.create(inner) as MemoryStore, {
      delete: async (id: string) => { await inner.delete(id); return [id, ...cascaded]; },
    });
    const audit = new InMemoryAuditStore();
    const store = auditMemoryStore(stub, audit, undefined, { log: { warn: vi.fn() } });

    const removed = await store.delete(target.id);

    expect(removed).toHaveLength(MAX_AUDIT_IDS + 1);
    const deletes = audit.rows.filter((row) => row.kind === 'delete');
    expect(deletes).toHaveLength(2);
    for (const row of deletes) expect(row.memoryIds.length).toBeLessThanOrEqual(MAX_AUDIT_IDS);
    expect(new Set(deletes.flatMap((row) => row.memoryIds))).toEqual(new Set([target.id, ...cascaded]));
    expect(deletes.every((row) => row.outcome === 'applied')).toBe(true);
  });

  it('a failed delete keeps the single requested id and rethrows', async () => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const inner = new InMemoryMemoryStore();
    const a = await inner.add(newMemory());
    const b = await inner.add(newMemory({ supersedes: a.id }));
    vi.spyOn(inner, 'delete').mockRejectedValueOnce(new Error('store down'));
    const audit = new InMemoryAuditStore();
    const store = auditMemoryStore(inner, audit, undefined, { log: { warn: vi.fn() } });

    await expect(store.delete(b.id)).rejects.toThrow('store down');

    const deletes = audit.rows.filter((row) => row.kind === 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatchObject({ memoryIds: [b.id], outcome: 'failed' });
  });

  it('a store that reports nothing removed still writes the requested id', async () => {
    vi.stubEnv('TIREH_AUDIT_LOG', '1');
    const inner = new InMemoryMemoryStore();
    const target = await inner.add(newMemory());
    const stub = Object.assign(Object.create(inner) as MemoryStore, {
      delete: async (id: string) => { await inner.delete(id); return undefined as unknown as string[]; },
    });
    const audit = new InMemoryAuditStore();
    await auditMemoryStore(stub, audit, undefined, { log: { warn: vi.fn() } }).delete(target.id);
    expect(audit.rows.filter((row) => row.kind === 'delete').map((row) => row.memoryIds)).toEqual([[target.id]]);
  });
});
