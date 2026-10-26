/**
 * H3 (F001, F030, F075, F095, F114, F134, F187): provider-side timeouts reach the
 * decision log as reason 'timeout' through structuralTimeouts(), the wrapper the
 * S09 triage wiring puts around its provider. Structural classification only
 * (no instanceof across bundles). DecisionService itself is main's and unchanged.
 * No network: every fetch is an injected fake.
 */
import { describe, expect, it, vi } from 'vitest';
import OpenAI, { APIConnectionTimeoutError } from 'openai';
import {
  DecisionService, OpenAIDecisionProvider, structuralTimeouts,
  type DecisionContext, type DecisionInput, type DecisionProvider,
} from '../../adaptive/decisions';

const input: DecisionInput = { input: 'SYNTHETIC message', questions: [{ type: 'predicate', name: 'q0', instructions: 'Q?' }] };
const context = (overrides: Partial<DecisionContext> = {}): DecisionContext => ({
  enabled: true, revision: 0, currentRevision: () => 0, authorize: async () => 'k', loadInput: async () => input, deadlineMs: 2000, ...overrides,
});
const throwing = (error: unknown): DecisionProvider => ({ evaluate: async () => { throw error; } });
type Fetch = typeof globalThis.fetch;

describe('structuralTimeouts', () => {
  it.each<[string, () => unknown]>([
    ['the SDK APIConnectionTimeoutError (name is Error)', () => new APIConnectionTimeoutError()],
    ['a DOMException-like TimeoutError', () => Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })],
    ['an ETIMEDOUT socket error', () => Object.assign(new Error('connect failed'), { code: 'ETIMEDOUT' })],
    ['an undici header timeout', () => Object.assign(new Error('fetch failed'), { code: 'UND_ERR_HEADERS_TIMEOUT' })],
    ['a plain "timed out" message', () => new Error('Request timed out.')],
  ])('%s becomes reason timeout', async (_label, make) => {
    expect((make() as Error).name === 'APIConnectionTimeoutError').toBe(false);
    const result = await new DecisionService(structuralTimeouts(throwing(make()))).evaluate(context());
    expect(result).toMatchObject({ status: 'unknown', reason: 'timeout' });
  });

  it('a 500 stays provider_error, a 429 rate_limited and a 404 unsupported', async () => {
    for (const [status, reason] of [[500, 'provider_error'], [429, 'rate_limited'], [404, 'unsupported']] as const) {
      const error = Object.assign(new Error('500 status code (no body)'), { status });
      expect(await new DecisionService(structuralTimeouts(throwing(error))).evaluate(context())).toMatchObject({ status: 'unknown', reason });
    }
  });

  it('passes other errors through unchanged, by identity', async () => {
    const original = new TypeError('broken builder');
    await expect(structuralTimeouts(throwing(original)).evaluate(input, new AbortController().signal)).rejects.toBe(original);
    const odd = { weird: true };
    await expect(structuralTimeouts(throwing(odd)).evaluate(input, new AbortController().signal)).rejects.toBe(odd);
  });

  it('the rethrown timeout carries no provider message', async () => {
    const error = await structuralTimeouts(throwing(new Error('timed out PRIVATE_CANARY'))).evaluate(input, new AbortController().signal).then(() => null, (e: unknown) => e);
    expect(error).toMatchObject({ name: 'APIConnectionTimeoutError' });
    expect(String((error as Error).message)).not.toContain('PRIVATE_CANARY');
  });

  it('forwards arguments and the result unchanged', async () => {
    const evaluate = vi.fn<DecisionProvider['evaluate']>(async () => 'raw');
    const signal = new AbortController().signal;
    const authorizeNow = () => true;
    const options = { timeoutMs: 20, safetyIdentifier: 'vox_0123' };
    expect(await structuralTimeouts({ evaluate }).evaluate(input, signal, authorizeNow, options)).toBe('raw');
    expect(evaluate).toHaveBeenCalledWith(input, signal, authorizeNow, options);
  });

  it('preserves committedExportFence: authorizeAtTransport contexts are not refused as unsupported', async () => {
    const fetcher = vi.fn<Fetch>(async () => new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } }));
    const guarded = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-only', dangerouslyAllowBrowser: true }, fetcher);
    const wrapped = structuralTimeouts(guarded);
    expect(wrapped.committedExportFence).toBe(true);
    expect(new DecisionService(wrapped).committedExportFence).toBe(true);
    const result = await new DecisionService(wrapped).evaluate(context({ authorizeAtTransport: async () => 'k' }));
    expect(result).not.toMatchObject({ reason: 'unsupported' });
    expect(result).toMatchObject({ status: 'unknown', reason: 'provider_error' });
    expect(fetcher).toHaveBeenCalledOnce();
    // An unguarded provider still has no fence, wrapped or not.
    expect(structuralTimeouts(throwing(new Error('x'))).committedExportFence).toBeUndefined();
    expect(await new DecisionService(structuralTimeouts(throwing(new Error('x')))).evaluate(context({ authorizeAtTransport: async () => 'k' })))
      .toMatchObject({ reason: 'unsupported' });
  });

  it('F001: a real SDK timeout shorter than the service deadline is reported as timeout', async () => {
    const fetch = vi.fn<Fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
      const aborted = () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
      if (init?.signal?.aborted) aborted();
      init?.signal?.addEventListener('abort', aborted, { once: true });
    }));
    const sdk = new OpenAIDecisionProvider(new OpenAI({ apiKey: 'synthetic-only', fetch, maxRetries: 0, dangerouslyAllowBrowser: true }));
    // The provider's own 20 ms timeout fires well before the service's 2000 ms deadline.
    const short: DecisionProvider = { evaluate: (i, s, a, o) => sdk.evaluate(i, s, a, { ...o, timeoutMs: 20 }) };
    expect(await new DecisionService(short).evaluate(context())).toMatchObject({ status: 'unknown', reason: 'provider_error' });
    expect(await new DecisionService(structuralTimeouts(short)).evaluate(context())).toMatchObject({ status: 'unknown', reason: 'timeout' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
