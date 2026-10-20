import { it, expect } from 'vitest';
import { InMemoryRelationshipStore, RelationshipLoop } from '../../relationships';
import type { RelationshipKey, RelationshipState } from '../../relationships';
import { hire, ID, makeStudio, seedOrg } from './helpers';

it('suppresses delivery when stop completes between the durable fence and transport', async () => {
  // Legacy relationship loop: adaptive runtimes refuse unscoped relationship state.
  const h = makeStudio({ adaptive: false }); const people = await seedOrg(h); const hired = await hire(h, people.alice);
  const key: RelationshipKey = { personaId: hired.agent.id, chatKey: `private-tg-${ID.alice}`, audience: { kind: 'private', personId: `tg-${ID.alice}` } };
  let stopCompleted = false;
  class InterleavingStore extends InMemoryRelationshipStore {
    override async update<T>(k: RelationshipKey, fn: (s: RelationshipState) => T): Promise<T> {
      const result = await super.update(k, fn);
      if (!stopCompleted && (await this.read(k)).intentions.some(j => j.status === 'sending')) {
        stopCompleted = true;
        await loop.control(key, 'stop');
      }
      return result;
    }
  }
  const store = new InterleavingStore();
  const loop = new RelationshipLoop({ store, mode: 'live', now: () => h.clock.now, assessor: { assess: async () => ({ timeZone: 'UTC', followUp: { topic: 'boss', purpose: 'ask about boss', timing: { kind: 'ongoing', evidenceQuote: 'Work is stressful' }, dueAt: new Date(h.clock.now.getTime() + 86400000).toISOString() } }) }, decisions: { choose: async () => 'send' } });
  h.studio.deps.relationships = loop;
  h.studio.deps.relationshipConfig = { mode: 'live', agentIds: [hired.agent.id], personIds: [`tg-${ID.alice}`] };
  await loop.observeTurn({ ...key, eventId: `telegram:${ID.alice}:1`, text: 'Work is stressful', speakerId: `tg-${ID.alice}`, source: 'telegram' });
  h.advanceDays(1); hired.bot().sendMessage.mockClear();
  const result = await h.studio.drainRelationships();
  expect(stopCompleted).toBe(true);
  expect((await loop.status(key)).disabled).toBe(true);
  expect(result.sent).toBe(0);
  expect(hired.bot().sendMessage).not.toHaveBeenCalled();
});
