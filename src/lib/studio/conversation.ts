import { logicalTurnSchema } from '../adaptive/personalization/learning/contracts';
import { z } from 'zod';
import { verifyInitData } from './auth';
import { canUseAgent } from './permissions';
import { boundedStudioRequest } from './http';
import { StudioError, type Studio } from './service';
import { StudioRateLimiter, StudioRateLimitError } from './ratelimit';
import { personId } from './org-bridge';
import { beginObservation } from './observation';
import { digest } from '../adaptive/persistence/repository';
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

/** A current-turn text/image surface. The client cannot submit history, identity,
 * model instructions, a predicted route, or a memory access decision. */
export async function handleConversationRequest(studio: Studio, request: Request, botToken: string): Promise<Response> {
  let observe: Awaited<ReturnType<typeof beginObservation>> | undefined;
  try {
    if (!botToken.trim() || !studio.deps.adaptive) return json({ error: 'conversation_unavailable' }, 503);
    let limiter = studio.deps.rateLimiter ?? limiters.get(studio);
    if (!limiter) { const local = new StudioRateLimiter(); limiter = local; limiters.set(studio, local); }
    await limiter.consume('ingress', 'all');
    const initData = request.headers.get('x-telegram-init-data') ?? '';
    const user = initData.length <= 16_384 ? verifyInitData(initData, botToken) : null;
    if (!user) return json({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    const member = await studio.ensureMember(user);
    if (member.role === 'pending') return json({ error: 'approval_required' }, 403);
    const url = new URL(request.url);
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    await limiter.consume('mutation', user.id);
    const bounded = await boundedStudioRequest(request, MAX_IMAGE_URL_LENGTH + 20_000);
    let body: unknown;
    try { body = await bounded.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const input = inputSchema.parse(body);
    const adaptive = studio.deps.adaptive;
    const authority = async (): Promise<string | null> => {
      const currentScope = () => adaptive.withAccountDocument(user.id, (d, now) => {
        const imagePolicy = input.image ? adaptive.capabilityStatus(d, 'single_party_image', now) : null;
        if (!adaptive.isCoreAllowed(d, now) || !d.agentGrants.some(g => g.agentId === input.agentId && g.space === input.space && g.allowed) ||
            (imagePolicy && !imagePolicy.eligible)) return null;
        return digest([adaptive.coreFingerprint(d, now), d.agentGrants.filter(g => g.agentId === input.agentId && g.space === input.space), imagePolicy]);
      });
      const scope = await currentScope();
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
      return await studioAllowed() ? digest([scope, context?.revision]) : null;
    };
    const before = await authority();
    if (!before) return json({ error: 'conversation_not_permitted' }, 403);
    if (request.signal.aborted) return json({ error: 'conversation_cancelled' }, 409);
    // Authorization precedes image processing/export. No URL fetching or uploads
    // to persistent provider file storage; raw original bytes never reach here.
    let images: LLMImage[] | undefined;
    if (input.image) {
      let image: string;
      try { image = minimizeImageDataUrl(input.image); } catch { return json({ error: 'invalid_image' }, 400); }
      const comma = image.indexOf(',');
      images = [{ mimeType: image.slice(5, image.indexOf(';')) as LLMImage['mimeType'], data: image.slice(comma + 1) }];
    }
    await limiter.consume('expensive', user.id);
    observe = await beginObservation(studio, user.id, input.agentId, input.space, 'text');
    const { gateway } = await studio.gateway();
    if (request.signal.aborted || await authority() !== before) {
      await observe('cancelled'); return json({ error: 'conversation_changed' }, 409);
    }
    const reply = await observe.run(() => gateway.converse(input.agentId, personId(user.id), input.text, { space: input.space, images,
      authorize: async () => !request.signal.aborted && await authority() === before }));
    // Gateway also checks memory/source policy around provider export and output.
    if (request.signal.aborted || await authority() !== before) {
      await observe('cancelled'); return json({ error: 'conversation_changed' }, 409);
    }
    const correlation = await observe('responded');
    if (request.signal.aborted || await authority() !== before) {
      await observe('cancelled'); return json({ error: 'conversation_changed' }, 409);
    }
    if (input.turn && !input.image) studio.deps.preferenceLearning?.enqueue({ telegramId: user.id, agentId: input.agentId,
      space: input.space, turn: input.turn, text: input.text }, request.signal);
    return json({ reply, ...(correlation ? { turnId: correlation } : {}) });
  } catch (error) {
    await observe?.(request.signal.aborted || LLMAuthorizationError.is(error) ? 'cancelled' : 'failed');
    if (LLMAuthorizationError.is(error)) return json({ error: 'conversation_changed' }, 409);
    if (error instanceof z.ZodError) return json({ error: 'invalid_request' }, 400);
    if (AdaptiveError.is(error)) return json({ error: error.code }, error.status);
    if (StudioRateLimitError.is(error)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    if (StudioError.is(error)) return json({ error: 'invalid_request' }, error.status);
    return json({ error: 'conversation_unavailable' }, 503);
  }
}
