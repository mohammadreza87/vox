import { isSchemaValidationError } from '../error-contract';
import { trustedStudioRequestOrigin } from '../studio/request-origin';
import { z } from 'zod';
import type { Studio } from '../studio/service';
import { StudioError } from '../studio/service';
import { verifyInitData } from '../studio/auth';
import { boundedStudioRequest } from '../studio/http';
import { StudioRateLimiter, StudioRateLimitError, type StudioRequestRateLimiter } from '../studio/ratelimit';
import type { ConnectionsApplication } from './application';
import { ConnectionsError } from './errors';
import { idSchema, type ConnectionActor, type ConnectionContext } from './contracts';
import { authenticateAgentConnections } from './bot-principal';
import { AdaptiveError } from '../adaptive/persistence/service';
import { settingsV2 } from '../studio/flags';
import { connectionReceipts } from './receipts';
import type { AgentConnectionsHandoff, ConnectionsSnapshot } from './contracts';

/** Changes that leave the person a quiet Telegram record (Settings v2). */
const RECEIPT_ROUTES = new Set(['setup/claim', 'mcp/setup/claim', 'grants', 'revoke']);

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
export async function handleConnectionsRequest(studio: Studio, application: ConnectionsApplication | ((actor: ConnectionActor, space: 'work' | 'personal') => Promise<ConnectionsApplication>), request: Request, path: string[], botToken: string, botAgentId?: string): Promise<Response> {
  // The agent-bot surface is content-free: its initData is signed with a token the agent's creator holds, so it can be
  // harvested by a repointed menu even with Telegram's signature. Identity confirmation, grants, tasks, setup, MCP
  // enrollment, revoke, provider resources and action review are refused before anything is read or built, and the
  // one GET answers a handoff to Vox, never the dashboard.
  if (botAgentId && !(request.method === 'GET' && path.length === 0)) return json({ error: 'not_found' }, 404);
  try {
    let limiter = studio.deps.rateLimiter ?? limiters.get(studio);
    if (!limiter) { limiter = new StudioRateLimiter(); limiters.set(studio, limiter); }
    await limiter.consume('ingress', botAgentId ? 'agent-connections' : 'all');
    const init = request.headers.get('x-telegram-init-data') ?? '';
    if (init.length > 16_384) return json({ error: 'authentication_required' }, 401);
    const authenticated = botAgentId ? await authenticateAgentConnections(studio, request, botAgentId) : undefined;
    const user = authenticated?.user ?? verifyInitData(init, botToken);
    if (!user) return json({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    if (botAgentId) {
      // Decision 8: no connection record, provider or profile state leaves through agent-signed initData. The app is never built.
      const agent = (await studio.deps.store.read()).agents.find(a => a.id === botAgentId);
      const body: AgentConnectionsHandoff = { agent: { id: botAgentId, name: agent?.persona.name ?? '' }, manageInVox: true };
      return json(body);
    }
    if (!authenticated) {
      const member = await studio.ensureMember(user);
      if (member.role === 'pending') return json({ error: 'approval_required' }, 403);
    }
    const actor: ConnectionActor = authenticated?.actor ?? { accountId: `telegram-account:${user.id}` };
    const url = new URL(request.url);
    const space = spaceSchema.parse(url.searchParams.get('space') ?? (botAgentId ? 'personal' : 'work'));
    if (botAgentId && url.searchParams.has('agentId') && url.searchParams.get('agentId') !== botAgentId) return json({ error: 'agent_connection_mismatch' }, 403);
    // Workflows have a separate multi-connection review contract; this bot route exposes only its own connections.
    if (botAgentId && (path[0] === 'workflows' || path[0] === 'workflow-choices')) return json({ error: 'not_found' }, 404);
    // Mutation space is parsed below before obtaining the partition-specific app.
    let app = typeof application === 'function' ? await application(actor, space) : application;
    let responseContext: ConnectionContext | undefined;
    const respond = (value: unknown, status = 200) => { if (responseContext) app.service.assertContextCurrent(actor, responseContext); return json(value, status); };
    if (request.method === 'GET') {
      if (actor.botAgentId) responseContext = await app.service.context(actor, space);
      if (!path.length) return respond(await app.dashboard(actor, space, ...(botAgentId ? [botAgentId] : url.searchParams.has('agentId') ? [idSchema.parse(url.searchParams.get('agentId'))] : [])));
      if (path.join('/') === 'workflows') return app.workflows ? respond(await app.workflows.list(actor, space)) : json({ error: 'workflows_unavailable' }, 503);
      if (path.join('/') === 'workflow-choices') return app.workflowChoices ? respond({ choices: await app.workflowChoices(actor, space) }) : json({ choices: [] });
      if (path.length === 2 && path[0] === 'resources') return respond({ resources: await app.resources(actor, space, idSchema.parse(path[1])) });
      if (path.length === 2 && path[0] === 'review') return respond(await app.service.preview(actor, { space, operationId: idSchema.parse(path[1]),
        expectedRevision: z.coerce.number().int().positive().parse(url.searchParams.get('revision')) }));
      return json({ error: 'not_found' }, 404);
    }
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    const expectedOrigin = trustedStudioRequestOrigin(url, studio.deps.webAppUrl);
    if (!expectedOrigin) return json({ error: 'connections_unavailable' }, 503);
    if (request.headers.get('origin') !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    await limiter.consume('mutation', user.id);
    const bounded = await boundedStudioRequest(request, 64 * 1024);
    let body: unknown;
    try { body = await bounded.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    if (botAgentId && body && typeof body === 'object' && 'agentId' in body && body.agentId !== botAgentId) return json({ error: 'agent_connection_mismatch' }, 403);
    if (typeof application === 'function') {
      const mutationSpace = z.object({ space: spaceSchema }).parse(body).space;
      app = await application(actor, mutationSpace);
    }
    if (actor.botAgentId) responseContext = await app.service.context(actor, z.object({ space: spaceSchema }).parse(body).space);
    if (['workflows/create', 'workflows/review'].includes(path.join('/'))) await app.assertWorkflowMutationAllowed?.();
    // Settings v2: the person's own snapshot before a recorded change, diffed after it for quiet Telegram records.
    const route = path.join('/'), receiptSpace = z.object({ space: spaceSchema }).safeParse(body);
    let before: ConnectionsSnapshot | undefined;
    if (settingsV2() && studio.receipts && RECEIPT_ROUTES.has(route) && receiptSpace.success) before = await app.service.list(actor, { space: receiptSpace.data.space }).catch(() => undefined);
    const dispatch = async (): Promise<Response> => {
      switch (path.join('/')) {
        case 'mcp/enroll': return app.enrollMcp ? respond(await app.enrollMcp(actor, body), 201) : json({ error: 'mcp_setup_unavailable' }, 503);
        case 'mcp/setup/preview': { const input = flowSchema.parse(body); return app.previewMcpSetup ? respond(await app.previewMcpSetup(actor, input.space, input.flowId)) : json({ error: 'mcp_setup_unavailable' }, 503); }
        case 'mcp/setup/claim': { const input = flowSchema.extend({ acceptedCatalogDigest: z.string().regex(/^[a-f0-9]{64}$/) }).parse(body); return app.claimMcpSetup ? respond(await app.claimMcpSetup(actor, input.space, input.flowId, input.acceptedCatalogDigest)) : json({ error: 'mcp_setup_unavailable' }, 503); }
        case 'mcp/setup/cancel': { const input = flowSchema.parse(body); return app.cancelMcpSetup ? respond(await app.cancelMcpSetup(actor, input.space, input.flowId)) : json({ error: 'mcp_setup_unavailable' }, 503); }
        case 'enroll': return respond(await (app.enroll ? app.enroll(actor, body) : app.service.enroll(actor, body)), 201);
        case 'grants': return respond(await (app.grant ? app.grant(actor, body) : app.service.grant(actor, body)));
        case 'revoke': return respond(await (app.revoke ? app.revoke(actor, body) : app.service.revoke(actor, body)));
        case 'tasks': return app.task ? respond(await app.task(actor, body)) : json({ error: 'tasks_unavailable' }, 503);
        case 'workflows/create': return app.workflows ? respond(await app.workflows.create(actor, body), 201) : json({ error: 'workflows_unavailable' }, 503);
        case 'workflows/review': return app.workflows ? respond(await app.workflows.review(actor, body)) : json({ error: 'workflows_unavailable' }, 503);
        case 'workflows/pause': return app.workflows ? respond(await app.workflows.pause(actor, body)) : json({ error: 'workflows_unavailable' }, 503);
        case 'setup': { const input = setupSchema.parse(body); return respond(await app.beginSetup(actor, input.space, input.connectionId)); }
        case 'setup/claim': { const input = flowSchema.parse(body); return respond(await app.claimSetup(actor, input.space, input.flowId)); }
        case 'setup/cancel': { const input = flowSchema.parse(body); return respond(await app.cancelSetup(actor, input.space, input.flowId)); }
        case 'actions/approve': return respond(await app.service.approve(actor, body));
        case 'actions/cancel': return respond(await app.service.cancel(actor, body));
        case 'actions/execute': { const input = operationSchema.parse(body); return respond(await app.execute(actor, input.space, input.operationId)); }
        default: return json({ error: 'not_found' }, 404);
      }
    };
    const response = await dispatch();
    if (before && receiptSpace.success && response.ok) {
      const space = receiptSpace.data.space, locale = user.language_code?.toLowerCase().startsWith('fa') ? 'fa' as const : 'en' as const;
      // Connection records come from the manager bot, whose initData this is (the agent-bot surface never gets here).
      const allowsWriteToPm = user.allows_write_to_pm;
      studio.receipts.track((async () => {
        const after = await app.service.list(actor, { space });
        for (const receipt of connectionReceipts(before, after)) await studio.receipts.send({ ...receipt, telegramId: user.id, locale, ...(allowsWriteToPm === false ? { allowsWriteToPm } : {}) });
      })());
    }
    return response;
  } catch (error) {
    if (isSchemaValidationError(error)) return json({ error: 'invalid_request' }, 400);
    if (ConnectionsError.is(error) || AdaptiveError.is(error)) return json({ error: error.code }, error.status);
    if (StudioRateLimitError.is(error)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    if (StudioError.is(error)) return json({ error: 'invalid_request' }, error.status);
    return json({ error: 'connections_unavailable' }, 503);
  }
}

/** Per-agent Mini App surface; the route hint never supplies provider or company authority. */
export const handleAgentConnectionsRequest = (studio: Studio, application: ConnectionsApplication | ((actor: ConnectionActor, space: 'work' | 'personal') => Promise<ConnectionsApplication>),
  request: Request, agentId: string, path: string[]) => handleConnectionsRequest(studio, application, request, path, '', agentId);
