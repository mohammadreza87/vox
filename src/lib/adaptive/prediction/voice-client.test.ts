import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tentativeTranscript, VoicePartialConsumer, type VoicePartialCapability } from './voice-client';
import type { PredictionTransport } from './client';
const event = (text: string, id = 1) => ({ type: 'tentative_user_transcript',
  tentative_user_transcription_event: { user_transcript: text, event_id: id } });
const verified = { available: true, configurationVersion: 'synthetic-v1' } as const;
function setup(...capabilities: [capability?: VoicePartialCapability]) {
  const capability = capabilities.length ? capabilities[0] : verified;
  const send = vi.fn<PredictionTransport['send']>(async () => ({ status: 'unknown' as const, reason: 'disabled' as const, elapsedMs: 0 }));
  const invalidate = vi.fn(async () => ({})), validate = vi.fn(async () => ({ valid: true }));
  const consumer = new VoicePartialConsumer({ agentId: 'agent1', space: 'work', sessionId: 'session1', capability, send, invalidate, validate });
  return { consumer, send, invalidate, validate };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it('allowlists actual tentative user text and rejects audio, agent correction and invalid fields', () => {
  expect(tentativeTranscript(event(' سلام '))).toEqual({ text: 'سلام', eventId: 1 });
  for (const value of [null, {}, { type: 'agent_response_correction', text: 'secret' }, { type: 'audio', audio: 'raw' },
    event('x', -1), event('x', NaN), event('x'.repeat(4097))]) expect(tentativeTranscript(value)).toBeNull();
});
it.each([undefined, { available: false, reason: 'client_event_configuration_unverified' } as const])('requires both verified capability and explicit opt-in (%j)', async capability => {
  const { consumer, send } = setup(capability);
  consumer.setOptIn(true); consumer.onDebug(event('Please help with this task.'));
  await vi.advanceTimersByTimeAsync(1000); expect(send).not.toHaveBeenCalled(); consumer.dispose();
});
it('defaults off and debounces actual tentative text into the scoped signed transport', async () => {
  const { consumer, send } = setup(); consumer.onDebug(event('Private draft.'));
  await vi.advanceTimersByTimeAsync(1000); expect(send).not.toHaveBeenCalled();
  consumer.setOptIn(true); consumer.onDebug(event('Current clause.'));
  await vi.advanceTimersByTimeAsync(249); expect(send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent1', space: 'work', sessionId: 'session1',
    revision: 1, text: 'Current clause.', question: 'intent_route', contextKey: 'voice-synthetic-v1' }), expect.any(AbortSignal));
  consumer.dispose();
});
it('corrections abort old work, invalidate its receipt and remain bounded to two evaluations', async () => {
  const { consumer, send, invalidate } = setup(); consumer.setOptIn(true);
  send.mockImplementation(() => new Promise(() => {}));
  consumer.onDebug(event('Old clause.')); await vi.advanceTimersByTimeAsync(250);
  const signal = send.mock.calls[0][1];
  consumer.onDebug(event('Corrected clause.', 2)); expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(250);
  expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1][0]).toMatchObject({ revision: 2, text: 'Corrected clause.' });
  expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, sessionId: 'session1' }));
  consumer.onDebug(event('Third correction.', 3)); await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledTimes(2);
  consumer.dispose();
});
it.each(['final', 'mute', 'withdraw', 'dispose'] as const)('cancels pending and late revisions on %s', async boundary => {
  const { consumer, send } = setup(); consumer.setOptIn(true);
  consumer.onDebug(event('A provisional sentence.'));
  if (boundary === 'final') consumer.finishTurn();
  if (boundary === 'mute') consumer.setListening(false);
  if (boundary === 'withdraw') consumer.setOptIn(false);
  if (boundary === 'dispose') consumer.dispose();
  consumer.onDebug(event('Late correction.', 1));
  await vi.advanceTimersByTimeAsync(1000); expect(send).not.toHaveBeenCalled(); consumer.dispose();
});
it('ignores later provisional events after final until the next listening callback', async () => {
  const { consumer, send } = setup(); consumer.setOptIn(true);
  consumer.onDebug(event('Before final.', 1)); consumer.finishTurn(); consumer.onDebug(event('Late event.', 2));
  await vi.advanceTimersByTimeAsync(250); expect(send).not.toHaveBeenCalled();
  consumer.setListening(true); consumer.onDebug(event('New spoken turn.', 3));
  await vi.advanceTimersByTimeAsync(250); expect(send).toHaveBeenCalledOnce(); consumer.dispose();
});
it('starts a new epoch only for a newer event and rejects out-of-order previous events', async () => {
  const { consumer, send } = setup(); consumer.setOptIn(true);
  consumer.onDebug(event('First.', 7)); consumer.cancel(); consumer.onDebug(event('Late first.', 7));
  consumer.onDebug(event('Second.', 8)); consumer.onDebug(event('Older.', 6));
  await vi.advanceTimersByTimeAsync(250);
  expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][0].text).toBe('Second.'); consumer.dispose();
});
it('invalid tentative revisions cancel prior pending preparation; unrelated debug events never export', async () => {
  const { consumer, send } = setup(); consumer.setOptIn(true);
  consumer.onDebug(event('Pending.')); consumer.onDebug(event('x'.repeat(4097)));
  consumer.onDebug({ type: 'audio', audio: 'PRIVATE_AUDIO' });
  consumer.onDebug({ type: 'agent_response_correction', text: 'PRIVATE_AGENT' });
  await vi.advanceTimersByTimeAsync(1000); expect(send).not.toHaveBeenCalled(); consumer.dispose();
});
