import { afterEach, expect, it, vi } from 'vitest';
import { experienceApi } from './experience-client';
import { preferenceLearningApi } from './preference-learning-client';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(['ordinary', 'learning'] as const)('retries only the named %s GET conflict, preserving exact scope and cancellation', async kind => {
  vi.useFakeTimers(); const code = kind === 'ordinary' ? 'preference_authority_changed' : 'preference_learning_changed';
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: code }, { status: 409 })).mockResolvedValueOnce(Response.json({ revision: 12 })); vi.stubGlobal('fetch', fetcher);
  const pending = kind === 'ordinary' ? experienceApi.preferenceState('personal', 'agent-1') : preferenceLearningApi.read('personal', 'agent-1');
  await vi.advanceTimersByTimeAsync(40); expect(await pending).toEqual({ revision: 12 }); expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [path, options] of fetcher.mock.calls) { expect(path).toContain('space=personal&agentId=agent-1'); expect(options.method).toBe('GET'); expect(options.signal).toBeInstanceOf(AbortSignal); }
});
it.each([[403,'agent_access_denied'],[503,'experience_unavailable'],[503,'preference_projection_unavailable'],[409,'revision_conflict'],[409,'preference_learning_changed'],[429,'rate_limited']] as const)('does not retry ordinary GET %s/%s', async (status, code) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: code }, { status })); vi.stubGlobal('fetch', fetcher);
  await expect(experienceApi.preferenceState('work', 'agent')).rejects.toMatchObject({ status, message: code }); expect(fetcher).toHaveBeenCalledOnce();
});
it('bounds conflicts to three reads and never retries a mutation with the same transient code', async () => {
  vi.useFakeTimers(); const fetcher = vi.fn().mockImplementation(async () => Response.json({ error: 'preference_learning_changed' }, { status: 409 })); vi.stubGlobal('fetch', fetcher);
  const pending = preferenceLearningApi.read('work','agent'); const rejected = expect(pending).rejects.toMatchObject({ status:409 }); await vi.advanceTimersByTimeAsync(120); await rejected; expect(fetcher).toHaveBeenCalledTimes(3);
  fetcher.mockClear(); await expect(preferenceLearningApi.present({ space:'work',agentId:'agent',expectedRevision:1,eventId:'event-id-1',locale:'en' })).rejects.toMatchObject({ status:409 }); expect(fetcher).toHaveBeenCalledOnce();
});
it('aborts during backoff without another export, and bounds an abort-ignoring transport by total deadline', async () => {
  vi.useFakeTimers(); const controller = new AbortController(), fetcher = vi.fn().mockImplementation(async () => Response.json({ error:'preference_learning_changed' },{status:409})); vi.stubGlobal('fetch',fetcher);
  const pending = preferenceLearningApi.read('work','agent',controller.signal), rejected = expect(pending).rejects.toMatchObject({ name:'AbortError' }); await vi.advanceTimersByTimeAsync(1); controller.abort(); await rejected; await vi.advanceTimersByTimeAsync(500); expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockClear().mockImplementation(()=>new Promise(()=>{})); const hung = experienceApi.preferenceState('work','agent'), timed = expect(hung).rejects.toMatchObject({name:'AbortError'}); await vi.advanceTimersByTimeAsync(1500); await timed; expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true); expect(fetcher).toHaveBeenCalledOnce();
});
