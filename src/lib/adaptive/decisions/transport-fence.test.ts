import { expect, it, vi } from 'vitest';
import { OpenAIDecisionProvider, DECISIONS_MODEL, type DecisionInput } from '.';
const input: DecisionInput = { input: 'SYNTHETIC current final message', questions: [{ name: 'preference', type: 'predicate', instructions: 'Is there a preference?' }] };
const result = { model: DECISIONS_MODEL, answers: [{ name: 'preference', type: 'predicate', probability: 0.9 }] };
it('fences the actual installed SDK configured fetch after asynchronous preparation and isolates concurrent requests', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    expect(String(init?.body)).not.toMatch(/authorizeNow|AbortSignal|signal/);
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'gpt-6-luna' });
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  });
  const provider = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-no-secret', dangerouslyAllowBrowser: true }, fetcher);
  let allowed = true;
  const denied = provider.evaluate(input, new AbortController().signal, () => allowed);
  queueMicrotask(() => { allowed = false; });
  const permitted = provider.evaluate(input, new AbortController().signal, () => true);
  const settled = await Promise.allSettled([denied, permitted]);
  expect(settled[0].status).toBe('rejected'); expect(settled[1]).toMatchObject({ status: 'fulfilled', value: result }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['expiry', 'abort'] as const)('exports zero requests when %s changes during SDK preparation and never retries', async kind => {
  const fetcher = vi.fn<typeof fetch>(); const provider = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-only', dangerouslyAllowBrowser: true }, fetcher);
  let now = 1; const controller = new AbortController(); const pending = provider.evaluate(input, controller.signal, () => now < 2);
  queueMicrotask(() => { if (kind === 'expiry') now = 2; else controller.abort(); });
  await expect(pending).rejects.toBeDefined(); expect(fetcher).not.toHaveBeenCalled();
});
