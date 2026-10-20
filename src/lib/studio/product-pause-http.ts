import { z } from 'zod';
import { isSchemaValidationError } from '../error-contract';
import { AdaptiveError } from '../adaptive/persistence/service';
import { ProductPauseService } from '../adaptive/product-pause/service';
import { hasCommittedPersonalizationTransport } from '../adaptive/persistence/indexed-private-context';
import { productPauseCommandSchema, productPauseSpaceSchema, type ProductPauseStatus } from '../adaptive/product-pause/contracts';
import { verifyInitData } from './auth';
import { boundedStudioRequest } from './http';
import { StudioError, type Studio } from './service';
import { StudioRateLimiter, StudioRateLimitError, type StudioRequestRateLimiter } from './ratelimit';

export type ProductPauseControlView = ProductPauseStatus & {
  resumeReason?: 'profile_confirmation_required' | 'approval_required' | 'storage_unavailable';
};
const limiters = new WeakMap<Studio, StudioRequestRateLimiter>();
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

/** Account-owned stop/status remain available without an optional grant, a
 * current profile or Studio membership. Resume additionally needs both the
 * current core/profile policy and current Studio membership. */
export async function handleProductPauseRequest(studio: Studio, request: Request, botToken: string): Promise<Response> {
  try {
    let limiter = studio.deps.rateLimiter ?? limiters.get(studio);
    if (!limiter) { limiter = new StudioRateLimiter(); limiters.set(studio, limiter); }
    await limiter.consume('ingress', 'all');
    const init = request.headers.get('x-telegram-init-data') ?? '';
    if (!botToken.trim() || init.length > 16_384) return json({ error: 'authentication_required' }, 401);
    const user = verifyInitData(init, botToken);
    if (!user) return json({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    const adaptive = studio.deps.adaptive;
    if (!adaptive) return json({ error: 'product_pause_unavailable' }, 503);
    const service = new ProductPauseService(adaptive);
    const transportAvailable = () => hasCommittedPersonalizationTransport(adaptive.repository.storage) &&
      !!studio.deps.store.readCommittedForEffect && studio.deps.chatLLM.committedExportFence === true &&
      (!studio.deps.fastLLM || studio.deps.fastLLM.committedExportFence === true) &&
      (!studio.deps.eleven || studio.deps.eleven.committedTtsExportFence === true);
    const assertAuthenticated = () => {
      if (verifyInitData(init, botToken)?.id !== user.id) throw new AdaptiveError(401, 'authentication_required');
    };
    const resumeMembership = (): ProductPauseControlView['resumeReason'] => {
      if (!studio.deps.store.readCommittedForEffect) return 'storage_unavailable';
      try {
        const member = studio.deps.store.readCommittedForEffect().members.find(row => row.telegramId === user.id);
        return !member || member.role === 'pending' ? 'approval_required' : undefined;
      } catch { return 'storage_unavailable'; }
    };
    const view = (status: ProductPauseStatus): ProductPauseControlView => {
      assertAuthenticated();
      if (!status.available) return status;
      if (!transportAvailable()) return { ...status, available: false, canPause: false, canResume: false, reason: 'unsupported_transport' };
      const resumeReason = resumeMembership() ?? (!status.canResume ? 'profile_confirmation_required' : undefined);
      return { ...status, canResume: status.canResume && !resumeReason, ...(resumeReason ? { resumeReason } : {}) };
    };
    const url = new URL(request.url);
    if (request.method === 'GET') {
      if ([...url.searchParams.keys()].some(key => key !== 'space') || url.searchParams.getAll('space').length > 1) return json({ error: 'invalid_request' }, 400);
      const space = productPauseSpaceSchema.parse(url.searchParams.get('space') ?? 'work');
      return json(view(await service.read(user.id, space)));
    }
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (url.search) return json({ error: 'invalid_request' }, 400);
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    await limiter.consume('mutation', user.id);
    const bounded = await boundedStudioRequest(request, 2048);
    let raw: unknown;
    try { raw = await bounded.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const input = productPauseCommandSchema.parse(raw);
    const guard = () => {
      assertAuthenticated();
      if (adaptive.repository.storage.canonicalSchemaVersion === 2 && !transportAvailable()) throw new AdaptiveError(503, 'unsupported_transport');
      if (input.action === 'resume') {
        const denied = resumeMembership();
        if (denied) throw new AdaptiveError(denied === 'approval_required' ? 403 : 503, denied);
      }
    };
    guard();
    const result = await service.command(user.id, input, guard);
    return json({ ...result, status: view(result.status) });
  } catch (error) {
    if (isSchemaValidationError(error) || error instanceof z.ZodError) return json({ error: 'invalid_request' }, 400);
    if (AdaptiveError.is(error)) return json({ error: error.code }, error.status);
    if (StudioError.is(error)) return json({ error: 'invalid_request' }, error.status);
    if (StudioRateLimitError.is(error)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    return json({ error: 'product_pause_unavailable' }, 503);
  }
}
