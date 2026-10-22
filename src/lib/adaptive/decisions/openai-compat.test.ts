/**
 * S15 compatibility tests for the openai 7.x SDK (lockfile: 7.34.0). Every request goes
 * to an injected vi.fn fetch: no network and no real credentials. The fallback cases also
 * hold on 6.9.1, where the SDK has no decisions resource.
 *
 * Runs in the repo default jsdom environment: a per-file node environment cannot load
 * src/test/setup.ts (it touches `window`), so clients pass dangerouslyAllowBrowser like
 * the existing decisions tests do.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { DecisionService, OpenAIDecisionProvider, DECISIONS_MODEL, type DecisionContext, type DecisionInput } from '.';
import { SYNTHETIC_IMAGE } from '../prediction/fixtures';

const API_KEY = 'synthetic-not-a-secret';
const CANARY = 'PRIVATE_CANARY_S15';
const input: DecisionInput = { input: `SYNTHETIC current final message ${CANARY}`, questions: [{ name: 'preference', type: 'predicate', instructions: 'Is there a preference?' }] };
const answer = { model: DECISIONS_MODEL, answers: [{ name: 'preference', type: 'predicate', probability: 0.9 }], usage: { input_tokens: 10 } };
const wireBody = (request: DecisionInput) => ({ model: 'gpt-6-luna', input: request.input, questions: request.questions, prompt_cache_options: { mode: 'explicit' } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
type Fetch = typeof globalThis.fetch;
type Ctor = ConstructorParameters<typeof OpenAIDecisionProvider>[0];

function sdkClient(fetch: Fetch): OpenAI {
  return new OpenAI({ apiKey: API_KEY, fetch, maxRetries: 0, dangerouslyAllowBrowser: true });
}
function fetchOf(value: unknown = answer) {
  return vi.fn<Fetch>(async () => json(value));
}
function call(fetch: ReturnType<typeof vi.fn<Fetch>>, index = 0): { url: string; init: RequestInit } {
  const [url, init] = fetch.mock.calls[index] as [RequestInfo | URL, RequestInit];
  return { url: String(url), init };
}
const context = (request: DecisionInput = input): DecisionContext => ({ enabled: true, revision: 1, currentRevision: () => 1,
  authorize: async () => 'permitted-v1', loadInput: async () => request });

describe('1. installed SDK version', () => {
  it('lockfile, node_modules and package.json agree on openai 7.x >= 7.30.0', () => {
    const lock = JSON.parse(readFileSync(join(process.cwd(), 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string }> };
    const locked = lock.packages['node_modules/openai']?.version ?? '';
    const [major, minor] = locked.split('.').map(Number);
    expect(major).toBe(7);
    expect(minor).toBeGreaterThanOrEqual(30);
    const installed = (JSON.parse(readFileSync(join(process.cwd(), 'node_modules/openai/package.json'), 'utf8')) as { version: string }).version;
    expect(installed, 'stale node_modules: run npm ci (never through a symlink)').toBe(locked);
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(manifest.dependencies.openai.startsWith('^7.')).toBe(true);
  });
});

describe('2. typed resource', () => {
  it('the installed SDK exposes decisions.create', () => {
    const client = sdkClient(vi.fn<Fetch>());
    expect(typeof (client as { decisions?: { create?: unknown } }).decisions?.create).toBe('function');
  });
});

describe('3-4. create path with the real SDK', () => {
  it('sends the base wire format through client.decisions.create', async () => {
    const fetch = fetchOf();
    const client = sdkClient(fetch);
    const create = vi.spyOn(client.decisions, 'create');
    const result = await new DecisionService(new OpenAIDecisionProvider(client)).evaluate(context());
    expect(result).toMatchObject({ status: 'answered', inputTokens: 10 });
    expect(create).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    const { url, init } = call(fetch);
    expect(url).toBe('https://api.openai.com/v1/decisions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ model: 'gpt-6-luna', ...input, prompt_cache_options: { mode: 'explicit' } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('serialises a minimised low-detail image part exactly', async () => {
    const fetch = fetchOf();
    const evidence = [{ role: 'user' as const, content: [{ type: 'input_text' as const, text: 'SYNTHETIC caption' }, { type: 'input_image' as const, image_url: SYNTHETIC_IMAGE, detail: 'low' as const }] as [
      { type: 'input_text'; text: string }, { type: 'input_image'; image_url: string; detail: 'low' }] }];
    const request: DecisionInput = { input: evidence, questions: input.questions };
    const result = await new DecisionService(new OpenAIDecisionProvider(sdkClient(fetch))).evaluate(context(request));
    expect(result).toMatchObject({ status: 'answered' });
    expect(JSON.parse(String(call(fetch).init.body)).input).toEqual(evidence);
  });

  it('rejects an input_audio part as invalid_input without a fetch', async () => {
    const fetch = fetchOf();
    const request = { input: [{ role: 'user', content: [{ type: 'input_text', text: 'SYNTHETIC' }, { type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } }] }], questions: input.questions };
    const result = await new DecisionService(new OpenAIDecisionProvider(sdkClient(fetch))).evaluate(context(request as unknown as DecisionInput));
    expect(result).toMatchObject({ status: 'unknown', reason: 'invalid_input' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('5. post fallback when there is no usable resource', () => {
  it.each([
    ['absent', {}],
    ['undefined', { decisions: undefined }],
    ['null', { decisions: null }],
    ['empty', { decisions: {} }],
    ['non-function create', { decisions: { create: 'not-a-function' } }],
  ])('decisions %s => client.post', async (_label, extra) => {
    const post = vi.fn(async () => answer);
    const signal = new AbortController().signal;
    await expect(new OpenAIDecisionProvider({ post, ...extra } as unknown as Ctor).evaluate(input, signal)).resolves.toEqual(answer);
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/decisions', { body: wireBody(input), signal, timeout: 500, maxRetries: 0 });
  });
});

describe('6-7. stubbed create path and timeout', () => {
  function stub() {
    const post = vi.fn();
    const decisions = { create: vi.fn(async () => answer) };
    return { post, decisions, client: { post, decisions } as unknown as Ctor };
  }

  it('calls create as a method with the exact body and options; post is unused', async () => {
    const { post, decisions, client } = stub();
    const signal = new AbortController().signal;
    await expect(new OpenAIDecisionProvider(client).evaluate(input, signal)).resolves.toEqual(answer);
    expect(decisions.create).toHaveBeenCalledOnce();
    expect(decisions.create).toHaveBeenCalledWith(wireBody(input), { signal, timeout: 500, maxRetries: 0 });
    expect(decisions.create.mock.contexts[0]).toBe(decisions);
    expect(post).not.toHaveBeenCalled();
  });

  it.each<[string, { timeoutMs?: number } | undefined, number]>([
    ['omitted', undefined, 500],
    ['{}', {}, 500],
    ['1200', { timeoutMs: 1200 }, 1200],
    ['1200.7', { timeoutMs: 1200.7 }, 1200],
    ['9000', { timeoutMs: 9000 }, 5000],
    ['0', { timeoutMs: 0 }, 500],
    ['-1', { timeoutMs: -1 }, 500],
    ['NaN', { timeoutMs: Number.NaN }, 500],
    ['Infinity', { timeoutMs: Number.POSITIVE_INFINITY }, 500],
  ])('timeoutMs %s => %s ms', async (_label, options, expected) => {
    const { decisions, client } = stub();
    const signal = new AbortController().signal;
    const provider = new OpenAIDecisionProvider(client);
    await (options === undefined ? provider.evaluate(input, signal) : provider.evaluate(input, signal, undefined, options));
    expect(decisions.create).toHaveBeenCalledWith(wireBody(input), { signal, timeout: expected, maxRetries: 0 });
  });
});

describe('8. provider-boundary zod on both transports', () => {
  const requests: Array<[string, unknown]> = [
    ['an extra top-level key', { ...input, temperature: 1 }],
    ['an extra question key', { ...input, questions: [{ ...input.questions[0], temperature: 1 }] }],
  ];
  it.each(requests)('%s fails before the stubbed transports', async (_label, request) => {
    const post = vi.fn();
    const create = vi.fn();
    for (const client of [{ post }, { post, decisions: { create } }]) {
      await expect(Promise.resolve().then(() => new OpenAIDecisionProvider(client as unknown as Ctor).evaluate(request as DecisionInput, new AbortController().signal))).rejects.toThrow();
    }
    expect(post).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it.each(requests)('%s fails before the real SDK fetch', async (_label, request) => {
    const fetch = fetchOf();
    await expect(Promise.resolve().then(() => new OpenAIDecisionProvider(sdkClient(fetch)).evaluate(request as DecisionInput, new AbortController().signal))).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('9-10. real-SDK errors', () => {
  it.each([[429, 'rate_limited'], [404, 'unsupported'], [500, 'provider_error']])('HTTP %s => %s with exactly one fetch', async (status, reason) => {
    const fetch = vi.fn<Fetch>(async () => json({ error: { message: 'synthetic' } }, status));
    // A client with the SDK default retries (2): the provider forces maxRetries 0 per request.
    const client = new OpenAI({ apiKey: API_KEY, fetch, dangerouslyAllowBrowser: true });
    const result = await new DecisionService(new OpenAIDecisionProvider(client)).evaluate(context());
    expect(result).toMatchObject({ status: 'unknown', reason });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a provider timeout rejects with APIConnectionTimeoutError after one fetch', async () => {
    const fetch = vi.fn<Fetch>((_url, init) => new Promise<Response>((_resolve, rejectFetch) => {
      // What a spec-compliant fetch rejects with on abort: an AbortError. jsdom's DOMException is
      // not an instance of Node's Error, so the SDK would re-wrap it; use a plain Error with that name.
      const aborted = () => rejectFetch(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
      if (init?.signal?.aborted) aborted();
      init?.signal?.addEventListener('abort', aborted, { once: true });
    }));
    const error = await new OpenAIDecisionProvider(sdkClient(fetch)).evaluate(input, new AbortController().signal, undefined, { timeoutMs: 20 })
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(OpenAI.APIConnectionTimeoutError);
    expect((error as Error).constructor.name).toBe('APIConnectionTimeoutError');
    // Pinned finding for S09 (owner of DecisionService): the SDK never sets error.name, so it
    // is 'Error' on 6.9.1 and 7.34.0 alike, and DecisionService's name check cannot match.
    // Inside DecisionService its own deadline timer still reports 'timeout' first.
    expect((error as Error).name).toBe('Error');
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('11. authority fence on the create path', () => {
  it('denies before the transport and allows with the exact body', async () => {
    const fetcher = fetchOf();
    const provider = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-only', dangerouslyAllowBrowser: true }, fetcher);
    await expect(provider.evaluate(input, new AbortController().signal, () => false)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(provider.evaluate(input, new AbortController().signal, () => true)).resolves.toEqual(answer);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(String(call(fetcher).init.body))).toEqual(wireBody(input));
  });

  it('the guarded client uses the typed resource', async () => {
    const fetcher = fetchOf();
    const provider = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-only', dangerouslyAllowBrowser: true }, fetcher);
    const client = Reflect.get(provider, 'client') as OpenAI;
    const create = vi.spyOn(client.decisions, 'create');
    await provider.evaluate(input, new AbortController().signal, () => true);
    expect(create).toHaveBeenCalledOnce();
  });
  it('exports zero requests when authority flips during SDK preparation; a concurrent permitted call sends one', async () => {
    const fetcher = fetchOf();
    const provider = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-only', dangerouslyAllowBrowser: true }, fetcher);
    let allowed = true;
    const denied = provider.evaluate(input, new AbortController().signal, () => allowed);
    queueMicrotask(() => { allowed = false; });
    const permitted = provider.evaluate(input, new AbortController().signal, () => true);
    const settled = await Promise.allSettled([denied, permitted]);
    expect(settled[0].status).toBe('rejected');
    expect(settled[1]).toMatchObject({ status: 'fulfilled', value: answer });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('exports zero requests when the signal aborts during SDK preparation', async () => {
    const fetcher = fetchOf();
    const provider = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-only', dangerouslyAllowBrowser: true }, fetcher);
    const controller = new AbortController();
    const pending = provider.evaluate(input, controller.signal, () => true);
    queueMicrotask(() => controller.abort());
    await expect(pending).rejects.toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('12. answer validation on the create path', () => {
  it.each<[string, unknown, string]>([
    ['wrong model', { ...answer, model: 'gpt-other' }, 'malformed'],
    ['missing name', { ...answer, answers: [{ type: 'predicate', probability: 0.5 }] }, 'malformed'],
    ['refusal', { ...answer, answers: [{ name: 'preference', type: 'refusal' }] }, 'refusal'],
  ])('%s => %s, content-free', async (_label, raw, reason) => {
    const result = await new DecisionService(new OpenAIDecisionProvider(sdkClient(fetchOf(raw)))).evaluate(context());
    expect(result).toMatchObject({ status: 'unknown', reason });
    expect(JSON.stringify(result)).not.toContain(CANARY);
  });
});

describe('13. openai 7 SDK surface used elsewhere (wire level)', () => {
  it('responses.create posts to /v1/responses with the body passed through', async () => {
    const response = { id: 'resp_synthetic', object: 'response', output: [] };
    const fetch = fetchOf(response);
    const body = { model: 'synthetic', input: 'x', store: false, stream: false as const };
    await expect(sdkClient(fetch).responses.create(body)).resolves.toMatchObject(response);
    const { url, init } = call(fetch);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it('embeddings.create posts to /v1/embeddings and returns data[0].embedding', async () => {
    const fetch = fetchOf({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.25, -0.5] }], model: 'text-embedding-3-small', usage: { prompt_tokens: 1, total_tokens: 1 } });
    const result = await sdkClient(fetch).embeddings.create({ model: 'text-embedding-3-small', input: 'x', encoding_format: 'float' });
    expect(result.data[0].embedding).toEqual([0.25, -0.5]);
    expect(call(fetch).url).toBe('https://api.openai.com/v1/embeddings');
  });

  it('chat.completions.create keeps max_tokens and returns the message content', async () => {
    const fetch = fetchOf({ id: 'c', object: 'chat.completion', created: 0, model: 'synthetic', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }] });
    const result = await sdkClient(fetch).chat.completions.create({ model: 'synthetic', messages: [{ role: 'user', content: 'x' }], max_tokens: 1024 });
    expect(result.choices[0].message.content).toBe('ok');
    const { url, init } = call(fetch);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(String(init.body))).toMatchObject({ max_tokens: 1024 });
  });

  it('chat.completions.create with stream:true yields deltas in order and ends on [DONE]', async () => {
    const chunk = (content: string) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'synthetic', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;
    const sse = chunk('Hel') + chunk('lo') + 'data: [DONE]\n\n';
    const fetch = vi.fn<Fetch>(async () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
    const stream = await sdkClient(fetch).chat.completions.create({ model: 'synthetic', messages: [{ role: 'user', content: 'x' }], max_tokens: 1024, stream: true });
    const deltas: string[] = [];
    for await (const part of stream) deltas.push(part.choices[0]?.delta?.content ?? '');
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(JSON.parse(String(call(fetch).init.body))).toMatchObject({ stream: true, max_tokens: 1024 });
  });
});
