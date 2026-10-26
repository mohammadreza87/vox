/**
 * S08 hardening (F091, F261): memoryNoticesFor filters every listed notice
 * (at most MAX_NOTICE_LIST) before capping the output at 50, and reads each
 * notice's old and replacement records concurrently (chunks of 10) instead of
 * two sequential reads per notice. newMemoryId is returned as before
 * (product decision (e)).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { personId } from '../org-bridge';
import { InMemorySupersededNoticeStore } from '../../tireh/audit';
import type { MemoryStore, NewMemory } from '../../tireh/memory/store';
import type { MemoryRecord, MemoryScope } from '../../tireh/types';
import { hire, ID, makeStudio, memberOf, seedOrg, T0 } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

const CANARY = 'NOTICE_HARDENING_CANARY_3b7';
let seq = 0;

afterEach(() => { vi.unstubAllEnvs(); });

function mem(agentId: string, scope: MemoryScope, authorizedPersonIds: string[]): NewMemory {
  return {
    personaId: agentId, content: `${CANARY} fact`, topic: CANARY, type: 'fact', sensitivity: 'normal', aboutPersonIds: [], confidence: 0.9,
    scope, authorizedPersonIds,
    source: { personId: personId(ID.alice), chatKind: 'private', at: T0, eventIds: [`nt-${++seq}`] },
  };
}

/** A memory store whose get() is slow and counts concurrent reads. */
function counting(store: MemoryStore) {
  const stats = { inFlight: 0, peak: 0, gets: 0 };
  const wrapped = new Proxy(store, {
    get(target, prop) {
      if (prop === 'get') {
        return async (id: string): Promise<MemoryRecord | null> => {
          stats.gets++;
          stats.inFlight++;
          stats.peak = Math.max(stats.peak, stats.inFlight);
          try {
            await new Promise((resolve) => setTimeout(resolve, 2));
            return await target.get(id);
          } finally {
            stats.inFlight--;
          }
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { wrapped, stats };
}

async function setup() {
  const h = makeStudio({ adaptive: false });
  const org = await seedOrg(h);
  const { agent } = await hire(h, org.alice);
  const notices = new InMemorySupersededNoticeStore();
  h.studio.deps.memoryNotices = notices;
  const pair = [personId(ID.alice), personId(ID.bob)].sort();
  const shared = (n: number) => Promise.all(Array.from({ length: n }, () => h.memory.memories.add(mem(agent.id, { kind: 'people', personIds: pair }, pair))));
  const alicePrivate = (n: number) => Promise.all(Array.from({ length: n }, () =>
    h.memory.memories.add(mem(agent.id, { kind: 'private', personId: personId(ID.alice) }, [personId(ID.alice)]))));
  const notice = (oldMemoryId: string, newMemoryId: string, minute: number) => notices.record({
    personaId: agent.id, oldMemoryId, newMemoryId, ownerPersonId: personId(ID.alice), recipientPersonIds: [personId(ID.bob)],
    at: new Date(T0.getTime() + minute * 60_000),
  });
  const { wrapped, stats } = counting(h.memory.memories);
  h.studio.deps.memory = { ...h.studio.deps.memory, memories: wrapped };
  return { h, org, agent, notices, shared, alicePrivate, notice, stats, bob: await memberOf(h, ID.bob) };
}

describe('memoryNoticesFor (TIREH_SHARING_V2=1)', () => {
  beforeEach(() => { vi.stubEnv('TIREH_SHARING_V2', '1'); });

  it('filters before capping: with the 50 newest notices invisible, the 10 visible older ones are returned', async () => {
    const ctx = await setup();
    const visibleOld = await ctx.shared(10);
    const replacements = await ctx.shared(10);
    const hidden = await ctx.alicePrivate(50);
    // Older: 10 notices bob can see (minutes 0..9). Newer: 50 whose old record bob was never a reader of (minutes 100..149).
    for (let i = 0; i < 10; i++) await ctx.notice(visibleOld[i].id, replacements[i].id, i);
    for (let i = 0; i < 50; i++) await ctx.notice(hidden[i].id, hidden[(i + 1) % 50].id, 100 + i);
    // And one notice whose old record is gone.
    await ctx.notice('gone-memory', replacements[0].id, 200);

    const out = await ctx.h.studio.memoryNoticesFor(ctx.bob, ctx.agent.id);
    expect(out).toHaveLength(10);
    // Newest first, exactly the visible ones.
    expect(out.map((n) => n.oldMemoryId)).toEqual(visibleOld.map((m) => m.id).reverse());
    expect(out.map((n) => n.newMemoryId)).toEqual(replacements.map((m) => m.id).reverse());
    expect(out.every((n) => n.replacementVisible && n.from === 'Alice')).toBe(true);
    expect(JSON.stringify(out)).not.toContain(CANARY);
  });

  it('caps the output at 50 after filtering, newest first', async () => {
    const ctx = await setup();
    const olds = await ctx.shared(60);
    const replacement = (await ctx.shared(1))[0];
    for (let i = 0; i < 60; i++) await ctx.notice(olds[i].id, replacement.id, i);
    const out = await ctx.h.studio.memoryNoticesFor(ctx.bob, ctx.agent.id);
    expect(out).toHaveLength(50);
    expect(out.map((n) => n.oldMemoryId)).toEqual(olds.slice(10).map((m) => m.id).reverse());
  });

  it('reads old and replacement records concurrently', async () => {
    const ctx = await setup();
    const olds = await ctx.shared(20);
    const replacements = await ctx.shared(20);
    for (let i = 0; i < 20; i++) await ctx.notice(olds[i].id, replacements[i].id, i);
    ctx.stats.peak = 0; ctx.stats.gets = 0;
    const out = await ctx.h.studio.memoryNoticesFor(ctx.bob, ctx.agent.id);
    expect(out).toHaveLength(20);
    expect(ctx.stats.gets).toBe(40);
    expect(ctx.stats.peak).toBeGreaterThan(1);
    // Bounded: one chunk of 10 notices (two reads each) at a time.
    expect(ctx.stats.peak).toBeLessThanOrEqual(20);
  });

  it('newMemoryId is still returned when the replacement is not visible (decision (e))', async () => {
    const ctx = await setup();
    const [old] = await ctx.shared(1);
    const [correction] = await ctx.alicePrivate(1);
    await ctx.notice(old.id, correction.id, 0);
    expect(await ctx.h.studio.memoryNoticesFor(ctx.bob, ctx.agent.id)).toEqual([
      { id: expect.any(String), oldMemoryId: old.id, newMemoryId: correction.id, from: 'Alice', at: expect.any(String), replacementVisible: false },
    ]);
  });

  it('flag unset: empty and no memory reads', async () => {
    vi.stubEnv('TIREH_SHARING_V2', '');
    const ctx = await setup();
    const [old] = await ctx.shared(1);
    await ctx.notice(old.id, old.id, 0);
    ctx.stats.gets = 0;
    expect(await ctx.h.studio.memoryNoticesFor(ctx.bob, ctx.agent.id)).toEqual([]);
    expect(ctx.stats.gets).toBe(0);
  });
});
