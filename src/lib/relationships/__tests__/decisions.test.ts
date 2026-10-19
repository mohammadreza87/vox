import { describe, expect, it, vi } from 'vitest';
import { OpenAIDecisions } from '../decisions';
const input = { context: 'Authorized synthetic situation', phase: 'reconsider' as const, now: new Date('2026-10-19T12:00:00Z') };
describe('Decisions adapter', () => {
  it('uses the REST choice contract and a bounded input with a timeout', async () => {
    const fetcher = vi.fn(async () => Response.json({ answers: [{ type: 'choice', name: 'outreach', choice: 'send', confidence: 0.9 }] }));
    expect(await new OpenAIDecisions('not-a-real-key', fetcher).choose({ ...input, context: 'a'.repeat(50000) })).toBe('send');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(url).toBe('https://api.openai.com/v1/decisions'); const data = JSON.parse(init.body as string); expect(data.model).toBe('gpt-6-luna'); expect(data.questions[0].type).toBe('choice'); expect(data.input.length).toBeLessThan(25000); expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([{ answers: [{ type: 'refusal', name: 'outreach' }] }, { answers: [{ type: 'choice', name: 'outreach', choice: 'send', confidence: 0.3 }] }, { answers: [{ type: 'choice', name: 'outreach', choice: 'invented', confidence: 0.99 }] }])('fails quiet on refusal, uncertainty or unsupported action', async (data) => { expect(await new OpenAIDecisions('test', async () => Response.json(data)).choose(input)).toBe('stay_quiet'); });
  it.each([{ choice: 'send', confidence: 0.63 }, { choice: 'defer', confidence: 0.51 }])('keeps moderate positive evidence available for bounded reconsideration: $choice', async (answer) => {
    expect(await new OpenAIDecisions('test', async () => Response.json({ answers: [{ type: 'choice', name: 'outreach', ...answer }] })).choose(input)).toBe('defer');
  });
  it('does not surface raw provider errors', async () => { await expect(new OpenAIDecisions('test', async () => new Response('sensitive provider error', { status: 429 })).choose(input)).rejects.toThrow('Decisions request failed (429)'); });
  it('bounds a fetch implementation that does not honor AbortSignal', async () => {
    await expect(new OpenAIDecisions('test', () => new Promise<Response>(() => undefined), 10).choose(input)).rejects.toThrow('timed out');
  });
  it('fails quiet on an invalid answer collection', async () => {
    expect(await new OpenAIDecisions('test', async () => Response.json({ answers: {} })).choose(input)).toBe('stay_quiet');
  });
  it('caps the actual response body', async () => { await expect(new OpenAIDecisions('test', async () => new Response('x'.repeat(70000))).choose(input)).rejects.toThrow('exceeds limit'); });
});
