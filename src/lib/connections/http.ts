import { z } from 'zod';
import type { Studio } from '../studio/service';
import { StudioError } from '../studio/service';
import { verifyInitData } from '../studio/auth';
import { boundedStudioRequest } from '../studio/http';
import { StudioRateLimiter, StudioRateLimitError, type StudioRequestRateLimiter } from '../studio/ratelimit';
import type { ConnectionsApplication } from './application';
import { ConnectionsError } from './errors';
import { idSchema } from './contracts';

const spaceSchema = z.enum(['work', 'personal']);
const setupSchema = z.object({ space: spaceSchema, connectionId: idSchema }).strict();
const flowSchema = z.object({ space: spaceSchema, flowId: idSchema }).strict();
const operationSchema = z.object({ space: spaceSchema, operationId: idSchema }).strict();
const limiters = new WeakMap<Studio, StudioRequestRateLimiter>();
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

/** There is deliberately no wire route for completeEnrollment, broker dispatch,
 * provider credentials, arbitrary URLs, model source labels or account IDs. */
export async function handleConnectionsRequest(studio: Studio, application: ConnectionsApplication | ((actor: { accountId: string }, space: 'work' | 'personal') => Promise<ConnectionsApplication>), request: Request, path: string[], botToken: string): Promise<Response> {
  try {
    let limiter = studio.deps.rateLimiter ?? limiters.get(studio);
    if (!limiter) { limiter = new StudioRateLimiter(); limiters.set(studio, limiter); }
    await limiter.consume('ingress', 'all');
    const init = request.headers.get('x-telegram-init-data') ?? '';
    if (init.length > 16_384) return json({ error: 'authentication_required' }, 401);
    const user = verifyInitData(init, botToken);
    if (!user) return json({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    const member = await studio.ensureMember(user);
    if (member.role === 'pending') return json({ error: 'approval_required' }, 403);
    const actor = { accountId: `telegram-account:${user.id}` };
    const url = new URL(request.url);
    const space = spaceSchema.parse(url.searchParams.get('space') ?? 'work');
    // Mutation space is parsed below before obtaining the partition-specific app.
    let app = typeof application === 'function' ? await application(actor, space) : application;
    if (request.method === 'GET') {
      if (!path.length) return json(await app.dashboard(actor, space));
      if (path.join('/') === 'workflows') return app.workflows ? json(await app.workflows.list(actor, space)) : json({ error: 'workflows_unavailable' }, 503);
      if (path.join('/') === 'workflow-choices') return app.workflowChoices ? json({ choices: await app.workflowChoices(actor, space) }) : json({ choices: [] });
      if (path.length === 2 && path[0] === 'resources') return json({ resources: await app.resources(actor, space, idSchema.parse(path[1])) });
      if (path.length === 2 && path[0] === 'review') return json(await app.service.preview(actor, { space, operationId: idSchema.parse(path[1]),
        expectedRevision: z.coerce.number().int().positive().parse(url.searchParams.get('revision')) }));
      return json({ error: 'not_found' }, 404);
    }
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    await limiter.consume('mutation', user.id);
    const bounded = await boundedStudioRequest(request, 64 * 1024);
    let body: unknown;
    try { body = await bounded.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    if (typeof application === 'function') {
      const mutationSpace = z.object({ space: spaceSchema }).parse(body).space;
      app = await application(actor, mutationSpace);
    }
    if (['workflows/create', 'workflows/review'].includes(path.join('/'))) await app.assertWorkflowMutationAllowed?.();
    switch (path.join('/')) {
      case 'enroll': return json(await (app.enroll ? app.enroll(actor, body) : app.service.enroll(actor, body)), 201);
      case 'grants': return json(await (app.grant ? app.grant(actor, body) : app.service.grant(actor, body)));
      case 'revoke': return json(await (app.revoke ? app.revoke(actor, body) : app.service.revoke(actor, body)));
      case 'tasks': return app.task ? json(await app.task(actor, body)) : json({ error: 'tasks_unavailable' }, 503);
      case 'workflows/create': return app.workflows ? json(await app.workflows.create(actor, body), 201) : json({ error: 'workflows_unavailable' }, 503);
      case 'workflows/review': return app.workflows ? json(await app.workflows.review(actor, body)) : json({ error: 'workflows_unavailable' }, 503);
      case 'workflows/pause': return app.workflows ? json(await app.workflows.pause(actor, body)) : json({ error: 'workflows_unavailable' }, 503);
      case 'setup': { const input = setupSchema.parse(body); return json(await app.beginSetup(actor, input.space, input.connectionId)); }
      case 'setup/claim': { const input = flowSchema.parse(body); return json(await app.claimSetup(actor, input.space, input.flowId)); }
      case 'setup/cancel': { const input = flowSchema.parse(body); return json(await app.cancelSetup(actor, input.space, input.flowId)); }
      case 'actions/approve': return json(await app.service.approve(actor, body));
      case 'actions/cancel': return json(await app.service.cancel(actor, body));
      case 'actions/execute': { const input = operationSchema.parse(body); return json(await app.execute(actor, input.space, input.operationId)); }
      default: return json({ error: 'not_found' }, 404);
    }
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'invalid_request' }, 400);
    if (ConnectionsError.is(error)) return json({ error: error.code }, error.status);
    if (StudioRateLimitError.is(error)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    if (StudioError.is(error)) return json({ error: 'invalid_request' }, error.status);
    return json({ error: 'connections_unavailable' }, 503);
  }
}
