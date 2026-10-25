/**
 * QA r3 (code quality, wave A on main): MemoryStore.delete(id) removes the
 * whole forget closure (the superseded predecessors and every record sharing a
 * source event), but both notice-erasing paths (auditMemoryStore and
 * noticeErasingMemoryStore) erase only the notices naming the requested id. A
 * supersede notice between two predecessors in the closure survives the
 * erasure, with its owner and recipient person ids. Pinned as a known gap with
 * it.fails; the fix erases notices for every forgotten id.
 */
import { describe, expect, it } from 'vitest';
import { InMemorySupersededNoticeStore, noticeErasingMemoryStore } from '../audit';
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
  it.fails('deleting the newest record erases the notices of every record its closure removes', async () => {
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
});
