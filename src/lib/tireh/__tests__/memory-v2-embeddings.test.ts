// Default (jsdom) environment: src/test/setup.ts dereferences `window`, so a
// node-environment pragma fails before any test runs. The openai SDK refuses
// browser-like globals, so `navigator` is stubbed away to emulate a server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cosine,
  createEmbeddingProviderFromEnv,
  DEFAULT_EMBEDDING_MODEL,
  embedMemory,
  EMBEDDING_VERSION,
  FakeEmbeddingProvider,
  MAX_EMBEDDING_BATCH,
  OpenAIEmbeddingProvider,
} from '../memory/embeddings';
import { contentHash } from '../memory/record-v2';
import { memory } from './fixtures';

const API_KEY = 'sk-test-SECRETKEY-0001';
const CANARY = 'CANARY-embedding-input-7f3a';

beforeEach(() => { vi.stubGlobal('navigator', undefined); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

type Call = { url: string; body: Record<string, unknown> };

function stubFetch(options: { dims?: number; status?: number; shuffle?: boolean; echo?: boolean; hang?: boolean } = {}) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    if (options.hang) {
      await new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    if (options.status && options.status >= 400) {
      const message = options.echo ? `bad input ${JSON.stringify(body.input)} key ${API_KEY}` : 'server error';
      return new Response(JSON.stringify({ error: { message, type: 'server_error' } }), { status: options.status, headers: { 'content-type': 'application/json' } });
    }
    const input = body.input as string[];
    const dims = options.dims ?? 1536;
    let data = input.map((_text, index) => ({ object: 'embedding', index, embedding: new Array(dims).fill(0).map((_, i) => (i === index % dims ? 1 : 0)) }));
    if (options.shuffle) data = [...data].reverse();
    return new Response(JSON.stringify({ object: 'list', data, model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fn, calls };
}

describe('cosine', () => {
  it('handles identical, orthogonal, opposite, zero and mismatched vectors', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });
  it('is clamped to [-1, 1]', () => {
    const v = [0.1 + 0.2, 0.3];
    expect(cosine(v, v)).toBeLessThanOrEqual(1);
  });
});

describe('FakeEmbeddingProvider', () => {
  it('is deterministic, unit norm and sized as configured', async () => {
    const p = new FakeEmbeddingProvider({ dimensions: 32 });
    const [a, b] = await p.embed(['GameEnd launch date', 'GameEnd launch date']);
    expect(a).toHaveLength(32);
    expect(a).toEqual(b);
    expect(Math.sqrt(a.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 10);
    expect(p.version).toBe(EMBEDDING_VERSION);
    expect(p.model).toBe('fake-embedding');
    expect(new FakeEmbeddingProvider().dimensions).toBe(64);
  });
  it('keeps the zero vector for text with no tokens', async () => {
    const [v] = await new FakeEmbeddingProvider({ dimensions: 8 }).embed(['!']);
    expect(v).toEqual(new Array(8).fill(0));
  });
  it('counters hold counts only, never text', async () => {
    const p = new FakeEmbeddingProvider();
    await p.embed([CANARY, 'two']);
    await p.embed(['three']);
    expect(p.calls).toBe(2);
    expect(p.inputs).toBe(3);
    expect(JSON.stringify(p)).not.toContain(CANARY);
  });
  it('throws failWith when set', async () => {
    const p = new FakeEmbeddingProvider({ failWith: new Error('boom') });
    await expect(p.embed(['x'])).rejects.toThrow('boom');
  });
  it('accepts a custom tokenizer', async () => {
    const p = new FakeEmbeddingProvider({ tokenizer: () => ['same'] });
    const [a, b] = await p.embed(['one text', 'another']);
    expect(a).toEqual(b);
  });
});

describe('OpenAIEmbeddingProvider (injected fetch, no network)', () => {
  it('sends the documented body to /embeddings and makes no request on construction', async () => {
    const { fn, calls } = stubFetch();
    const p = new OpenAIEmbeddingProvider({ apiKey: API_KEY, fetch: fn as unknown as typeof fetch });
    expect(fn).not.toHaveBeenCalled();
    const out = await p.embed(['a', 'b']);
    expect(out).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.endsWith('/embeddings')).toBe(true);
    expect(calls[0].body).toEqual({ model: 'text-embedding-3-small', input: ['a', 'b'], encoding_format: 'float' });
    expect(p.model).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(p.dimensions).toBe(1536);
    expect(p.version).toBe(EMBEDDING_VERSION);
  });

  it('sends dimensions only when configured', async () => {
    const { fn, calls } = stubFetch({ dims: 256 });
    const p = new OpenAIEmbeddingProvider({ apiKey: API_KEY, fetch: fn as unknown as typeof fetch, dimensions: 256, model: 'm2' });
    await p.embed(['a']);
    expect(calls[0].body).toEqual({ model: 'm2', input: ['a'], encoding_format: 'float', dimensions: 256 });
  });

  it('maps shuffled response indexes back to input order', async () => {
    const { fn } = stubFetch({ shuffle: true });
    const out = await new OpenAIEmbeddingProvider({ apiKey: API_KEY, fetch: fn as unknown as typeof fetch }).embed(['a', 'b', 'c']);
    expect(out.map((v) => v.indexOf(1))).toEqual([0, 1, 2]);
  });

  it('batches 300 inputs into 3 sequential calls of at most 128', async () => {
    const { fn, calls } = stubFetch();
    const inputs = Array.from({ length: 300 }, (_, i) => `text ${i}`);
    const out = await new OpenAIEmbeddingProvider({ apiKey: API_KEY, fetch: fn as unknown as typeof fetch }).embed(inputs);
    expect(out).toHaveLength(300);
    expect(calls.map((c) => (c.body.input as string[]).length)).toEqual([MAX_EMBEDDING_BATCH, MAX_EMBEDDING_BATCH, 44]);
    expect((calls[2].body.input as string[])[0]).toBe('text 256');
  });

  it('embed([]) makes no call; a blank string throws before fetch', async () => {
    const { fn } = stubFetch();
    const p = new OpenAIEmbeddingProvider({ apiKey: API_KEY, fetch: fn as unknown as typeof fetch });
    expect(await p.embed([])).toEqual([]);
    await expect(p.embed(['ok', '   '])).rejects.toThrow(TypeError);
    await expect(p.embed([''])).rejects.toThrow('embedding_input_empty');
    expect(fn).not.toHaveBeenCalled();
  });

  it('a 500 rejects after exactly one fetch call, with no input or key in the error', async () => {
    const { fn } = stubFetch({ status: 500, echo: true });
    const p = new OpenAIEmbeddingProvider({ apiKey: API_KEY, fetch: fn as unknown as typeof fetch });
    const error = await p.embed([CANARY]).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(fn).toHaveBeenCalledTimes(1);
    const text = `${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`;
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(API_KEY);
    expect(error.message).toBe('embedding_request_failed:500');
  });

  it('an aborted signal rejects', async () => {
    const { fn } = stubFetch({ hang: true });
    const p = new OpenAIEmbeddingProvider({ apiKey: API_KEY, fetch: fn as unknown as typeof fetch });
    const controller = new AbortController();
    const pending = p.embed([CANARY], controller.signal);
    controller.abort();
    const error = await pending.catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(CANARY);
    const already = new AbortController();
    already.abort();
    await expect(p.embed(['x'], already.signal)).rejects.toThrow();
  });

  it('throws embedding_dimension_mismatch', async () => {
    const { fn } = stubFetch({ dims: 10 });
    const p = new OpenAIEmbeddingProvider({ apiKey: API_KEY, fetch: fn as unknown as typeof fetch });
    const error = await p.embed([CANARY]).catch((e: unknown) => e as Error);
    expect(error.message).toBe('embedding_dimension_mismatch');
    expect(`${error.message}${error.stack}`).not.toContain(CANARY);
  });
});

describe('embedMemory', () => {
  it('returns null for personal, confidential and blank records without calling the provider', async () => {
    const p = new FakeEmbeddingProvider();
    expect(await embedMemory(memory({ content: 'x', scope: { kind: 'private', personId: 'reza' }, sensitivity: 'personal' }), p)).toBeNull();
    expect(await embedMemory(memory({ content: 'x', scope: { kind: 'private', personId: 'reza' }, sensitivity: 'confidential' }), p)).toBeNull();
    expect(await embedMemory(memory({ content: '   ', scope: { kind: 'org' } }), p)).toBeNull();
    expect(p.calls).toBe(0);
  });
  it('embeds normalised content only and returns model, version and hash', async () => {
    const p = new FakeEmbeddingProvider();
    const m = memory({ content: '  GameEnd launch  ', topic: 'unrelated topic words', scope: { kind: 'org' } });
    const out = await embedMemory(m, p);
    const [expected] = await new FakeEmbeddingProvider().embed(['GameEnd launch']);
    expect(out).toEqual({ embedding: expected, embeddingModel: 'fake-embedding', embeddingVersion: EMBEDDING_VERSION, contentHash: contentHash(m.content) });
    expect(p.inputs).toBe(1);
  });
});

describe('createEmbeddingProviderFromEnv', () => {
  it('returns null without OPENAI_API_KEY', () => {
    expect(createEmbeddingProviderFromEnv({})).toBeNull();
    expect(createEmbeddingProviderFromEnv({ OPENAI_API_KEY: '   ' })).toBeNull();
  });
  it('defaults the model and honours OPENAI_EMBEDDING_MODEL', () => {
    expect(createEmbeddingProviderFromEnv({ OPENAI_API_KEY: API_KEY })?.model).toBe('text-embedding-3-small');
    expect(createEmbeddingProviderFromEnv({ OPENAI_API_KEY: API_KEY, OPENAI_EMBEDDING_MODEL: ' text-embedding-3-large ' })?.model).toBe('text-embedding-3-large');
    expect(createEmbeddingProviderFromEnv({ OPENAI_API_KEY: API_KEY, OPENAI_EMBEDDING_MODEL: '' })?.model).toBe('text-embedding-3-small');
  });
  it('the env model reaches the request body', async () => {
    // The factory takes no fetch: stub the global one so nothing leaves the process.
    const { fn, calls } = stubFetch();
    vi.stubGlobal('fetch', fn);
    const fromEnv = createEmbeddingProviderFromEnv({ OPENAI_API_KEY: API_KEY, OPENAI_EMBEDDING_MODEL: 'custom-embed' })!;
    await fromEnv.embed(['a']);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0].body).toEqual({ model: 'custom-embed', input: ['a'], encoding_format: 'float' });
  });
});
