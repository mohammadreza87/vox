import { z } from 'zod';
import { personId } from '../../studio/org-bridge';
import { canUseAgent } from '../../studio/permissions';
import { verifyInitData } from '../../studio/auth';
import { boundedStudioRequest } from '../../studio/http';
import { StudioError, type Studio } from '../../studio/service';
import { StudioRateLimiter, StudioRateLimitError } from '../../studio/ratelimit';
import { AdaptiveError } from '../persistence/service';
import { experienceSpaceSchema, feedbackInputSchema, predictionCancelSchema, predictionValidateSchema, predictInputSchema, preferenceInputSchema, reminderInputSchema, settingsInputSchema, type ExperienceSnapshot } from './contracts';
import type { AdaptiveExperienceService } from './service';
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});
const localLimiters = new WeakMap<Studio, StudioRateLimiter>();
export async function handleExperienceRequest(studio: Studio, service: AdaptiveExperienceService, request: Request, path: string[], botToken: string): Promise<Response> {
  try {
    if (!botToken.trim()) return json({ error: 'experience_unavailable' }, 503);
    let limiter = studio.deps.rateLimiter ?? localLimiters.get(studio);
    if (!limiter) { const local = new StudioRateLimiter(); localLimiters.set(studio, local); limiter = local; }
    await limiter.consume('ingress', 'all');
    const initData = request.headers.get('x-telegram-init-data') ?? '';
    if (initData.length > 16_384) return json({ error: 'authentication_required' }, 401);
    const user = verifyInitData(initData, botToken);
    if (!user) return json({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    const member = await studio.ensureMember(user);
    if (member.role === 'pending') return json({ error: 'approval_required' }, 403);
    const url = new URL(request.url), space = experienceSpaceSchema.parse(url.searchParams.get('space') ?? 'work');
    const canAccess = async (agentId: string): Promise<boolean> => {
      const state = await studio.deps.store.read();
      return state.agents.some(agent => agent.id === agentId && !(agent.blocked ?? []).includes(user.id) && canUseAgent(state.members.find(m => m.telegramId === user.id), agent));
    };
    const snapshotResponse = async (snapshot: ExperienceSnapshot, status = 200): Promise<Response> => {
      const current = await service.read(user.id, snapshot.space);
      const state = await studio.deps.store.read();
      const ids = new Set(state.agents.filter(agent => !(agent.blocked ?? []).includes(user.id) && canUseAgent(state.members.find(m => m.telegramId === user.id), agent)).map(a => a.id));
      // Recheck Studio access after loading private content; serialize without
      // another awaited content load. Cross-store atomicity is a release gate.
      current.preferences = current.preferences.filter(p => ids.has(p.agentId));
      current.inbox = current.inbox.filter(i => ids.has(i.agentId));
      return json(current, status);
    };
    if (request.method === 'GET' && path.length === 0) return await snapshotResponse(await service.read(user.id, space));
    if (!['POST', 'PUT'].includes(request.method)) return json({ error: 'not_found' }, 404);
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    await limiter.consume('mutation', user.id);
    let body: unknown;
    const bounded = await boundedStudioRequest(request, path.join('/') === 'predict' ? 96_000 : 16_384);
    try { body = await bounded.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const route = `${request.method} ${path.join('/')}`;
    if (route === 'PUT settings') return await snapshotResponse(await service.settings(user.id, settingsInputSchema.parse(body)));
    if (route === 'PUT preferences') {
      const input = preferenceInputSchema.parse(body);
      if (!await canAccess(input.agentId)) return json({ error: 'agent_access_denied' }, 403);
      return await snapshotResponse(await service.savePreference(user.id, input));
    }
    if (route === 'POST feedback') return await snapshotResponse(await service.feedback(user.id, feedbackInputSchema.parse(body)));
    if (route === 'POST reminders') {
      const input = reminderInputSchema.parse(body);
      if (!await canAccess(input.agentId)) return json({ error: 'agent_access_denied' }, 403);
      return await snapshotResponse(await service.reminder(user.id, input), 201);
    }
    if (route === 'POST prediction-validate') {
      const input = predictionValidateSchema.parse(body);
      return json(await service.validatePrediction(user.id, input, () => canAccess(input.agentId)));
    }
    if (route === 'POST prediction-cancel') {
      return json(await service.cancelPrediction(user.id, predictionCancelSchema.parse(body)));
    }
    if (route === 'POST predict') {
      const input = predictInputSchema.parse(body);
      if (!await canAccess(input.agentId)) return json({ error: 'agent_access_denied' }, 403);
      await limiter.consume('expensive', user.id);
      const result = await service.predict(user.id, input, request.signal, () => canAccess(input.agentId));
      if (result.status !== 'answered' || !result.policyReceipt) return json(result);
      const scope = { space: input.space, agentId: input.agentId, sessionId: input.sessionId, turnId: input.turnId,
        revision: input.revision, contextKey: input.contextKey, policyReceipt: result.policyReceipt };
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) controller.abort();
      const authorize = async () => {
        if (controller.signal.aborted) return false;
        const current = await service.validatePrediction(user.id, scope, () => canAccess(input.agentId));
        return !controller.signal.aborted && current.valid;
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let preparedContext = false;
      try {
        const preparation = async () => {
          if (!await authorize()) return false;
          const { gateway } = await studio.gateway();
          if (!await authorize()) return false;
          return gateway.prepareContext(input.agentId, personId(user.id), input.text, { space: input.space, authorize });
        };
        preparedContext = await Promise.race([preparation().catch(() => false), new Promise<boolean>(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve(false); }, 250);
        })]);
      } finally {
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener('abort', abort);
      }
      // Timeout disables preparation, while the original semantic result may
      // remain usable. All awaited work precedes this authoritative final check.
      if (request.signal.aborted || !(await service.validatePrediction(user.id, scope, () => canAccess(input.agentId))).valid) {
        return json({ status: 'unknown', reason: 'stale', elapsedMs: result.elapsedMs, inputTokens: result.inputTokens });
      }
      return json({ ...result, preparedContext });
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'invalid_request' }, 400);
    if (error instanceof AdaptiveError) return json({ error: error.code }, error.status);
    if (StudioError.is(error)) return json({ error: 'invalid_request' }, error.status);
    if (error instanceof StudioRateLimitError) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    return json({ error: 'experience_unavailable' }, 503);
  }
}
