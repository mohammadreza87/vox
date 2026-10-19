import { describe, expect, it, vi } from 'vitest';
import { InMemoryRelationshipStore, RelationshipLoop } from '..';
import type { Assessment, RelationshipKey } from '..';
const key: RelationshipKey = { personaId: 'tireh', chatKey: 'private-asha', audience: { kind: 'private', personId: 'asha' } };
const initial = 'The interview is October 20 from 14:00 to 15:00 UTC.';
function setup() {
  let now = new Date('2026-10-19T12:00:00Z');
  const assess = vi.fn(async (): Promise<Assessment> => ({ timeZone: 'UTC', followUp: { topic: 'interview', purpose: 'Ask about the interview', dueAt: '2026-10-19T13:00:00Z', timing: { kind: 'after_event', evidenceQuote: initial, eventWindow: { startsAt: '2026-10-20T14:00:00Z', endsAt: '2026-10-20T15:00:00Z' } } } }));
  const choose = vi.fn(async () => 'send' as const); const send = vi.fn(async () => 'sent'); const compose = vi.fn(async () => 'How was the interview?');
  const store = new InMemoryRelationshipStore(); const loop = new RelationshipLoop({ store, assessor: { assess }, decisions: { choose }, mode: 'live', now: () => now });
  return { loop, store, assess, choose, compose, send, set: (at: string) => { now = new Date(at); },
    turn: (id = 'one', text = initial) => loop.observeTurn({ ...key, source: 'telegram', speakerId: 'asha', eventId: id, text, at: now }),
    drain: () => loop.drain({ authorize: async () => true, loadContext: async () => 'Authorized interview history', compose, send }) };
}
describe('grounded temporal delivery integration', () => {
  it('waits for the extracted end even if an old due time says reconsider now', async () => {
    const h = setup(); await h.turn();
    expect((await h.loop.status(key)).intentions[0].dueAt).toBe('2026-10-20T15:00:00.000Z');
    await h.store.update(key, s => { s.intentions[0].dueAt = '2026-10-19T13:00:00.000Z'; });
    h.set('2026-10-19T13:00:00Z'); expect((await h.drain()).deferred).toBe(1); expect(h.compose).not.toHaveBeenCalled();
    h.set('2026-10-20T15:00:00Z'); expect((await h.drain()).sent).toBe(1);
    expect(h.choose).toHaveBeenCalledWith(expect.objectContaining({ context: expect.stringContaining('"eventPhase":"after"'), candidate: 'How was the interview?' }));
    expect((await h.loop.status(key)).intentions[0].timing).toBeUndefined();
  });
  it('refreshes an existing purpose on a same-topic reschedule without a replacement follow-up', async () => {
    const h = setup(); await h.turn(); const text = 'It moved to October 21, 14:00 to 16:00 UTC.';
    h.assess.mockResolvedValueOnce({ situations: [{ topic: 'interview', summary: text, status: 'open', timing: { kind: 'preparatory', evidenceQuote: text, eventWindow: { startsAt: '2026-10-21T14:00:00Z', endsAt: '2026-10-21T16:00:00Z' } } }] });
    await h.turn('two', text); h.set('2026-10-20T16:00:00Z'); expect((await h.drain()).claimed).toBe(0);
    const job = (await h.loop.status(key)).intentions[0]; expect(job.timing?.sourceId).toBe('two'); expect(job.timing?.kind).toBe('after_event'); expect(job.sourceIds).toContain('two');
    h.set('2026-10-21T16:00:00Z'); expect((await h.drain()).sent).toBe(1);
  });
  it('does not fabricate an event end or accept a quote absent from the current message', async () => {
    for (const evidenceQuote of [initial, 'NOT IN THE CURRENT MESSAGE']) {
      const h = setup(); h.assess.mockResolvedValueOnce({ timeZone: 'UTC', followUp: { topic: 'interview', purpose: 'Ask how it went', dueAt: '2026-10-19T13:00:00Z', timing: { kind: 'after_event', evidenceQuote } } });
      await h.turn(); h.set('2026-10-19T13:00:00Z'); expect((await h.drain()).deferred).toBe(1);
      expect(h.choose).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    }
  });
  it('honors current busy time for ongoing intentions and retains explicit timing provenance', async () => {
    const h = setup(); const text = 'I am still working through it. Busy until October 19 at 16:00 UTC.';
    h.assess.mockResolvedValueOnce({ timeZone: 'UTC', followUp: { topic: 'work', purpose: 'Ask how things are going', dueAt: '2026-10-19T13:00:00Z', timing: { kind: 'ongoing', evidenceQuote: text, busyUntil: '2026-10-19T16:00:00Z' } } });
    await h.turn('one', text); h.set('2026-10-19T15:00:00Z'); expect((await h.drain()).claimed).toBe(0);
    h.set('2026-10-19T16:00:00Z'); expect((await h.drain()).sent).toBe(1);
    expect(h.choose).toHaveBeenCalledWith(expect.objectContaining({ context: expect.stringContaining('Do not state or imply that a scheduled event has finished') }));
  });
  it('closes a reschedule past expiry instead of retaining a future job indefinitely', async () => {
    const h = setup(); await h.turn(); const text = 'Now next year: October 21 2027, ending at 16:00 UTC.';
    h.assess.mockResolvedValueOnce({ situations: [{ topic: 'interview', summary: text, status: 'open', timing: { kind: 'after_event', evidenceQuote: text, eventWindow: { endsAt: '2027-10-21T16:00:00Z' } } }] });
    await h.turn('two', text); expect((await h.loop.status(key)).intentions[0]).toMatchObject({ status: 'closed', reason: 'rescheduled_beyond_expiry' });
  });
  it('cancels excessive reschedules instead of silently dropping original source provenance', async () => {
    const h = setup(); await h.turn('origin-source');
    for (let i = 0; i < 21; i++) {
      const text = `Schedule confirmation ${i}: October 20, ending at 15:00 UTC.`;
      h.assess.mockResolvedValueOnce({ situations: [{ topic: 'interview', summary: text, status: 'open', timing: { kind: 'after_event', evidenceQuote: text, eventWindow: { endsAt: '2026-10-20T15:00:00Z' } } }] });
      await h.turn(`update-${i}`, text);
    }
    await h.loop.invalidate(key, { sourceIds: ['origin-source'], reason: 'forget_original' });
    expect((await h.loop.status(key)).intentions[0]).toMatchObject({ status: 'cancelled', purpose: '', reason: 'source_limit' });
    h.set('2026-10-20T16:00:00Z'); expect((await h.drain()).sent).toBe(0);
  });
});
