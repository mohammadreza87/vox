import { isSchemaValidationError } from '../../error-contract';
import { z } from 'zod';
import { canUseAgent } from '../../studio/permissions';
import { verifyInitData } from '../../studio/auth';
import { boundedStudioRequest } from '../../studio/http';
import { StudioError, type Studio } from '../../studio/service';
import { StudioRateLimiter, StudioRateLimitError } from '../../studio/ratelimit';
import { AdaptiveError, type AdaptiveService } from './service';
import { agentGrantInput, consentInput, deletionInput, identityInput, memoryInput, presentInput, spaceInput } from './validation';
import { ReviewedMemoryService } from '../reviewed-memory/service';
import { reviewedPreviewInputSchema, reviewedAcceptInputSchema } from '../reviewed-memory/contracts';
import { digest } from './repository';
const response = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});
const fallbackLimiters = new WeakMap<Studio, StudioRateLimiter>();
/** Same cryptographic Telegram authentication as Studio; no development impersonation. */
export async function handleAdaptiveRequest(studio: Studio, service: AdaptiveService, request: Request, path: string[], botToken: string): Promise<Response> {
  try {
    let limiter = studio.deps.rateLimiter ?? fallbackLimiters.get(studio);
    if (!limiter) { const local = new StudioRateLimiter(); fallbackLimiters.set(studio, local); limiter = local; }
    await limiter.consume('ingress', 'all');
    const initData = request.headers.get('x-telegram-init-data') ?? '';
    if (initData.length > 16_384) return response({ error: 'authentication_required' }, 401);
    const user = verifyInitData(initData, botToken);
    if (!user) return response({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    const member = await studio.ensureMember(user);
    if (member.role === 'pending') return response({ error: 'approval_required' }, 403);
    const url = new URL(request.url);
    const space = spaceInput.parse(url.searchParams.get('space') ?? 'work');
    const locale = z.enum(['en', 'fa']).parse(url.searchParams.get('locale') ?? 'en');
    if (request.method === 'GET' && path.length === 0) return response(await service.read(user.id, space, locale));
    if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return response({ error: 'not_found' }, 404);
    // Authenticated browser mutation must originate from this origin, not a hostile page.
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return response({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return response({ error: 'json_required' }, 415);
    await limiter.consume('mutation', user.id);
    const bounded = await boundedStudioRequest(request, path[0] === 'reviewed' ? 16_384 : 8192);
    let body: unknown;
    try { body = await bounded.json(); } catch { return response({ error: 'invalid_json' }, 400); }
    const route = `${request.method} ${path.join('/')}`;
    if (route === 'POST reviewed/preview' || route === 'POST reviewed/accept') {
      const authority = (state: Awaited<ReturnType<Studio['deps']['store']['read']>>, agentId: string) => {
        const actor = state.members.find(member => member.telegramId === user.id), agent = state.agents.find(agent => agent.id === agentId);
        const validEpoch = (row: { learningAuthorityRevision?: number }) => row.learningAuthorityRevision === undefined ||
          (Number.isSafeInteger(row.learningAuthorityRevision) && row.learningAuthorityRevision >= 0);
        return actor && agent && validEpoch(actor) && validEpoch(agent) && !(agent.blocked ?? []).includes(user.id) && canUseAgent(actor, agent) ? digest([actor, agent]) : null;
      };
      const reviewed = new ReviewedMemoryService(service, { llm: studio.deps.chatLLM, secret: studio.deps.secret,
        now: () => studio.deps.now?.().getTime() ?? Date.now(),
        agentAuthority: async (_id, agentId) => authority(await studio.deps.store.read(), agentId),
        agentAuthorityNow: (_id, agentId) => { const state = studio.deps.store.readCommittedForEffect?.(); return state ? authority(state, agentId) : null; },
      });
      await limiter.consume('expensive', user.id);
      if (route === 'POST reviewed/preview') {
        const input = reviewedPreviewInputSchema.parse(body), preview = await reviewed.preview(user.id, input, request.signal);
        reviewed.revalidateNow(user.id, { space: input.space, agentId: input.agentId, text: preview.text, receipt: preview.receipt });
        return response(preview);
      }
      const input = reviewedAcceptInputSchema.parse(body);
      const saved = await reviewed.accept(user.id, input);
      const snapshot = await service.read(user.id, input.space, locale);
      reviewed.revalidateNow(user.id, input);
      return response({ ...saved, snapshot }, 201);
    }
    if (route === 'POST identity') return response(await service.confirm(user.id, identityInput.parse(body), space));
    if (route === 'POST consents/present') return response(await service.present(user.id, presentInput.parse(body)));
    if (route === 'PUT consents') return response(await service.changeConsent(user.id, consentInput.parse(body)));
    if (route === 'POST memories') return response(await service.createMemory(user.id, memoryInput.parse(body)), 201);
    if (request.method === 'PUT' && path.length === 2 && path[0] === 'agents' && /^[a-zA-Z0-9_-]{1,100}$/.test(path[1])) {
      const input = agentGrantInput.parse(body);
      if (input.allowed) {
        const current = await studio.deps.store.read();
        const actor = current.members.find(m => m.telegramId === user.id);
        const agent = current.agents.find(a => a.id === path[1]);
        if (!agent || !canUseAgent(actor, agent)) return response({ error: 'agent_access_denied' }, 403);
      }
      return response(await service.setAgentAccess(user.id, path[1], input));
    }
    if (request.method === 'DELETE' && path.length === 2 && path[0] === 'memories' && /^[a-zA-Z0-9-]{1,100}$/.test(path[1])) {
      return response(await service.deleteMemory(user.id, path[1], deletionInput.parse(body)));
    }
    return response({ error: 'not_found' }, 404);
  } catch (error) {
    if (isSchemaValidationError(error)) return response({ error: 'invalid_request' }, 400);
    if (AdaptiveError.is(error)) return response({ error: error.code }, error.status);
    if (StudioError.is(error)) return response({ error: 'invalid_request' }, error.status);
    if (StudioRateLimitError.is(error)) return response({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    // Never return datastore errors, payloads, private text or validation internals.
    return response({ error: 'adaptive_unavailable' }, 503);
  }
}
