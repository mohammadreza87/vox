/**
 * QA round 2, lens code-quality (wave A on main): successor inheritance error
 * handling. Known gap pinned as `it.fails`: the case asserts the intended
 * behaviour and is expected to fail until the fix lands; then `it.fails`
 * must become `it`.
 *
 *  - CQ2-5: main's S08 lineage caught a failed tombstone carry, skipped the
 *    inheritance (fail closed) and wrote a 'memory.inherit' admin audit row.
 *    Wave A's inheritMemories (chosen on the merge) lets the error escape
 *    onManagedBot after the agent was already stored as active, so the bot
 *    profile is never configured and the creator is never told the agent is
 *    alive; a Telegram retry is then a token refresh and never inherits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { personId } from '../org-bridge';
import { InMemoryMemoryStore } from '../../tireh/memory/store';
import { hire, ID, makeStudio, seedOrg, T0 } from './helpers';

vi.setConfig({ testTimeout: 60_000 });
const firebase = vi.hoisted(() => ({ getAdminApp: vi.fn(), getAdminDb: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminApp: firebase.getAdminApp, getAdminDb: firebase.getAdminDb }));

afterEach(() => { vi.unstubAllEnvs(); });

/** A store whose S06 tombstone read fails (a transient Firestore error). */
class FailingTombstoneStore extends InMemoryMemoryStore {
  async tombstonesOf(): Promise<string[]> { throw Object.assign(new Error('unavailable'), { code: 14 }); }
  async addTombstones(): Promise<void> { /* unused */ }
}

describe('CQ2-5: a failed tombstone carry never breaks the successor hire', () => {
  it.fails('TIREH_SHARING_V2=1: the hire completes, nothing is inherited and an admin audit row says why', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '1');
    const store = new FailingTombstoneStore();
    const h = makeStudio({ adaptive: false });
    const org = await seedOrg(h);
    h.studio.deps.memory = { ...h.studio.deps.memory, memories: store };
    const { agent: old } = await hire(h, org.alice);
    await store.add({ personaId: old.id, content: 'GROUP_FACT', topic: 't', type: 'fact', sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
      scope: { kind: 'group', groupId: 'chat-1' }, authorizedPersonIds: [personId(ID.alice)],
      source: { personId: personId(ID.alice), chatKind: 'private', at: T0, eventIds: ['ev-cq2-5'] } });
    await h.studio.fire(org.admin, old.id, { reason: 'reset', memoryPolicy: 'transfer', confirmName: 'Nova' });
    const { agent: next } = await hire(h, org.alice, { name: 'Nova Two' }, old.id);
    expect(next.status).toBe('active');
    expect(await store.listActive(next.id)).toEqual([]);
    expect((await h.store.read()).audit.some((row) => row.action === 'memory.inherit' && row.target === next.id)).toBe(true);
  });
});
