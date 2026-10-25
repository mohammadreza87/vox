// Main-lineage (9a6751e) memory-v2-embeddings cases that pass against the chosen wave A embeddings.ts.
// Cases that could not be kept are listed in the S06 merge report.
// Default (jsdom) environment: src/test/setup.ts dereferences `window`, so a
// node-environment pragma fails before any test runs. The openai SDK refuses
// browser-like globals, so `navigator` is stubbed away to emulate a server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cosine, EMBEDDING_VERSION, FakeEmbeddingProvider, OpenAIEmbeddingProvider } from '../memory/embeddings';

const API_KEY = 'sk-test-SECRETKEY-0001';
const CANARY = 'CANARY-embedding-input-7f3a';

beforeEach(() => { vi.stubGlobal('navigator', undefined); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

type Call = { url: string; body: Record<string, unknown> };

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try { await promise; } catch (error) { return error as Error; }
  throw new Error('expected a rejection');
}

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
});

describe('OpenAIEmbeddingProvider (injected fetch, no network)', () => {
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

  it('an aborted signal rejects', async () => {
    const { fn } = stubFetch({ hang: true });
    const p = new OpenAIEmbeddingProvider({ apiKey: API_KEY, fetch: fn as unknown as typeof fetch });
    const controller = new AbortController();
    const pending = p.embed([CANARY], controller.signal);
    controller.abort();
    const error = await rejection(pending);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(CANARY);
    const already = new AbortController();
    already.abort();
    await expect(p.embed(['x'], already.signal)).rejects.toThrow();
  });
});
