import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnthropicLLM } from '../llm';
beforeEach(() => vi.stubGlobal('window', undefined));
afterEach(() => vi.unstubAllGlobals());
const body = { id: 'synthetic', type: 'message', role: 'assistant', model: 'synthetic', content: [{ type: 'text', text: 'safe draft' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
const request = { system: 'synthetic', messages: [{ role: 'user' as const, content: 'selected notes' }] };
it('checks committed authority inside the actual SDK configured transport after SDK preparation awaits', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
  const llm = new AnthropicLLM('synthetic-key', 'synthetic-model', fetcher);
  let allowed = true, checks = 0;
  await expect(llm.complete({ ...request, authorize: async () => true, authorizeNow: () => {
    checks++; if (checks === 1) queueMicrotask(() => { allowed = false; }); return allowed;
  } })).rejects.toThrow();
  expect(checks).toBeGreaterThanOrEqual(2); expect(fetcher).not.toHaveBeenCalled();
});
it('keeps concurrent request authority isolated and signal abort prevents real fetch', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
  const llm = new AnthropicLLM('synthetic-key', 'synthetic-model', fetcher);
  const [denied, accepted] = await Promise.allSettled([llm.complete({ ...request, authorizeNow: () => false }), llm.complete({ ...request, authorizeNow: () => true })]);
  expect(denied.status).toBe('rejected'); expect(accepted).toMatchObject({ status: 'fulfilled', value: 'safe draft' }); expect(fetcher).toHaveBeenCalledOnce();
  const abort = new AbortController(); let checks = 0;
  await expect(llm.complete({ ...request, signal: abort.signal, authorizeNow: () => { if (++checks === 1) queueMicrotask(() => abort.abort()); return true; } })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('authorizeNow');
});
