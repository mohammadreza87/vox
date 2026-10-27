import { afterEach, expect, it, vi } from 'vitest';
import { resetFileRuntimeIoHooks, setFileRuntimeIoHooks } from '@/test/fro1-io-fixture';
vi.mock('@/lib/studio/file-runtime-owner', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/studio/file-runtime-owner')>();
  const { instrumentFileRuntime } = await import('@/test/fro1-io-fixture');
  return instrumentFileRuntime(actual);
});
import { randomUUID } from 'node:crypto';
import { learningFixture } from './fixtures';
import { ID } from '../../../studio/__tests__/helpers';
import { NOW } from '../__tests__/fixtures';
const fixtures: Awaited<ReturnType<typeof learningFixture>>[] = [];
async function setup() { const f = await learningFixture(); fixtures.push(f); await f.enable(); return f; }
afterEach(async () => { vi.restoreAllMocks(); resetFileRuntimeIoHooks(); await Promise.all(fixtures.splice(0).map(f => f.close())); });
async function pending(x: Awaited<ReturnType<typeof setup>>) {
  const original = x.provider.evaluate.getMockImplementation()!;
  let release!: () => void, signal!: AbortSignal;
  x.provider.evaluate.mockImplementationOnce(async (...args) => { signal = args[1]; await new Promise<void>(r => { release = r; }); return original(...args); });
  expect(x.enqueue()).toBe(true); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  return { release: () => release(), signal: () => signal };
}
it('reset then Undo suppresses the registered pending source and a late provider cannot recreate it', async () => {
  const x = await setup(), p = await pending(x);
  const reset = await x.f.save({ key: 'response_length', value: 'brief' }, 'reset');
  expect(p.signal().aborted).toBe(true);
  const state = await x.f.state();
  await x.experience.undoPreference(ID.alice, { ...x.scope, expectedRevision: state.revision, eventId: randomUUID(), changeId: reset.input.eventId });
  p.release(); await x.learning.tasks.settle(); expect((await x.view()).candidates).toEqual([]);
  expect((await x.experience.readPreferences(ID.alice, 'work', x.agent.id)).settings).toEqual([]);
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferenceLearning!.suppressions.length)).toBe(1);
});
it.each(['scope', 'permission', 'grant', 'clear', 'block', 'shutdown'] as const)('cancels owned pending work on %s without a late candidate', async cause => {
  const x = await setup(), p = await pending(x);
  if (cause === 'scope') x.learning.tasks.cancel(ID.alice, 'work', x.agent.id);
  if (cause === 'permission') {
    const s = await x.f.adaptive.read(ID.alice, 'work'); await x.f.adaptive.changeConsent(ID.alice, { space: 'work', purpose: 'optional.personalization', state: 'withdrawn', expectedRevision: s.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: randomUUID() });
  }
  if (cause === 'grant') await x.f.agent(false);
  if (cause === 'clear') await x.f.adaptive.withAccountDocument(ID.alice, d => { delete d.binding; d.revision++; });
  if (cause === 'block') await x.h.studio.blockByAgent(x.agent.id, ID.alice);
  if (cause === 'shutdown') { const stopping = x.learning.tasks.close(); p.release(); await stopping; }
  expect(p.signal().aborted).toBe(true); p.release(); await x.learning.tasks.settle();
  if (cause !== 'block') expect((await x.view()).candidates).toEqual([]);
  else expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferenceLearning!.candidates)).toEqual([]);
});
it('a true request abort releases its source; normal un-aborted completion permits the candidate', async () => {
  const x = await setup(), original = x.provider.evaluate.getMockImplementation()!, controller = new AbortController();
  let release!: () => void; x.provider.evaluate.mockImplementationOnce(async (...args) => { await new Promise<void>(r => { release = r; }); return original(...args); });
  expect(x.enqueue('Please use brief replies.', x.turn(), controller.signal)).toBe(true);
  await vi.waitFor(() => expect(release).toBeTypeOf('function')); controller.abort(); release(); await x.learning.tasks.settle();
  expect((await x.view()).candidates).toEqual([]); x.enqueue(); await x.learning.tasks.settle(); expect((await x.view()).candidates).toHaveLength(1);
});
it.each(['binding', 'permission', 'intent', 'capability'] as const)('denies candidate transport/projection and Use when final Studio I/O crosses %s deadline', async kind => {
  const x = await setup(); x.enqueue(); await x.learning.tasks.settle(); const view = await x.view(), candidate = view.candidates[0];
  const deadline = NOW + 60_000;
  await x.f.adaptive.withAccountDocument(ID.alice, d => {
    if (kind === 'binding') d.binding!.expiresAt = deadline;
    if (kind === 'permission') d.permissions.find(p => p.id === 'permission:work:optional.personalization')!.expiresAt = deadline;
    if (kind === 'intent') { d.experience.preferenceLearning!.intents[0].expiresAt = deadline; d.experience.preferenceLearning!.candidates[0].expiresAt = deadline; }
  });
  if (kind === 'capability') x.f.expirePersonalizationAt(deadline);
  x.setNow(deadline - 1);
  const before = await x.view(), read = x.h.store.readCommittedForEffect.bind(x.h.store);
  vi.spyOn(x.h.store, 'readCommittedForEffect').mockImplementation(() => { const result = read(); x.setNow(deadline + 1); return result; });
  expect(() => x.learning.revalidateViewNow(ID.alice, before)).toThrow();
  await expect(x.learning.review(ID.alice, { ...x.scope, expectedRevision: before.revision, eventId: randomUUID(), candidateId: candidate.id, action: 'use' })).rejects.toBeDefined();
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferences)).toEqual([]);
});
it('rechecks the clock after final synchronous Studio snapshot immediately before candidate rename', async () => {
  const x = await setup(), deadline = NOW + 60_000;
  // Shorten BEFORE enqueue, otherwise the canonical invalidator would cancel
  // the producer and the test would never reach its final candidate write.
  await x.f.adaptive.withAccountDocument(ID.alice, d => { d.experience.preferenceLearning!.intents[0].expiresAt = deadline; });
  x.setNow(deadline - 1); const p = await pending(x);
  expect(p.signal().aborted).toBe(false);
  const read = x.h.store.readCommittedForEffect.bind(x.h.store); let armed = false, crossed = false;
  setFileRuntimeIoHooks({ afterTemporarySync: () => { armed = true; } });
  vi.spyOn(x.h.store, 'readCommittedForEffect').mockImplementation(() => {
    const result = read();
    if (armed && !crossed) { expect(p.signal().aborted).toBe(false); crossed = true; x.setNow(deadline + 1); }
    return result;
  });
  p.release(); await x.learning.tasks.settle(); expect(crossed).toBe(true);
  expect(x.provider.evaluate).toHaveBeenCalledOnce();
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferenceLearning?.candidates ?? [])).toEqual([]);
});
it('scope separation, conflicting event IDs and stale CAS never change a preference', async () => {
  const x = await setup(); x.enqueue(); await x.learning.tasks.settle(); const view = await x.view(), candidateId = view.candidates[0].id;
  const command = { ...await x.command(), candidateId, action: 'dismiss' as const };
  await expect(x.learning.review(ID.alice, { ...command, space: 'personal' })).rejects.toBeDefined();
  await expect(x.learning.review(ID.alice, { ...command, agentId: 'another-agent' })).rejects.toBeDefined();
  await expect(x.learning.review(ID.alice, { ...command, expectedRevision: 1 })).rejects.toMatchObject({ code: 'revision_conflict' });
  await x.learning.review(ID.alice, command);
  await expect(x.learning.review(ID.alice, { ...command, action: 'use' })).rejects.toMatchObject({ code: 'event_conflict' });
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferences)).toEqual([]);
});
it('the real FILE final-rename fence denies a Studio block during asynchronous temporary-file fsync', async () => {
  const x = await setup(); x.enqueue(); await x.learning.tasks.settle(); const view = await x.view();
  let synced = false;
  setFileRuntimeIoHooks({ afterTemporarySync: async () => {
    if (synced) return; synced = true;
    await x.h.store.update(s => { s.agents.find(a => a.id === x.agent.id)!.blocked = [ID.alice]; });
  } });
  await expect(x.learning.review(ID.alice, { ...x.scope, expectedRevision: view.revision, eventId: randomUUID(), candidateId: view.candidates[0].id, action: 'use' })).rejects.toBeDefined();
  expect(synced).toBe(true);
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferences)).toEqual([]);
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferenceLearning!.candidates)).toEqual([]);
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferenceLearning!.suppressions.length)).toBeGreaterThan(0);
});
