/**
 * QA r3 (code quality, wave A on main): MemoryStore.delete(id) removes the
 * whole forget closure (the superseded predecessors and every record sharing a
 * source event), but both notice-erasing paths (auditMemoryStore and
 * noticeErasingMemoryStore) erased only the notices naming the requested id. A
 * supersede notice between two predecessors in the closure survived the
 * erasure, with its owner and recipient person ids. Fixed in fixer r3:
 * MemoryStore.delete resolves to the ids it removed and both decorators erase
 * the notices naming any of them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditMemoryStore, InMemoryAuditStore, InMemorySupersededNoticeStore, noticeErasingMemoryStore } from '../audit';
import { InMemoryMemoryStore, type NewMemory } from '../memory/store';

let seq = 0;
function newMemory(overrides: Partial<NewMemory> = {}): NewMemory {
  return {
    personaId: 'aria', content: 'Reza prefers mornings', topic: 'schedule', type: 'fact',
    scope: { kind: 'people', personIds: ['milad', 'reza'] }, authorizedPersonIds: ['milad', 'reza'],
    sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    source: { personId: 'reza', chatKind: 'private', at: new Date('2026-10-19T10:00:00Z'), eventIds: [`ev-closure-${++seq}`] },
    ...overrides,
  };
}

describe('supersede notices and the forget closure (QA r3)', () => {
  it('deleting the newest record erases the notices of every record its closure removes', async () => {
    const inner = new InMemoryMemoryStore();
    const notices = new InMemorySupersededNoticeStore();
    const memories = noticeErasingMemoryStore(inner, notices);
    const first = await inner.add(newMemory());
    const second = await inner.add(newMemory({ supersedes: first.id }));
    const third = await inner.add(newMemory({ supersedes: second.id }));
    const at = new Date('2026-10-20T10:00:00Z');
    await notices.record({ personaId: 'aria', oldMemoryId: first.id, newMemoryId: second.id, ownerPersonId: 'reza', recipientPersonIds: ['milad'], at });
    await notices.record({ personaId: 'aria', oldMemoryId: second.id, newMemoryId: third.id, ownerPersonId: 'reza', recipientPersonIds: ['milad'], at });

    await memories.delete(third.id);

    // The closure took all three records.
    for (const id of [first.id, second.id, third.id]) expect(await inner.get(id)).toBeNull();
    // No notice may still name a forgotten record.
    expect(await notices.listFor('aria', 'milad')).toEqual([]);
  });

  afterEach(() => { vi.unstubAllEnvs(); });

  it.each([
    { auditLog: '1', label: 'with TIREH_AUDIT_LOG on' },
    { auditLog: '', label: 'with TIREH_AUDIT_LOG off' },
  ])('the auditing decorator erases the closure\'s notices too ($label)', async ({ auditLog }) => {
    vi.stubEnv('TIREH_AUDIT_LOG', auditLog);
    const inner = new InMemoryMemoryStore();
    const notices = new InMemorySupersededNoticeStore();
    const memories = auditMemoryStore(inner, new InMemoryAuditStore(), notices);
    const first = await inner.add(newMemory());
    const second = await inner.add(newMemory({ supersedes: first.id }));
    const third = await inner.add(newMemory({ supersedes: second.id }));
    const unrelated = await inner.add(newMemory({ content: 'Milad likes tea' }));
    const after = await inner.add(newMemory({ content: 'Milad likes green tea', supersedes: unrelated.id }));
    const at = new Date('2026-10-20T10:00:00Z');
    await notices.record({ personaId: 'aria', oldMemoryId: first.id, newMemoryId: second.id, ownerPersonId: 'reza', recipientPersonIds: ['milad'], at });
    await notices.record({ personaId: 'aria', oldMemoryId: second.id, newMemoryId: third.id, ownerPersonId: 'reza', recipientPersonIds: ['milad'], at });
    await notices.record({ personaId: 'aria', oldMemoryId: unrelated.id, newMemoryId: after.id, ownerPersonId: 'reza', recipientPersonIds: ['milad'], at });

    expect((await memories.delete(third.id)).sort()).toEqual([first.id, second.id, third.id].sort());

    // No notice names a forgotten record; the unrelated pair's notice is untouched.
    expect(await notices.deleteByMemoryIds([first.id, second.id, third.id])).toBe(0);
    expect(await notices.deleteByMemoryIds([unrelated.id])).toBe(1);
  });
});
