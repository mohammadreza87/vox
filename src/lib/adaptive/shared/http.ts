import { trustedStudioRequestOrigin } from '../../studio/request-origin';
import { isSchemaValidationError } from '../../error-contract';
import { z } from 'zod';
import { verifyInitData } from '../../studio/auth';
import { boundedStudioRequest } from '../../studio/http';
import { StudioError, type Studio } from '../../studio/service';
import { StudioRateLimiter, StudioRateLimitError } from '../../studio/ratelimit';
import { AdaptiveError } from '../persistence/service';
import { SharedMemoryError, type SharedMemoryService } from './service';
import type { SharedAgentInput, SharedCreateInput, SharedMemoryInput, SharedMutation, SharedParticipantInput, SharedPreviewInput } from './contracts';
const response = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});
const fallbackLimiters = new WeakMap<Studio, StudioRateLimiter>();
export async function handleSharedRequest(studio: Studio, service: SharedMemoryService, request: Request, path: string[], botToken: string): Promise<Response> {
  try {
    let limiter = studio.deps.rateLimiter ?? fallbackLimiters.get(studio);
    if (!limiter) { const local = new StudioRateLimiter(); fallbackLimiters.set(studio, local); limiter = local; }
    await limiter.consume('ingress', 'all');
    const init = request.headers.get('x-telegram-init-data') ?? '';
    if (init.length > 16_384) return response({ error: 'authentication_required' }, 401);
    const actor = verifyInitData(init, botToken);
    if (!actor) return response({ error: 'authentication_required' }, 401);
    await limiter.consume('api', actor.id);
    const member = await studio.ensureMember(actor);
    if (member.role === 'pending') return response({ error: 'approval_required' }, 403);
    const url = new URL(request.url);
    const space = z.enum(['work', 'personal']).parse(url.searchParams.get('space') ?? 'work');
    if (request.method === 'GET' && path.length === 0) return response(await service.list(actor.id, space));
    if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return response({ error: 'not_found' }, 404);
    const expectedOrigin = trustedStudioRequestOrigin(url, studio.deps.webAppUrl);
    if (!expectedOrigin) return response({ error: 'origin_unavailable' }, 503);
    if (request.headers.get('origin') !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return response({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return response({ error: 'json_required' }, 415);
    await limiter.consume('mutation', actor.id);
    const bounded = await boundedStudioRequest(request, 8192);
    let body: unknown;
    try { body = await bounded.json(); } catch { return response({ error: 'invalid_json' }, 400); }
    if (request.method === 'POST' && path.join('/') === 'preview') return response(await service.preview(actor.id, body as SharedPreviewInput));
    if (request.method === 'POST' && path.join('/') === 'containers') return response(await service.create(actor.id, body as SharedCreateInput), 201);
    if (path[0] === 'containers' && path.length === 3 && path[2] === 'memories' && request.method === 'POST') return response(await service.addMemory(actor.id, path[1], body as SharedMemoryInput), 201);
    if (path[0] === 'containers' && path.length === 4) {
      if (path[2] === 'memories' && request.method === 'DELETE') return response(await service.deleteMemory(actor.id, path[1], path[3], body as SharedMutation));
      if (path[2] === 'participants' && request.method === 'POST') return response(await service.revokeParticipant(actor.id, path[1], Number(path[3]), body as SharedParticipantInput));
      if (path[2] === 'agents' && ['POST', 'PUT'].includes(request.method)) return response(await service.setAgentAccess(actor.id, path[1], path[3], body as SharedAgentInput));
    }
    return response({ error: 'not_found' }, 404);
  } catch (error) {
    if (isSchemaValidationError(error)) return response({ error: 'invalid_request' }, 400);
    if (SharedMemoryError.is(error) || AdaptiveError.is(error)) return response({ error: error.code }, error.status);
    if (StudioError.is(error)) return response({ error: 'invalid_request' }, error.status);
    if (StudioRateLimitError.is(error)) return response({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    return response({ error: 'shared_memory_unavailable' }, 503);
  }
}
