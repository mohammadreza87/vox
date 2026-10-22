// The spec asked for the node test environment, but src/test/setup.ts
// touches `window` and fails outside jsdom. The OpenAI SDK refuses to run when
// it detects a browser (window + document + navigator), so each test hides
// `navigator` instead; the provider itself never sets dangerouslyAllowBrowser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cosine,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  EmbeddingError,
  embedMemory,
  FakeEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from '../memory/embeddings';
import { contentHash } from '../memory/record-v2';
import { memory } from './fixtures';

const KEY = 'sk-synthetic-test-key';
const CANARY = 'CANARY-embed-7f3a secret plan';

interface Captured { url: string; method?: string; headers: Headers; body: Record<string, unknown> }

function vectorOf(dimensions: number, seed: number): number[] {
  return Array.from({ length: dimensions }, (_, i) => ((seed + 1) * (i + 1)) % 7 / 7);
}

function okFetch(options: { dimensions?: number; reverse?: boolean; dropOne?: boolean; wrongDims?: boolean } = {}) {
  const calls: Captured[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? '{}')) as { input: string[]; dimensions: number };
    calls.push({ url, method: init?.method, headers: new Headers(init?.headers), body });
    const dims = options.wrongDims ? body.dimensions - 1 : body.dimensions;
    let data = body.input.map((_, index) => ({ object: 'embedding', index, embedding: vectorOf(dims, index) }));
    if (options.reverse) data = [...data].reverse();
    if (options.dropOne) data = data.slice(1);
    return new Response(JSON.stringify({ object: 'list', data, model: 'text-embedding-3-small', usage: { prompt_tokens: 1, total_tokens: 1 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  });
  return { fn, calls };
}

let globalFetch: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal('navigator', undefined);
  globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('network is not allowed in tests'); });
});
afterEach(() => {
  expect(globalFetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('OpenAIEmbeddingProvider', () => {
  it('POSTs /embeddings with the expected body and bearer key, and reorders by index', async () => {
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', '');
    const { fn, calls } = okFetch({ reverse: true });
    const provider = new OpenAIEmbeddingProvider({ apiKey: KEY, fetch: fn as unknown as typeof fetch });
    expect(provider.model).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(provider.version).toBe(EMBEDDING_VERSION);
    expect(provider.dimensions).toBe(1536);
    const out = await provider.embed(['alpha', 'beta', 'gamma']);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toMatch(/\/embeddings$/);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(calls[0].body).toEqual({ model: 'text-embedding-3-small', input: ['alpha', 'beta', 'gamma'], dimensions: 1536, encoding_format: 'float' });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual(vectorOf(1536, 0));
    expect(out[2]).toEqual(vectorOf(1536, 2));
  });

  it('chunks 300 inputs into two calls', async () => {
    const { fn, calls } = okFetch();
    const provider = new OpenAIEmbeddingProvider({ apiKey: KEY, fetch: fn as unknown as typeof fetch, dimensions: 8 });
    const out = await provider.embed(Array.from({ length: 300 }, (_, i) => `text ${i}`));
    expect(fn).toHaveBeenCalledTimes(2);
    expect((calls[0].body.input as string[]).length).toBe(256);
    expect((calls[1].body.input as string[]).length).toBe(44);
    expect(out).toHaveLength(300);
  });

  it('throws embedding_shape on a dimension or count mismatch', async () => {
    const wrong = okFetch({ wrongDims: true });
    await expect(new OpenAIEmbeddingProvider({ apiKey: KEY, fetch: wrong.fn as unknown as typeof fetch, dimensions: 8 }).embed(['a']))
      .rejects.toThrow(new EmbeddingError('embedding_shape'));
    const short = okFetch({ dropOne: true });
    await expect(new OpenAIEmbeddingProvider({ apiKey: KEY, fetch: short.fn as unknown as typeof fetch, dimensions: 8 }).embed(['a', 'b']))
      .rejects.toThrow(new EmbeddingError('embedding_shape'));
  });

  it('maps HTTP 500 to embedding_failed:500 once, without the input text', async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify({ error: { message: `server echoed ${CANARY}` } }), { status: 500, headers: { 'content-type': 'application/json' } }));
    const provider = new OpenAIEmbeddingProvider({ apiKey: KEY, fetch: fn as unknown as typeof fetch });
    const error = await provider.embed([CANARY]).catch((e: unknown) => e);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as Error).message).toBe('embedding_failed:500');
    expect((error as Error).name).toBe('EmbeddingError');
    expect(JSON.stringify(error)).not.toContain('CANARY');
    expect(String((error as Error).stack)).not.toContain('CANARY');
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('maps an abort to embedding_aborted', async () => {
    const controller = new AbortController();
    const fn = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const provider = new OpenAIEmbeddingProvider({ apiKey: KEY, fetch: fn as unknown as typeof fetch });
    const pending = provider.embed(['hello'], controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toThrow(new EmbeddingError('embedding_aborted'));
  });

  it('returns [] for empty input without a call, and rejects blank texts or too many inputs', async () => {
    const { fn } = okFetch();
    const provider = new OpenAIEmbeddingProvider({ apiKey: KEY, fetch: fn as unknown as typeof fetch });
    expect(await provider.embed([])).toEqual([]);
    await expect(provider.embed(['ok', '   '])).rejects.toThrow(new EmbeddingError('embedding_invalid_input'));
    await expect(provider.embed([''])).rejects.toThrow(new EmbeddingError('embedding_invalid_input'));
    await expect(provider.embed(Array.from({ length: 2049 }, () => 'x'))).rejects.toThrow(new EmbeddingError('embedding_invalid_input'));
    expect(fn).not.toHaveBeenCalled();
  });

  it('reads OPENAI_EMBEDDING_MODEL in the constructor', async () => {
    vi.stubEnv('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-large');
    const { fn, calls } = okFetch();
    const provider = new OpenAIEmbeddingProvider({ apiKey: KEY, fetch: fn as unknown as typeof fetch, dimensions: 8 });
    expect(provider.model).toBe('text-embedding-3-large');
    await provider.embed(['x']);
    expect(calls[0].body.model).toBe('text-embedding-3-large');
    expect(new OpenAIEmbeddingProvider({ apiKey: KEY, model: 'explicit' }).model).toBe('explicit');
  });
});

describe('FakeEmbeddingProvider and cosine', () => {
  it('is deterministic and unit-norm, and counts calls without storing text', async () => {
    const fake = new FakeEmbeddingProvider();
    const [a] = await fake.embed(['GameEnd launch date']);
    const [b] = await new FakeEmbeddingProvider().embed(['GameEnd launch date']);
    expect(a).toHaveLength(64);
    expect(a).toEqual(b);
    expect(Math.sqrt(a.reduce((s, v) => s + v * v, 0))).toBeCloseTo(1, 10);
    expect(cosine(a, b)).toBeCloseTo(1, 10);
    const [c] = await fake.embed(['completely different words']);
    expect(cosine(a, c)).toBeLessThan(0.9);
    expect(fake.calls).toBe(2);
    expect(JSON.stringify(fake)).not.toContain('GameEnd');
    expect(fake.model).toBe('fake-embedding');
    expect(new FakeEmbeddingProvider({ dimensions: 16, model: 'f2' })).toMatchObject({ dimensions: 16, model: 'f2' });
  });

  it('cosine returns 0 for mismatched lengths, empty and zero vectors', () => {
    expect(cosine([1, 0], [1, 0, 0])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1, 12);
  });
});

describe('embedMemory', () => {
  it('returns null for personal and confidential records without calling the provider', async () => {
    const fake = new FakeEmbeddingProvider();
    for (const sensitivity of ['personal', 'confidential'] as const) {
      expect(await embedMemory(memory({ content: CANARY, scope: { kind: 'private', personId: 'reza' }, sensitivity }), fake)).toBeNull();
    }
    expect(fake.calls).toBe(0);
  });

  it('returns embedding, model, version and contentHash for normal records', async () => {
    const fake = new FakeEmbeddingProvider();
    const m = memory({ content: 'GameEnd launch is Feb 20', scope: { kind: 'org' } });
    const out = await embedMemory(m, fake);
    const [expected] = await new FakeEmbeddingProvider().embed([m.content]);
    expect(out).toEqual({ embedding: expected, embeddingModel: 'fake-embedding', embeddingVersion: 1, contentHash: contentHash(m.content) });
  });
});
