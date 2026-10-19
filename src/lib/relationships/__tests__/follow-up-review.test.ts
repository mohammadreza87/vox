import { describe, expect, it, vi } from 'vitest';
import { OpenAIFollowUpReview, routeFollowUpReview } from '../follow-up-review';

const input = { context: 'Authorized private context', candidate: 'How are things with the project?', phase: 'reconsider' as const, now: new Date('2026-10-19T12:00:00Z') };
const result = (continuity = .98, violation = .01) => ({ answers: [
  { type: 'predicate', name: 'meaningful_continuity', probability: continuity },
  { type: 'predicate', name: 'content_violation', probability: violation },
] });
describe('exact follow-up review', () => {
  it('requires both well-formed independent criteria, with conservative fixed boundaries', () => {
    expect(routeFollowUpReview(result(.8, .1))).toBe('send');
    expect(routeFollowUpReview(result(.799, 0))).toBe('stay_quiet');
    expect(routeFollowUpReview(result(1, .101))).toBe('stay_quiet');
    for (const invalid of [null, {}, result(NaN), result(1.1), { answers: result().answers.slice(0, 1) }, { answers: [...result().answers, result().answers[0]] }, { answers: [{ type: 'refusal', name: 'meaningful_continuity' }, result().answers[1]] }]) expect(routeFollowUpReview(invalid)).toBe('stay_quiet');
  });
  it('keeps the exact draft outside the bounded history and never evaluates missing drafts', async () => {
    const fetcher = vi.fn(async () => Response.json(result()));
    const review = new OpenAIFollowUpReview('synthetic', fetcher);
    expect(await review.choose({ ...input, context: 'x'.repeat(40000) })).toBe('send');
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(init.body as string); const evidence = JSON.parse(body.input);
    expect(evidence.authorizedContext.length).toBe(24000);
    expect(evidence.exactCandidate).toBe(input.candidate);
    expect(body.questions.map((q: { name: string }) => q.name)).toEqual(['meaningful_continuity', 'content_violation']);
    expect(await review.choose({ ...input, candidate: undefined })).toBe('stay_quiet');
    expect(await review.choose({ ...input, phase: 'observe' })).toBe('stay_quiet');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('bounds hung custom transports, response size, and error disclosure', async () => {
    await expect(new OpenAIFollowUpReview('x', async () => new Promise<Response>(() => undefined), 10).choose(input)).rejects.toThrow('timed out');
    await expect(new OpenAIFollowUpReview('x', async () => new Response('x'.repeat(65537))).choose(input)).rejects.toThrow('exceeds limit');
    await expect(new OpenAIFollowUpReview('x', async () => new Response('PRIVATE PROVIDER BODY', { status: 503 })).choose(input)).rejects.toThrow('Follow-up review failed (503)');
    await expect(new OpenAIFollowUpReview('x', async () => new Response('private invalid JSON')).choose(input)).rejects.toThrow('invalid JSON');
  });
});
