import { describe, expect, it, vi } from 'vitest';
import { RelationshipLoop } from '../loop';
import { InMemoryRelationshipStore } from '../store';
import { InMemoryObservationStore, SafeRelationshipObserver } from '../observer';
import type { Assessment, FeedbackProvider, RelationshipKey, TurnInput } from '../types';

const key: RelationshipKey = { personaId: 'aria', chatKey: 'private-a', audience: { kind: 'private', personId: 'a' } };
function harness() {
  let now = new Date('2026-10-19T12:00:00Z');
  const store = new InMemoryRelationshipStore(); const observations = new InMemoryObservationStore();
  const assess = vi.fn(async ({ text }: { text: string }): Promise<Assessment> => text === 'origin' ? { timeZone: 'UTC',
    situations: [{ topic: 'boss', summary: 'Difficult conversation', status: 'open' }],
    followUp: { topic: 'boss', purpose: 'Ask how the situation is going', dueAt: new Date(now.getTime() + 3600_000).toISOString(), timing: { kind: 'ongoing', evidenceQuote: 'origin' } } } : {});
  const classify = vi.fn<FeedbackProvider['classify']>(async () => ({ outcome: 'neutral', scope: 'message' }));
  const loop = new RelationshipLoop({ store, assessor: { assess }, feedback: { classify }, decisions: { choose: async () => 'send' },
    observer: new SafeRelationshipObserver(observations, 's'.repeat(32), () => now), mode: 'live', now: () => now });
  const turn = (eventId: string, text: string, extra: Partial<TurnInput> = {}) => loop.observeTurn({ ...key, speakerId: 'a', eventId, text, source: 'telegram', at: now, ...extra });
  const deliver = async () => {
    await turn('origin-event', 'origin'); now = new Date(now.getTime() + 3600_000);
    const report = await loop.drain({ authorize: async () => true, loadContext: async () => 'Still unresolved', compose: async () => 'How are things with the conversation?', send: async () => '123' });
    expect(report.sent).toBe(1);
    const state = await loop.status(key); const previousAssistant = { text: 'How are things with the conversation?', at: now, intentionId: state.lastOutreach!.intentionId };
    now = new Date(now.getTime() + 60_000); return { previousAssistant, contextEpoch: state.epoch };
  };
  return { store, observations, assess, classify, loop, turn, deliver };
}

describe('feedback through the integrated relationship turn', () => {
  it('links a confirmed delivered intention to a neutral reply without treating reply rate as helpfulness', async () => {
    const h = harness(); const extra = await h.deliver();
    await h.turn('reply', 'It went well, thanks!', extra);
    expect((await h.loop.status(key)).feedback).toMatchObject([{ outcome: 'neutral', scope: 'message', intentionId: extra.previousAssistant.intentionId, sourceId: 'reply' }]);
    expect((await h.loop.status(key)).preferences).toEqual([]);
    const events = await h.observations.recent();
    expect(events.find((e) => e.type === 'feedback')?.intentionHash).toBe(events.find((e) => e.type === 'sent')?.intentionHash);
  });

  it('applies direct current-user style corrections to the next response context', async () => {
    const h = harness(); const extra = await h.deliver();
    h.assess.mockResolvedValueOnce({ preferences: [{ key: 'advice', value: 'Listen first, keep advice brief' }] });
    h.classify.mockResolvedValueOnce({ outcome: 'correction', scope: 'message' });
    const result = await h.turn('correction', 'That was too much advice; please listen first.', extra);
    expect(result.context).toContain('Listen first, keep advice brief');
    expect(h.assess).toHaveBeenLastCalledWith(expect.objectContaining({ previousAssistant: extra.previousAssistant }));
    expect((await h.loop.status(key)).feedback![0]).toMatchObject({ outcome: 'correction', scope: 'message' });
  });

  it('keeps a topic refusal separate from a global stop, with explicit controls authoritative', async () => {
    const h = harness(); const extra = await h.deliver();
    h.assess.mockResolvedValueOnce({ situations: [{ topic: 'boss', summary: 'Do not discuss this topic', status: 'closed' }] });
    h.classify.mockResolvedValueOnce({ outcome: 'unwanted', scope: 'topic' });
    await h.turn('topic-refusal', 'I would rather discuss something other than my boss.', extra);
    const scoped = await h.loop.status(key); expect(scoped.disabled).toBe(false); expect(scoped.situations[0].status).toBe('closed');
    expect(scoped.feedback![0]).toMatchObject({ outcome: 'unwanted', scope: 'topic' });
    const classifications = h.classify.mock.calls.length;
    await h.turn('stop', 'Stop messaging me', extra);
    expect((await h.loop.status(key)).disabled).toBe(true); expect(h.classify).toHaveBeenCalledTimes(classifications);
  });

  it('skips unrelated latest responses, duplicates and history captured before forget', async () => {
    const h = harness(); const extra = await h.deliver();
    await h.turn('unrelated', 'That helped.', { ...extra, previousAssistant: { ...extra.previousAssistant, intentionId: undefined } });
    expect(h.classify).not.toHaveBeenCalled();
    await h.turn('reply', 'That check-in helped.', extra); expect(h.classify).toHaveBeenCalledTimes(1);
    expect((await h.turn('reply', 'That check-in helped.', extra)).duplicate).toBe(true); expect(h.classify).toHaveBeenCalledTimes(1);
    await h.loop.invalidatePersona(key.personaId, { reason: 'sharing_revoked' });
    await h.turn('after-revoke', 'That check-in helped.', extra);
    expect(h.classify).toHaveBeenCalledTimes(1); expect(h.assess.mock.calls.at(-1)?.[0]).not.toHaveProperty('previousAssistant', extra.previousAssistant);
    expect((await h.loop.status(key)).feedback).toEqual([]);
  });

  it('discards in-flight feedback and adaptation on source forget', async () => {
    const h = harness(); const extra = await h.deliver();
    let resolveFeedback!: (value: Awaited<ReturnType<FeedbackProvider['classify']>>) => void;
    let started!: () => void; const entered = new Promise<void>((resolve) => { started = resolve; });
    h.classify.mockImplementationOnce(() => { started(); return new Promise((resolve) => { resolveFeedback = resolve; }); });
    h.assess.mockResolvedValueOnce({ preferences: [{ key: 'advice', value: 'A stale preference' }] });
    const pending = h.turn('reply', 'That helped.', extra); await entered;
    await h.loop.invalidate(key, { sourceIds: ['origin-event'], reason: 'source_deleted' }); resolveFeedback({ outcome: 'helpful', scope: 'message' }); await pending;
    const state = await h.loop.status(key); expect(state.feedback).toEqual([]); expect(state.preferences).toEqual([]); expect(state.lastOutreach).toBeUndefined();
  });

  it('continues personalization when feedback classification and observer writes fail', async () => {
    const h = harness(); const extra = await h.deliver();
    h.classify.mockRejectedValueOnce(new Error('synthetic provider unavailable'));
    h.assess.mockResolvedValueOnce({ preferences: [{ key: 'detail', value: 'shorter replies' }] });
    const result = await h.turn('reply', 'Please keep that shorter next time.', extra);
    expect(result.context).toContain('shorter replies'); expect((await h.loop.status(key)).feedback).toEqual([]);
    vi.spyOn(h.loop.deps.observer!, 'emitFeedback').mockRejectedValueOnce(new Error('synthetic telemetry failure'));
    h.classify.mockResolvedValueOnce({ outcome: 'helpful', scope: 'message' });
    await expect(h.turn('another-reply', 'That check-in was helpful.', extra)).resolves.toMatchObject({ duplicate: false });
    expect((await h.loop.status(key)).feedback).toMatchObject([{ outcome: 'helpful' }]);
  });
});
