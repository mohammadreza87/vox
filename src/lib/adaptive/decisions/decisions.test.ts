import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { DecisionService, OpenAIDecisionProvider, PredictionSession, type DecisionContext, type DecisionInput } from './index';
const input: DecisionInput = { input: 'Please use a brief reply.', questions: [{ type: 'predicate', name: 'explicit_correction', instructions: 'Is there an explicit correction?' }] };
const answer = { model: 'gpt-6-luna', answers: [{ type: 'predicate', name: 'explicit_correction', probability: 0.8 }], usage: { input_tokens: 10 } };
const context = (extra: Partial<DecisionContext> = {}): DecisionContext => ({ enabled: true, revision: 1, currentRevision: () => 1,
  authorize: async () => 'permitted-v1', loadInput: async () => input, ...extra });
describe('Decisions service', () => {
  it('uses the documented endpoint through the installed SDK without credentials or a network request', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } }));
    const client = new OpenAI({ apiKey: 'synthetic-not-a-secret', fetch, dangerouslyAllowBrowser: true });
    const service = new DecisionService(new OpenAIDecisionProvider(client));
    expect(await service.evaluate(context())).toMatchObject({ status: 'answered', inputTokens: 10 });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://api.openai.com/v1/decisions');
    expect(JSON.parse(String(options.body))).toEqual({ model: 'gpt-6-luna', ...input, prompt_cache_options: { mode: 'explicit' } });
    expect(options.signal).toBeDefined();
  });
  it('does not load evidence when disabled or unauthorized', async () => {
    const loadInput = vi.fn(async () => input), evaluate = vi.fn(async () => answer);
    const service = new DecisionService({ evaluate });
    expect(await service.evaluate(context({ enabled: false, loadInput }))).toMatchObject({ reason: 'disabled' });
    expect(await service.evaluate(context({ authorize: async () => null, loadInput }))).toMatchObject({ reason: 'unauthorized' });
    expect(loadInput).not.toHaveBeenCalled(); expect(evaluate).not.toHaveBeenCalled();
  });
  it.each([
    { answers: [] },
    { answers: [answer.answers[0], answer.answers[0]] },
    { answers: [{ ...answer.answers[0], probability: NaN }] },
    { answers: [{ ...answer.answers[0], name: 'other' }] },
    { answers: [{ name: 'explicit_correction', type: 'score', score: 1 }] },
  ])('rejects malformed/mismatched answers %#', async partial => {
    expect(await new DecisionService({ evaluate: async () => ({ ...answer, ...partial }) }).evaluate(context())).toMatchObject({ status: 'unknown', reason: 'malformed' });
  });
  it('handles refusal as unknown, not false', async () => {
    const result = await new DecisionService({ evaluate: async () => ({ ...answer, answers: [{ name: 'explicit_correction', type: 'refusal' }] }) }).evaluate(context());
    expect(result).toMatchObject({ status: 'unknown', reason: 'refusal', inputTokens: 10 });
  });
  it('rejects unknown request properties and never serializes them', async () => {
    const evaluate = vi.fn();
    const result = await new DecisionService({ evaluate }).evaluate(context({ loadInput: async () => ({ ...input, transcript: 'PRIVATE_CANARY' }) }));
    expect(result).toMatchObject({ reason: 'invalid_input' }); expect(evaluate).not.toHaveBeenCalled();
  });
  it('discards revisions and revocations that change during the provider call', async () => {
    let revision = 1, authorization = 'v1';
    const service = new DecisionService({ evaluate: async () => { revision++; authorization = 'v2'; return answer; } });
    expect(await service.evaluate(context({ currentRevision: () => revision, authorize: async () => authorization }))).toMatchObject({ reason: 'stale', inputTokens: 10 });
  });
  it('rechecks authorization after loading and before exporting content', async () => {
    let permission = 'v1'; const evaluate = vi.fn();
    const result = await new DecisionService({ evaluate }).evaluate(context({ authorize: async () => permission,
      loadInput: async () => { permission = 'v2'; return input; } }));
    expect(result).toMatchObject({ reason: 'stale' }); expect(evaluate).not.toHaveBeenCalled();
  });
  it('times out even when a provider ignores abort', async () => {
    const evaluate = vi.fn(() => new Promise(() => {}));
    expect(await new DecisionService({ evaluate }).evaluate(context({ deadlineMs: 5 }))).toMatchObject({ reason: 'timeout' });
    expect(evaluate.mock.calls[0][1].aborted).toBe(true);
  });
  it('cancels an in-flight request', async () => {
    const controller = new AbortController();
    const service = new DecisionService({ evaluate: async () => { controller.abort(); return answer; } });
    expect(await service.evaluate(context({ signal: controller.signal }))).toMatchObject({ reason: 'cancelled' });
  });
  it.each([[429, 'rate_limited'], [404, 'unsupported'], [500, 'provider_error']])('falls back safely for provider %s', async (status, reason) => {
    const evaluate = vi.fn(async () => { throw { status, message: 'PRIVATE_CANARY' }; });
    const result = await new DecisionService({ evaluate }).evaluate(context());
    expect(result).toMatchObject({ status: 'unknown', reason }); expect(JSON.stringify(result)).not.toContain('PRIVATE_CANARY'); expect(evaluate).toHaveBeenCalledOnce();
  });
  it('validates choice distributions and score weighted averages', async () => {
    const questions: DecisionInput['questions'] = [{ type: 'choice', name: 'route', instructions: 'Select route', choices: [{ value: 'other', description: 'Other' }, { value: 'recall', description: 'Recall' }] },
      { type: 'score', name: 'relevance', instructions: 'Score', levels: [{ label: 'none', description: 'None' }, { label: 'high', description: 'High' }] }];
    const answers = [{ type: 'choice', name: 'route', choice: 'recall', confidence: 0.8, probabilities: [{ value: 'other', probability: 0.2 }, { value: 'recall', probability: 0.8 }] },
      { type: 'score', name: 'relevance', score: 0.7, confidence: 0.7, probabilities: [{ value: 0, label: 'none', probability: 0.3 }, { value: 1, label: 'high', probability: 0.7 }] }];
    const evaluate = vi.fn(async () => ({ ...answer, answers }));
    const service = new DecisionService({ evaluate });
    expect(await service.evaluate(context({ loadInput: async () => ({ input: 'Synthetic input', questions }) }))).toMatchObject({ status: 'answered' });
    answers[1].score = 0.5;
    expect(await service.evaluate(context({ loadInput: async () => ({ input: 'Synthetic input', questions }) }))).toMatchObject({ reason: 'malformed' });
  });
  it('limits speculative evaluations across partial revisions and resets only for a new turn', async () => {
    const session = new PredictionSession(new DecisionService({ evaluate: async () => answer }));
    const ctx = { enabled: true, authorize: async () => 'v1', loadInput: async () => input };
    expect(await session.prepare(ctx)).toMatchObject({ status: 'answered' }); session.revise();
    expect(await session.prepare(ctx)).toMatchObject({ status: 'answered' }); session.revise();
    expect(await session.prepare(ctx)).toMatchObject({ reason: 'budget' }); session.startTurn();
    expect(await session.prepare(ctx)).toMatchObject({ status: 'answered' });
  });
  it('opens the circuit after three provider failures without retrying or leaking evidence', async () => {
    let now = 100; const evaluate = vi.fn(async () => { throw { status: 429 }; });
    const service = new DecisionService({ evaluate }, () => now);
    for (let i = 0; i < 3; i++) expect(await service.evaluate(context())).toMatchObject({ reason: 'rate_limited' });
    expect(await service.evaluate(context())).toMatchObject({ reason: 'circuit_open' });
    expect(evaluate).toHaveBeenCalledTimes(3); now += 30_001;
    expect(await service.evaluate(context())).toMatchObject({ reason: 'rate_limited' });
  });
  it('allows only one request in flight per session', async () => {
    const session = new PredictionSession(new DecisionService({ evaluate: () => new Promise(() => {}) }));
    const ctx = { enabled: true, authorize: async () => 'v1', loadInput: async () => input };
    const active = session.prepare(ctx);
    expect(await session.prepare(ctx)).toMatchObject({ reason: 'busy' }); session.cancel();
    expect(await active).toMatchObject({ reason: 'cancelled' });
  });
});
