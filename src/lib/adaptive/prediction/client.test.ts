import { afterEach, describe, expect, it, vi } from 'vitest';
import { LivePredictionConsumer, predictionHttpTransport, type PredictionScope } from './client';
import type { PredictInput, PredictionReply } from '../runtime/contracts';
const scope: PredictionScope = { space: 'work', agentId: 'agent', sessionId: 'session', turnId: 'turn', contextKey: 'audience-v1' };
const reply = (input: PredictInput): PredictionReply => ({ status: 'answered', model: 'gpt-6-luna', answers: [], elapsedMs: 20,
  policyReceipt: 'receipt', questionVersion: 'vox-semantic-v1', sessionId: input.sessionId, turnId: input.turnId, revision: input.revision, contextKey: input.contextKey, expiresAt: Date.now() + 1500, routeHint: 'recall' });
afterEach(() => vi.useRealTimers());
function setup(send = vi.fn(async (input: PredictInput, _signal: AbortSignal) => { void _signal; return reply(input); })) {
  const invalidate = vi.fn(async () => ({})), validate = vi.fn(async () => ({ valid: true })), onPrepared = vi.fn();
  const consumer = new LivePredictionConsumer({ send, invalidate, validate, onPrepared }); consumer.startTurn(scope);
  return { consumer, send, invalidate, validate, onPrepared };
}
describe('live partial conversation consumer', () => {
  it('debounces EN/FA clauses and only exports stable explicit drafts', async () => {
    vi.useFakeTimers(); const { consumer, send, invalidate } = setup();
    consumer.update({ text: 'What', stable: false }); await vi.advanceTimersByTimeAsync(300); expect(send).not.toHaveBeenCalled();
    consumer.update({ text: 'What did we decide?', stable: true }); await vi.advanceTimersByTimeAsync(100);
    consumer.update({ text: 'چه تصمیمی گرفتیم؟', stable: true }); await vi.advanceTimersByTimeAsync(180);
    expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0][0].text).toBe('چه تصمیمی گرفتیم؟');
    expect(invalidate).not.toHaveBeenCalled(); expect(await consumer.takePrepared()).toMatchObject({ routeHint: 'recall' });
  });
  it('clears and aborts on correction, discards late results even if transport ignores abort', async () => {
    vi.useFakeTimers(); let resolve!: (r: PredictionReply) => void;
    const send = vi.fn((input: PredictInput, _signal: AbortSignal) => new Promise<PredictionReply>(r => { void input; void _signal; resolve = r; }));
    const { consumer, onPrepared, invalidate } = setup(send);
    consumer.update({ text: 'Recall', stable: true }); await vi.advanceTimersByTimeAsync(180);
    const old = send.mock.calls[0][0]; consumer.update({ text: 'Do not recall', stable: false });
    expect(send.mock.calls[0][1].aborted).toBe(true); expect(invalidate).toHaveBeenCalledWith({ ...scope, revision: old.revision });
    resolve(reply(old)); await vi.advanceTimersByTimeAsync(0);
    expect(onPrepared.mock.calls.some(([value]) => value?.status === 'answered')).toBe(false); expect(await consumer.takePrepared()).toBeNull();
  });
  it('caps two calls across revisions, resets at new turn and invalidates audience/space changes', async () => {
    vi.useFakeTimers(); const { consumer, send } = setup();
    for (let i = 0; i < 4; i++) { consumer.update({ text: `draft${i}`, stable: true }); await vi.advanceTimersByTimeAsync(180); }
    expect(send).toHaveBeenCalledTimes(2);
    consumer.startTurn({ ...scope, turnId: 'newturn', contextKey: 'audience-v2', space: 'personal' });
    expect(await consumer.takePrepared()).toBeNull(); consumer.update({ text: 'draft', stable: true }); await vi.advanceTimersByTimeAsync(180);
    expect(send).toHaveBeenCalledTimes(3); consumer.cancel(); expect(await consumer.takePrepared()).toBeNull();
  });
  it('validates current policy at consumption and discards expired/revoked results', async () => {
    vi.useFakeTimers(); const { consumer, validate } = setup();
    consumer.update({ text: 'Recall', stable: true }); await vi.advanceTimersByTimeAsync(180);
    validate.mockResolvedValue({ valid: false }); expect(await consumer.takePrepared()).toBeNull();
    consumer.update({ text: 'Recall', stable: true }); await vi.advanceTimersByTimeAsync(180); await vi.advanceTimersByTimeAsync(1501);
    expect(await consumer.takePrepared()).toBeNull(); expect(validate).toHaveBeenCalledOnce();
  });
  it('discards scope-mismatched or errored provider delivery and preserves baseline', async () => {
    vi.useFakeTimers(); const { consumer } = setup(vi.fn(async (input, _signal) => { void _signal; return { ...reply(input), contextKey: 'other-audience' }; }));
    consumer.update({ text: 'Recall', stable: true }); await vi.advanceTimersByTimeAsync(180); expect(await consumer.takePrepared()).toBeNull();
  });
  it('uses signed same-origin transport with AbortSignal and no provider credential', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ valid: true }))), controller = new AbortController();
    const transport = predictionHttpTransport(() => 'signed-init', fetcher);
    await transport.validate({ ...scope, revision: 1, policyReceipt: 'receipt' }, controller.signal);
    expect(fetcher).toHaveBeenCalledWith('/api/studio/experience/prediction-validate', expect.objectContaining({ signal: controller.signal, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': 'signed-init' } }));
  });
});
