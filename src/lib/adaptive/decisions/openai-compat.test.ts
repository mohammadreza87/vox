/**
 * S15 compatibility tests for the Decisions provider against the installed
 * openai SDK (7.39.0 in the lockfile; the fallback cases also hold on 6.9.1).
 * Every request goes to a mocked fetch: no network, no real credentials.
 */
import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { DecisionService, OpenAIDecisionProvider, DECISIONS_MODEL, type DecisionContext, type DecisionInput } from '.';
import { SYNTHETIC_IMAGE } from '../prediction/fixtures';

const API_KEY = 'synthetic-not-a-secret';
const input: DecisionInput = { input: 'SYNTHETIC current final message', questions: [{ name: 'preference', type: 'predicate', instructions: 'Is there a preference?' }] };
const answer = { model: DECISIONS_MODEL, answers: [{ name: 'preference', type: 'predicate', probability: 0.9 }], usage: { input_tokens: 10 } };
const wireBody = (request: DecisionInput) => ({ model: 'gpt-6-luna', input: request.input, questions: request.questions, prompt_cache_options: { mode: 'explicit' } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const hasTypedHelper = typeof Reflect.get(Reflect.get(new OpenAI({ apiKey: API_KEY, dangerouslyAllowBrowser: true }), 'decisions') ?? {}, 'create') === 'function';

function sdkClient(fetch: typeof globalThis.fetch, extra: Partial<ConstructorParameters<typeof OpenAI>[0]> = {}) {
  return new OpenAI({ apiKey: API_KEY, fetch, dangerouslyAllowBrowser: true, ...extra });
}
/** The SDK client the provider holds; read structurally because the field is private. */
function heldClient(provider: OpenAIDecisionProvider): OpenAI {
  return Reflect.get(provider, 'client') as OpenAI;
}
function postOnly(result: unknown = answer, extra: Record<string, unknown> = {}) {
  const post = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => result);
  return { post, client: { post, ...extra } as unknown as Pick<OpenAI, 'post'> };
}
function typedFake(result: unknown = answer) {
  const create = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => result);
  const post = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => { throw new Error('post must not be used when the typed helper exists'); });
  return { create, post, client: { post, decisions: { create } } as unknown as Pick<OpenAI, 'post'> };
}
const reject = (run: () => Promise<unknown>) => Promise.resolve().then(run);

describe('installed openai SDK', () => {
  // The lockfile pins openai 7.39.0. Mark this it.skip only if the upgrade is reverted.
  it('exposes decisions.create as a function', () => {
    const client = new OpenAI({ apiKey: API_KEY, fetch: vi.fn<typeof fetch>(), dangerouslyAllowBrowser: true, maxRetries: 0 });
    expect(typeof client.decisions.create).toBe('function');
  });
});

describe('OpenAIDecisionProvider typed path', () => {
  it.runIf(hasTypedHelper)('calls client.decisions.create once with the base wire format', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(answer));
    const client = sdkClient(fetch, { maxRetries: 0 });
    const create = vi.spyOn(client.decisions, 'create');
    const post = vi.spyOn(client, 'post');
    const signal = new AbortController().signal;
    await expect(new OpenAIDecisionProvider(client).evaluate(input, signal)).resolves.toEqual(answer);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toEqual(wireBody(input));
    expect(create.mock.calls[0][1]).toEqual({ signal, timeout: 500, maxRetries: 0 });
    // The helper delegates to post exactly once; the provider never calls post itself.
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0][0]).toBe('/decisions');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe('https://api.openai.com/v1/decisions');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(wireBody(input));
    expect(Object.keys(body).sort()).toEqual(['input', 'model', 'prompt_cache_options', 'questions']);
    expect(String(init.body)).not.toMatch(/signal|timeout|authorizeNow/);
  });

  it.runIf(!hasTypedHelper)('uses the post fallback on an SDK without the typed helper', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(answer));
    const client = sdkClient(fetch);
    const post = vi.spyOn(client, 'post');
    await new OpenAIDecisionProvider(client).evaluate(input, new AbortController().signal);
    expect(post).toHaveBeenCalledOnce();
    expect(JSON.parse(String((fetch.mock.calls[0] as [unknown, RequestInit])[1].body))).toEqual(wireBody(input));
  });
});

describe('OpenAIDecisionProvider post fallback', () => {
  it.each([
    ['no decisions resource', {}],
    ['an empty decisions resource', { decisions: {} }],
    ['a non-function create', { decisions: { create: 'not-a-function' } }],
  ])('uses client.post with %s', async (_label, extra) => {
    const { post, client } = postOnly(answer, extra);
    const signal = new AbortController().signal;
    await expect(new OpenAIDecisionProvider(client).evaluate(input, signal)).resolves.toEqual(answer);
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/decisions', { body: wireBody(input), signal, timeout: 500, maxRetries: 0 });
  });
});

describe('OpenAIDecisionProvider timeout option', () => {
  it.each([
    [1200, 1200],
    [0, 1],
    [60_000, 5000],
    [12.7, 12],
    [Number.NaN, 500],
    [undefined, 500],
  ])('timeoutMs %s becomes %s on both paths', async (timeoutMs, expected) => {
    const signal = new AbortController().signal;
    const typed = typedFake();
    await new OpenAIDecisionProvider(typed.client).evaluate(input, signal, undefined, { timeoutMs });
    expect(typed.create).toHaveBeenCalledWith(wireBody(input), { signal, timeout: expected, maxRetries: 0 });
    expect(typed.post).not.toHaveBeenCalled();
    const fallback = postOnly();
    await new OpenAIDecisionProvider(fallback.client).evaluate(input, signal, undefined, { timeoutMs });
    expect(fallback.post).toHaveBeenCalledWith('/decisions', { body: wireBody(input), signal, timeout: expected, maxRetries: 0 });
  });

  it('keeps 500 ms when no options object is passed', async () => {
    const typed = typedFake();
    await new OpenAIDecisionProvider(typed.client).evaluate(input, new AbortController().signal);
    expect(typed.create.mock.calls[0][1]).toMatchObject({ timeout: 500 });
  });
});

describe('OpenAIDecisionProvider zod boundary', () => {
  const question = (index: number) => ({ name: `q${index}`, type: 'predicate' as const, instructions: 'Synthetic question?' });
  it.each([
    ['eight questions', { input: 'SYNTHETIC', questions: Array.from({ length: 8 }, (_, i) => question(i)) }],
    ['an unknown top-level key', { ...input, transcript: 'SYNTHETIC_PRIVATE' }],
    ['an input_audio part', { input: [{ role: 'user', content: [{ type: 'input_text', text: 'SYNTHETIC' }, { type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } }] }], questions: input.questions }],
  ])('rejects %s before any fetch', async (_label, request) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(answer));
    const client = sdkClient(fetch, { maxRetries: 0 });
    const create = hasTypedHelper ? vi.spyOn(client.decisions, 'create') : null;
    const post = vi.spyOn(client, 'post');
    await expect(reject(() => new OpenAIDecisionProvider(client).evaluate(request as DecisionInput, new AbortController().signal))).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    if (create) expect(create).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('passes a low-detail image part through to the body unchanged', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(answer));
    const request: DecisionInput = { input: [{ role: 'user', content: [{ type: 'input_text', text: 'SYNTHETIC caption' }, { type: 'input_image', image_url: SYNTHETIC_IMAGE, detail: 'low' }] }], questions: input.questions };
    await new OpenAIDecisionProvider(sdkClient(fetch, { maxRetries: 0 })).evaluate(request, new AbortController().signal);
    const body = JSON.parse(String((fetch.mock.calls[0] as [unknown, RequestInit])[1].body));
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'SYNTHETIC caption' }, { type: 'input_image', image_url: SYNTHETIC_IMAGE, detail: 'low' }] }]);
  });
});

describe('OpenAIDecisionProvider transport fence on the typed path', () => {
  function guarded() {
    const fetcher = vi.fn<typeof fetch>(async () => json(answer));
    const provider = OpenAIDecisionProvider.guarded({ apiKey: API_KEY, dangerouslyAllowBrowser: true }, fetcher);
    const client = heldClient(provider);
    const create = hasTypedHelper ? vi.spyOn(client.decisions, 'create') : null;
    const post = vi.spyOn(client, 'post');
    return { fetcher, provider, create, post };
  }

  it('exports zero requests when authority flips during SDK preparation', async () => {
    const { fetcher, provider, create } = guarded();
    let allowed = true;
    const pending = provider.evaluate(input, new AbortController().signal, () => allowed);
    queueMicrotask(() => { allowed = false; });
    await expect(pending).rejects.toBeDefined();
    if (hasTypedHelper) expect(create).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('exports zero requests when the signal aborts during SDK preparation', async () => {
    const { fetcher, provider, create } = guarded();
    const controller = new AbortController();
    const pending = provider.evaluate(input, controller.signal, () => true);
    queueMicrotask(() => controller.abort());
    await expect(pending).rejects.toBeDefined();
    if (hasTypedHelper) expect(create).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('isolates a concurrent permitted request: exactly one fetch', async () => {
    const { fetcher, provider, create } = guarded();
    let allowed = true;
    const denied = provider.evaluate(input, new AbortController().signal, () => allowed);
    queueMicrotask(() => { allowed = false; });
    const permitted = provider.evaluate(input, new AbortController().signal, () => true);
    const settled = await Promise.allSettled([denied, permitted]);
    expect(settled[0].status).toBe('rejected');
    expect(settled[1]).toMatchObject({ status: 'fulfilled', value: answer });
    if (hasTypedHelper) expect(create).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('DecisionService through the real SDK', () => {
  const context = (request: DecisionInput = input): DecisionContext => ({ enabled: true, revision: 1, currentRevision: () => 1,
    authorize: async () => 'permitted-v1', loadInput: async () => request });

  it.each([
    [500, 'provider_error'],
    [429, 'rate_limited'],
    [404, 'unsupported'],
  ])('maps HTTP %s to %s with no retry', async (status, reason) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ error: { message: 'synthetic' } }, status));
    // Default client retries are 2; the provider must force 0 per request.
    const result = await new DecisionService(new OpenAIDecisionProvider(sdkClient(fetch))).evaluate(context());
    expect(result).toMatchObject({ status: 'unknown', reason });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns answered for a full Decision response', async () => {
    const request: DecisionInput = { input: 'SYNTHETIC current final message', questions: [
      { name: 'preference', type: 'predicate', instructions: 'Is there a preference?' },
      { name: 'route', type: 'choice', instructions: 'Which route?', choices: [{ value: 'quick', description: 'Short reply.' }, { value: 'thoughtful', description: 'Long reply.' }] },
      { name: 'urgency', type: 'score', instructions: 'How urgent?', levels: [{ label: 'low', description: 'Not urgent.' }, { label: 'high', description: 'Urgent.' }] },
    ] };
    const full = { model: DECISIONS_MODEL, usage: { input_tokens: 10 }, answers: [
      { name: 'preference', type: 'predicate', probability: 0.8 },
      { name: 'route', type: 'choice', choice: 'quick', confidence: 0.7, probabilities: [{ value: 'quick', probability: 0.7 }, { value: 'thoughtful', probability: 0.3 }] },
      { name: 'urgency', type: 'score', score: 0.25, confidence: 0.75, probabilities: [{ value: 0, label: 'low', probability: 0.75 }, { value: 1, label: 'high', probability: 0.25 }] },
    ] };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(full));
    const result = await new DecisionService(new OpenAIDecisionProvider(sdkClient(fetch))).evaluate(context(request));
    expect(result).toMatchObject({ status: 'answered', model: DECISIONS_MODEL, inputTokens: 10 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects with the SDK connection-timeout error when options.timeoutMs elapses', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => new Promise<Response>((_resolve, rejectFetch) => {
      const signal = init?.signal;
      // What a spec-compliant fetch rejects with on abort (an Error named AbortError).
      const aborted = () => rejectFetch(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
      if (signal?.aborted) aborted();
      signal?.addEventListener('abort', aborted, { once: true });
    }));
    const pending = new OpenAIDecisionProvider(sdkClient(fetch)).evaluate(input, new AbortController().signal, undefined, { timeoutMs: 20 });
    // Assert the class only: error.name is 'Error' on both 6.9.1 and 7.39.0.
    await expect(pending).rejects.toBeInstanceOf(OpenAI.APIConnectionTimeoutError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
