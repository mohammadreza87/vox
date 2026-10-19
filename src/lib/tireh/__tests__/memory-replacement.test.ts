import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileStores } from '../memory/file-store';
import { InMemoryMemoryStore, type MemoryStore, type NewMemory } from '../memory/store';
import { makeGateway } from './fixtures';

const memory: NewMemory = { personaId: 'aria', content: 'Launch in February', type: 'fact',
  scope: { kind: 'private', personId: 'reza' }, sensitivity: 'normal', topic: 'launch',
  source: { personId: 'reza', chatKind: 'private', at: new Date('2026-10-19'), eventIds: ['original-source'] },
  aboutPersonIds: [], confidence: .9 };
const corrected = (id: string): NewMemory => ({ ...memory, content: 'Launch in March', supersedes: id,
  source: { ...memory.source, eventIds: ['corrected-source'] } });
const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('revocation after a correction commits cannot leave the old and replacement memories active', async () => {
  const h = makeGateway();
  const old = await h.memories.add(memory);
  for await (const part of h.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'Launch moved to March.' }])) { void part; }
  h.llm.nextExtraction = { memories: [{ content: 'Launch in March', type: 'fact', kind: 'personal', topic: 'launch' }] };
  let allowed = true;
  const add = h.memories.add.bind(h.memories);
  vi.spyOn(h.memories, 'add').mockImplementation(async (...args) => { const row = await add(...args); allowed = false; return row; });
  await h.gateway.reflect('aria', 'reza', { authorize: async () => allowed });
  const active = await h.memories.listActive('aria');
  expect(active.map(row => row.content)).toEqual(['Launch in March']);
  expect((await h.memories.get(old.id))?.supersededBy).toBe(active[0].id);
  expect(active[0].supersedes).toBe(old.id);
  expect(h.bot.sent).toEqual([]);
});

it('invalidation between gateway preparation and the store commit leaves the predecessor unchanged', async () => {
  const h = makeGateway(); const old = await h.memories.add(memory);
  for await (const part of h.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'Launch moved to March.' }])) { void part; }
  h.llm.nextExtraction = { memories: [{ content: 'Launch in March', type: 'fact', kind: 'personal', topic: 'launch' }] };
  const add = h.memories.add.bind(h.memories);
  vi.spyOn(h.memories, 'add').mockImplementation(async (...args) => { await h.memories.invalidate('aria'); return add(...args); });
  await h.gateway.reflect('aria', 'reza', { authorize: async () => true });
  expect((await h.memories.listActive('aria')).map(row => row.id)).toEqual([old.id]);
  expect((await h.memories.get(old.id))?.supersededBy).toBeUndefined(); expect(h.bot.sent).toEqual([]);
});

for (const adapter of ['memory', 'file'] as const) {
  function setup(): { first: MemoryStore; second: MemoryStore } {
    if (adapter === 'memory') { const store = new InMemoryMemoryStore(); return { first: store, second: store }; }
    const dir = mkdtempSync(join(tmpdir(), 'vox-atomic-replace-')); directories.push(dir);
    const file = join(dir, 'memories.json');
    return { first: createFileStores(file).memories, second: createFileStores(file).memories };
  }
  it(`${adapter}: atomically replaces the active predecessor and invalidates old sharing/version guards`, async () => {
    const { first, second } = setup(); const old = await first.add(memory);
    const revision = await first.safetyRevision('aria');
    const next = await first.add(corrected(old.id), { expectedRevision: revision });
    expect((await second.listActive('aria')).map(row => row.id)).toEqual([next.id]);
    expect(await second.get(old.id)).toMatchObject({ supersededBy: next.id, shareVersion: 1 });
    expect(await second.safetyRevision('aria')).toBe(revision + 1);
    expect(await second.updateIfShareVersion(old.id, 0, { scope: { kind: 'org' } })).toBe(false);
    await expect(second.add(corrected(old.id), { expectedRevision: revision })).rejects.toThrow('Memory context was invalidated');
    expect((await second.listActive('aria')).map(row => row.id)).toEqual([next.id]);
  });
  it(`${adapter}: competing corrections have one winner and no orphan replacement`, async () => {
    const { first, second } = setup(); const old = await first.add(memory); const revision = await first.safetyRevision('aria');
    const outcomes = await Promise.allSettled([first.add(corrected(old.id), { expectedRevision: revision }), second.add({ ...corrected(old.id), content: 'Launch in April' }, { expectedRevision: revision })]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const active = await first.listActive('aria'); expect(active).toHaveLength(1);
    expect((await first.get(old.id))?.supersededBy).toBe(active[0].id);
  });
  it(`${adapter}: deleted or foreign predecessors reject without inserting a correction`, async () => {
    const { first } = setup(); const old = await first.add(memory); await first.delete(old.id);
    await expect(first.add(corrected(old.id))).rejects.toThrow('Memory context was invalidated');
    const other = await first.add({ ...memory, personaId: 'other', source: { ...memory.source, eventIds: ['other'] } });
    await expect(first.add(corrected(other.id))).rejects.toThrow('Memory context was invalidated');
    expect(await first.listActive('aria')).toEqual([]);
    expect((await first.listActive('other')).map(row => row.id)).toEqual([other.id]);
  });
  it(`${adapter}: epoch-guarded correction is atomic, and forgetting still purges the entire supersession chain`, async () => {
    const { first, second } = setup(); const old = await first.add(memory);
    expect(await first.addIfEpoch(corrected(old.id), 1)).toBeNull();
    expect((await second.listActive('aria')).map(row => row.id)).toEqual([old.id]);
    const next = await first.addIfEpoch(corrected(old.id), 0);
    expect((await second.listActive('aria')).map(row => row.id)).toEqual([next!.id]);
    expect((await second.get(old.id))?.supersededBy).toBe(next!.id);
    await second.delete(next!.id);
    expect(await first.get(old.id)).toBeNull(); expect(await first.listActive('aria')).toEqual([]);
    await expect(first.add(corrected(old.id))).rejects.toThrow('Memory context was invalidated');
  });
}
