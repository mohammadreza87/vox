import { afterEach, expect, it } from 'vitest';
import { learningFixture } from './fixtures';
import { ID } from '../../../studio/__tests__/helpers';
import { randomUUID } from 'node:crypto';
const fixtures: Awaited<ReturnType<typeof learningFixture>>[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.close())); });
it.each(['block', 'access', 'visibility', 'role'] as const)('%s revoke/restore cannot revive a prior learning intent or candidate; pruning preserves opaque suppression', async kind => {
  const x = await learningFixture(); fixtures.push(x); await x.enable(); x.enqueue(); await x.learning.tasks.settle();
  const view = await x.view(), candidate = view.candidates[0], state = await x.h.store.read(), actor = state.members.find(m => m.telegramId === ID.alice)!, owner = state.members.find(m => m.role === 'owner')!;
  if (kind === 'block') { await x.h.studio.blockByAgent(x.agent.id, ID.alice); await x.h.studio.unblock(owner, x.agent.id, ID.alice); }
  if (kind === 'access') { await x.h.studio.setAccess(owner, x.agent.id, []); await x.h.studio.setAccess(owner, x.agent.id, x.agent.access); }
  if (kind === 'visibility') { await x.h.studio.setVisibility(owner, x.agent.id, 'private'); await x.h.studio.setVisibility(owner, x.agent.id, 'org'); }
  if (kind === 'role') { await x.h.studio.setRole(owner, ID.alice, 'pending'); await x.h.studio.setRole(owner, ID.alice, actor.role); }
  expect(() => x.learning.revalidateViewNow(ID.alice, view)).toThrow(); expect(x.enqueue()).toBe(false);
  await expect(x.learning.review(ID.alice, { ...x.scope, expectedRevision: view.revision, eventId: randomUUID(), candidateId: candidate.id, action: 'use' })).rejects.toBeDefined();
  const current = await x.view(); expect(current.enabled).toBe(false); expect(current.candidates).toEqual([]);
  const learning = await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferenceLearning!); expect(learning.intents).toEqual([]); expect(learning.suppressions.length).toBeGreaterThan(0);
});
it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1] as const)('malformed authority revision %s fails closed without exports', async revision => {
  const x = await learningFixture(); fixtures.push(x); await x.enable(); await x.h.store.update(s => { s.agents.find(a => a.id === x.agent.id)!.learningAuthorityRevision = revision; });
  expect(x.enqueue()).toBe(false); expect((await x.view()).enabled).toBe(false); expect(x.provider.evaluate).not.toHaveBeenCalled();
});
it('revision overflow aborts the same Studio authority mutation and cannot silently wrap to legacy zero', async () => {
  const x = await learningFixture(); fixtures.push(x); await x.h.store.update(s => { s.agents.find(a => a.id === x.agent.id)!.learningAuthorityRevision = Number.MAX_SAFE_INTEGER; });
  await expect(x.h.studio.blockByAgent(x.agent.id, ID.alice)).rejects.toBeDefined();
  const agent = (await x.h.store.read()).agents.find(a => a.id === x.agent.id)!; expect(agent.learningAuthorityRevision).toBe(Number.MAX_SAFE_INTEGER); expect(agent.blocked ?? []).toEqual([]);
});
