import { trustedStudioRequestOrigin } from './request-origin';
import { hasCommittedPersonalizationTransport } from '../adaptive/persistence/indexed-private-context';
import { isSchemaValidationError } from '../error-contract';
import { logicalTurnSchema } from '../adaptive/personalization/learning/contracts';
import { z } from 'zod';
import { verifyInitData, type InitDataUser } from './auth';
import { canUseAgent } from './permissions';
import { boundedStudioRequest } from './http';
import { StudioError, type Studio } from './service';
import { StudioRateLimiter, StudioRateLimitError } from './ratelimit';
import { personId } from './org-bridge';
import { beginObservation } from './observation';
import { digest } from '../adaptive/persistence/repository';
import type { DirectAuthorityEvaluator } from '../adaptive/persistence/authority';
import { AdaptiveError } from '../adaptive/persistence/service';
import { minimizeImageDataUrl, MAX_IMAGE_URL_LENGTH } from '../adaptive/prediction/image';
import { LLMAuthorizationError, type LLMImage } from '../tireh/llm';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const inputSchema = z.object({ agentId: id, space: z.enum(['work', 'personal']),
  text: z.string().trim().min(1).max(4096), turn: logicalTurnSchema.optional(), image: z.string().max(MAX_IMAGE_URL_LENGTH).optional(),
}).strict();
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});
const limiters = new WeakMap<Studio, StudioRateLimiter>();

export type ConversationInput = z.infer<typeof inputSchema>;
/** A finished turn as data: the Mini App route serializes it as is; other surfaces (the pet page) add their own fields. */
export type ConversationOutcome =
  | { ok: true; reply: string; turnId?: string; responsePresentation?: unknown }
  | { ok: false; status: number; error: string; headers?: Record<string, string> };

function outcomeResponse(outcome: ConversationOutcome): Response {
  if (!outcome.ok) return json({ error: outcome.error }, outcome.status, outcome.headers);
  const { reply, turnId, responsePresentation } = outcome;
  return json({ reply, ...(turnId ? { turnId } : {}), ...(responsePresentation ? { responsePresentation } : {}) });
}

function conversationLimiter(studio: Studio) {
  let limiter = studio.deps.rateLimiter ?? limiters.get(studio);
  if (!limiter) { const local = new StudioRateLimiter(); limiter = local; limiters.set(studio, local); }
  return limiter;
}

/** A current-turn text/image surface. The client cannot submit history, identity,
 * model instructions, a predicted route, or a memory access decision. */
export async function handleConversationRequest(studio: Studio, request: Request, botToken: string): Promise<Response> {
  try {
    if (!botToken.trim() || !studio.deps.adaptive) return json({ error: 'conversation_unavailable' }, 503);
    const limiter = conversationLimiter(studio);
    await limiter.consume('ingress', 'all');
    const initData = request.headers.get('x-telegram-init-data') ?? '';
    const user = initData.length <= 16_384 ? verifyInitData(initData, botToken) : null;
    if (!user) return json({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    const member = await studio.ensureMember(user);
    if (member.role === 'pending') return json({ error: 'approval_required' }, 403);
    const url = new URL(request.url);
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    const expectedOrigin = trustedStudioRequestOrigin(url, studio.deps.webAppUrl);
    if (!expectedOrigin) return json({ error: 'origin_unavailable' }, 503);
    if (request.headers.get('origin') !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    await limiter.consume('mutation', user.id);
    const bounded = await boundedStudioRequest(request, MAX_IMAGE_URL_LENGTH + 20_000);
    let body: unknown;
    try { body = await bounded.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const input = inputSchema.parse(body);
    return outcomeResponse(await converseAuthorized(studio, user, input, request.signal));
  } catch (error) {
    if (LLMAuthorizationError.is(error)) return json({ error: 'conversation_changed' }, 409);
    if (isSchemaValidationError(error)) return json({ error: 'invalid_request' }, 400);
    if (AdaptiveError.is(error)) return json({ error: error.code }, error.status);
    if (StudioRateLimitError.is(error)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    if (StudioError.is(error)) return json({ error: 'invalid_request' }, error.status);
    return json({ error: 'conversation_unavailable' }, 503);
  }
}

/**
 * One authorized private turn for a user the caller has already authenticated (signed initData) and
 * whose surface already passed its own origin and rate checks. Every adaptive, Studio and block
 * fence of the Mini App conversation applies. The chat is the DM's `private-<person>` key, so the
 * agent remembers both surfaces. `surface` shapes the reply (the pet page: short and playful).
 * Never throws: failures are outcomes.
 */
export async function converseAuthorized(studio: Studio, user: Pick<InitDataUser, 'id'>, input: ConversationInput, signal: AbortSignal,
  o: { surface?: 'pet'; authorize?: () => Promise<boolean>; authorizeNow?: () => boolean; beforeDelivery?: () => Promise<void> } = {}): Promise<ConversationOutcome> {
  const fail = (status: number, error: string, headers?: Record<string, string>): ConversationOutcome => ({ ok: false, status, error, ...(headers ? { headers } : {}) });
  let observe: Awaited<ReturnType<typeof beginObservation>> | undefined;
  try {
    if (!studio.deps.adaptive) return fail(503, 'conversation_unavailable');
    const limiter = conversationLimiter(studio);
    const adaptive = studio.deps.adaptive;
    const indexed = hasCommittedPersonalizationTransport(adaptive.repository.storage);
    const scopeEvaluation: DirectAuthorityEvaluator<string | null> = (d, now, namespace) => {
        const core = adaptive.capabilityStatus(d, 'core_text', now);
        const imagePolicy = input.image ? adaptive.capabilityStatus(d, 'single_party_image', now) : null;
        const allowed = adaptive.isCoreAllowed(d, now) && d.agentGrants.some(g => g.agentId === input.agentId && g.space === input.space && g.allowed) &&
          (!imagePolicy || imagePolicy.eligible);
        return {value: allowed ? digest([namespace, adaptive.coreFingerprint(d, now), d.agentGrants.filter(g => g.agentId === input.agentId && g.space === input.space), imagePolicy]) : null,
          denied: !allowed, ...(allowed ? {deadline: Math.min(d.binding!.expiresAt, core.validUntil ?? now, imagePolicy?.validUntil ?? Number.MAX_SAFE_INTEGER)} : {})};
      };
    const authority = async (): Promise<string | null> => {
      const currentScope = () => indexed ? adaptive.withDirectAuthority(user.id, input.space, scopeEvaluation) : adaptive.withAccountDocument(user.id, (d, now) => {
        const imagePolicy = input.image ? adaptive.capabilityStatus(d, 'single_party_image', now) : null;
        if (!adaptive.isCoreAllowed(d, now) || !d.agentGrants.some(g => g.agentId === input.agentId && g.space === input.space && g.allowed) ||
            (imagePolicy && !imagePolicy.eligible)) return null;
        return digest([adaptive.coreFingerprint(d, now), d.agentGrants.filter(g => g.agentId === input.agentId && g.space === input.space), imagePolicy]);
      });
      const scope = await currentScope();
      if (indexed) {
        if (!scope) return null;
        const studioAuthority = await studio.replyAuthority(input.agentId, user.id);
        if (await currentScope() !== scope || await studio.replyAuthority(input.agentId, user.id) !== studioAuthority) return null;
        return digest([scope, studioAuthority]);
      }
      const context = scope ? await studio.adaptiveContext(input.agentId, personId(user.id), input.space) : null;
      const studioAllowed = async () => {
        const state = await studio.deps.store.read();
        return state.agents.some(a => a.id === input.agentId && a.status === 'active' &&
          !(a.blocked ?? []).includes(user.id) && canUseAgent(state.members.find(m => m.telegramId === user.id), a));
      };
      if (!scope || !await studioAllowed()) return null;
      // Context and Studio reads can await I/O. A withdrawal during those reads
      // must invalidate this authorization before the caller exports anything.
      if (await currentScope() !== scope) return null;
      // The canonical store may itself await I/O. A block applied during that
      // await must be seen at the provider callback, before any content export.
      // These fresh fences do not make the two storage systems atomic.
      // authorityRevision, not revision: the turn's own relationship observation bumps the latter.
      return await studioAllowed() ? digest([scope, context?.authorityRevision ?? context?.revision]) : null;
    };
    const authorityNow = (): string | null => {
      if (!indexed) return null;
      const scope = adaptive.readDirectAuthorityForEffect(user.id, input.space, scopeEvaluation);
      if (scope.status !== 'ready' || !scope.value) return null;
      const studioAuthority = studio.replyAuthorityNow(input.agentId, user.id);
      const current = adaptive.readDirectAuthorityForEffect(user.id, input.space, scopeEvaluation);
      return current.status === 'ready' && current.value === scope.value ? digest([scope.value, studioAuthority]) : null;
    };
    const before = await authority();
    if (!before || o.authorize && !await o.authorize()) return fail(403, 'conversation_not_permitted');
    if (signal.aborted) return fail(409, 'conversation_cancelled');
    // Authorization precedes image processing/export. No URL fetching or uploads
    // to persistent provider file storage; raw original bytes never reach here.
    let images: LLMImage[] | undefined;
    if (input.image) {
      let image: string;
      try { image = minimizeImageDataUrl(input.image); } catch { return fail(400, 'invalid_image'); }
      const comma = image.indexOf(',');
      images = [{ mimeType: image.slice(5, image.indexOf(';')) as LLMImage['mimeType'], data: image.slice(comma + 1) }];
    }
    await limiter.consume('expensive', user.id);
    observe = await beginObservation(studio, user.id, input.agentId, input.space, 'text');
    const { gateway } = await studio.gateway();
    if (signal.aborted || await authority() !== before) {
      await observe('cancelled'); return fail(409, 'conversation_changed');
    }
    let contextFence: (() => boolean) | undefined;
    const reply = await observe.run(() => gateway.converse(input.agentId, personId(user.id), input.text, { space: input.space, images, ...(o.surface ? { surface: o.surface } : {}),
      authorize: async () => !signal.aborted && await authority() === before && (!o.authorize || await o.authorize()),
      ...((indexed || o.authorizeNow) ? {authorizeNow: () => !signal.aborted && (!indexed || authorityNow() === before) && (!o.authorizeNow || o.authorizeNow()),
        onBoundaryFence: (fence: () => boolean) => {contextFence = fence;}} : {}) }));
    // Gateway also checks memory/source policy around provider export and output.
    if (signal.aborted || await authority() !== before) {
      await observe('cancelled'); return fail(409, 'conversation_changed');
    }
    const correlation = await observe('responded');
    if (signal.aborted || await authority() !== before) {
      await observe('cancelled'); return fail(409, 'conversation_changed');
    }
    if (input.turn && !input.image) studio.deps.preferenceLearning?.enqueue({ telegramId: user.id, agentId: input.agentId,
      space: input.space, turn: input.turn, text: input.text }, signal);
    // An experiment may only decorate an already authorized response. Failure
    // to prepare optional presentation keeps the normal conversation working.
    const presentation = correlation && studio.deps.experiments
      ? await studio.deps.experiments.prepare(user.id, input.agentId, input.space, correlation).catch(() => undefined)
      : undefined;
    if (correlation && studio.deps.experiments && (signal.aborted || await authority() !== before)) {
      await observe('cancelled'); return fail(409, 'conversation_changed');
    }
    let currentPresentation;
    try {
      if (presentation && studio.deps.experiments?.current(user.id, input.agentId, input.space, presentation)) currentPresentation = presentation;
    } catch { /* Optional presentation failure retains the normal reply. */ }
    // Surface persistence may await I/O. Complete it before the final authority fence.
    if (o.beforeDelivery) {
      await o.beforeDelivery();
      if (signal.aborted || await authority() !== before) return fail(409, 'conversation_changed');
    }
    if (o.authorize && !await o.authorize()) return fail(409, 'conversation_changed');
    if (o.authorizeNow && !o.authorizeNow()) return fail(409, 'conversation_changed');
    if (indexed && (signal.aborted || !contextFence || !contextFence())) return fail(409, 'conversation_changed');
    return { ok: true, reply, ...(correlation ? { turnId: correlation } : {}), ...(currentPresentation ? { responsePresentation: currentPresentation } : {}) };
  } catch (error) {
    await observe?.(signal.aborted || LLMAuthorizationError.is(error) ? 'cancelled' : 'failed');
    if (LLMAuthorizationError.is(error)) return fail(409, 'conversation_changed');
    if (isSchemaValidationError(error)) return fail(400, 'invalid_request');
    if (AdaptiveError.is(error)) return fail(error.status, error.code);
    if (StudioRateLimitError.is(error)) return fail(429, 'rate_limited', { 'Retry-After': String(error.retryAfterSeconds) });
    if (StudioError.is(error)) return fail(error.status, 'invalid_request');
    return fail(503, 'conversation_unavailable');
  }
}
