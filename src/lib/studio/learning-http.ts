import { trustedStudioRequestOrigin } from './request-origin';
import { isSchemaValidationError } from '../error-contract';
import { z } from 'zod';
import { AdaptiveError } from '../adaptive/persistence/service';
import { SharedMemoryError } from '../adaptive/shared/service';
import { clientObservationInputSchema, correctionObservationInputSchema } from '../adaptive/observation/contracts';
import { digest } from '../adaptive/persistence/repository';
import { verifyInitData } from './auth';
import { boundedStudioRequest } from './http';
import { observationAgents } from './observation';
import { StudioError, type Studio } from './service';
import { StudioRateLimiter, StudioRateLimitError } from './ratelimit';
const localLimiters = new WeakMap<Studio, StudioRateLimiter>();
const spaceSchema = z.enum(['work', 'personal']);
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});

/** Reads only the authenticated person's data. Operations reports contain no
 * conversations and grant no evaluator, approval or deployment capability. */
export async function handleLearningRequest(studio: Studio, request: Request, path: string[], botToken: string): Promise<Response> {
  try {
    if (!botToken.trim()) return json({ error: 'learning_unavailable' }, 503);
    let limiter = studio.deps.rateLimiter ?? localLimiters.get(studio);
    if (!limiter) { const local = new StudioRateLimiter(); localLimiters.set(studio, local); limiter = local; }
    await limiter.consume('ingress', 'all');
    const initData = request.headers.get('x-telegram-init-data') ?? '';
    if (initData.length > 16_384) return json({ error: 'authentication_required' }, 401);
    const user = verifyInitData(initData, botToken);
    if (!user) return json({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    await studio.ensureMember(user);
    const currentMember = async () => (await studio.deps.store.read()).members.find(m => m.telegramId === user.id);
    const member = await currentMember();
    if (!member || member.role === 'pending') return json({ error: 'approval_required' }, 403);
    const url = new URL(request.url), route = path.join('/');
    const space = spaceSchema.parse(url.searchParams.get('space') ?? 'work');
    const snapshot = async () => {
      const observer = studio.deps.observer;
      if (!observer) return json({ error: 'observer_unavailable' }, 503);
      const allowedAgentIds = await observationAgents(studio, user.id);
      const data = await observer.snapshot(user.id, space, { allowedAgentIds });
      const latest = await observationAgents(studio, user.id);
      const latestMember = await currentMember();
      if (!latestMember || latestMember.role === 'pending' || digest(latest) !== digest(allowedAgentIds)) return json({ error: 'access_changed' }, 409);
      return json(data);
    };
    if (request.method === 'GET') {
      if (route === 'observations') return await snapshot();
      if (route === 'export') {
        if (!studio.deps.lifecycle) return json({ error: 'export_unavailable' }, 503);
        const prepared = await studio.deps.lifecycle.prepareAccountExport(user.id, space);
        const latest = await currentMember();
        if (!latest || latest.role === 'pending') return json({ error: 'access_changed' }, 409);
        const serialized = JSON.stringify(prepared.data);
        const checkRequester = (): Response | undefined => {
          if (verifyInitData(initData, botToken)?.id !== user.id) return json({ error: 'authentication_required' }, 401);
          const state = studio.deps.store.readCommittedForEffect?.();
          if (!state) return json({ error: 'export_unavailable' }, 503);
          const members = state.members.filter(m => m.telegramId === user.id);
          if (members.length !== 1 || !['member', 'admin', 'owner', 'superadmin'].includes(members[0].role)) return json({ error: 'access_changed' }, 409);
          if (verifyInitData(initData, botToken)?.id !== user.id) return json({ error: 'authentication_required' }, 401);
        };
        // Serialize before the final synchronous source/auth checks. No awaited
        // membership read can reopen a gap between this fence and publication.
        const denied = checkRequester(); if (denied) return denied;
        prepared.revalidate();
        const changed = checkRequester(); if (changed) return changed;
        return new Response(serialized, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="vox-${space}-export.json"` } });
      }
      if (route === 'operations') {
        if (!['owner', 'superadmin'].includes(member.role)) return json({ error: 'access_denied' }, 403);
        const report = studio.deps.improvement ? await studio.deps.improvement.report() : null;
        const latest = await currentMember();
        if (!latest || !['owner', 'superadmin'].includes(latest.role)) return json({ error: 'access_changed' }, 409);
        return json({ maintenanceConfigured: !!studio.deps.maintenance, improvementConfigured: !!studio.deps.improvement, report });
      }
      return json({ error: 'not_found' }, 404);
    }
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    const expectedOrigin = trustedStudioRequestOrigin(url, studio.deps.webAppUrl);
    if (!expectedOrigin) return json({ error: 'origin_unavailable' }, 503);
    if (request.headers.get('origin') !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    await limiter.consume('mutation', user.id);
    const bounded = await boundedStudioRequest(request, 16_384);
    let body: unknown;
    try { body = await bounded.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const observer = studio.deps.observer;
    if (!observer) return json({ error: 'observer_unavailable' }, 503);
    if (route === 'correction-authority') {
      const input = z.object({ space: spaceSchema }).strict().parse(body);
      return json({ policyReceipt: await observer.authorizeCorrection(user.id, input.space) });
    }
    if (route === 'corrections') return json(await observer.recordCorrection(user.id, correctionObservationInputSchema.parse(body)));
    if (route === 'events') {
      const input = clientObservationInputSchema.parse(body);
      if (!(await observationAgents(studio, user.id)).includes(input.agentId)) return json({ error: 'agent_access_denied' }, 403);
      return json(await observer.recordClient(user.id, input));
    }
    if (route === 'observations/process') {
      z.object({}).strict().parse(body);
      await observer.process(user.id, { limit: 20, allowedAgentIds: await observationAgents(studio, user.id) });
      return await snapshot();
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    if (isSchemaValidationError(error)) return json({ error: 'invalid_request' }, 400);
    if (AdaptiveError.is(error)) return json({ error: error.code }, error.status);
    if (SharedMemoryError.is(error)) return json({ error: error.code }, error.status);
    if (StudioError.is(error)) return json({ error: 'invalid_request' }, error.status);
    if (StudioRateLimitError.is(error)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    return json({ error: 'learning_unavailable' }, 503);
  }
}
