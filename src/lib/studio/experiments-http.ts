import { trustedStudioRequestOrigin } from './request-origin';
import { isSchemaValidationError } from '../error-contract';
import type { StudioExperimentRuntime } from '../adaptive/experiments/runtime';
import { experimentExposureInputSchema } from '../adaptive/experiments/contracts';
import { verifyInitData } from './auth';
import { boundedStudioRequest } from './http';
import { StudioError, type Studio } from './service';
import { StudioRateLimiter, StudioRateLimitError } from './ratelimit';
const limiters = new WeakMap<Studio, StudioRateLimiter>();
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});
/** Only acknowledge a server-created receipt. Clients cannot choose scope,
 * variant, configuration, exposure time, or promote/disable experiments. */
export async function handleExperimentExposure(studio: Studio & { deps: Studio['deps'] & { experiments?: StudioExperimentRuntime } }, request: Request, botToken: string): Promise<Response> {
  try {
    if (!botToken.trim()) return json({ error: 'experiments_unavailable' }, 503);
    let limiter = studio.deps.rateLimiter ?? limiters.get(studio);
    if (!limiter) { const local = new StudioRateLimiter(); limiters.set(studio, local); limiter = local; }
    await limiter.consume('ingress', 'all');
    const initData = request.headers.get('x-telegram-init-data') ?? '';
    const user = initData.length <= 16_384 ? verifyInitData(initData, botToken) : null;
    if (!user) return json({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    const url = new URL(request.url);
    const expectedOrigin = trustedStudioRequestOrigin(url, studio.deps.webAppUrl);
    if (!expectedOrigin) return json({ error: 'origin_unavailable' }, 503);
    if (request.headers.get('origin') !== expectedOrigin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin_denied' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    await limiter.consume('mutation', user.id);
    const bounded = await boundedStudioRequest(request, 2048);
    let body: unknown; try { body = await bounded.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const input = experimentExposureInputSchema.parse(body);
    if (verifyInitData(initData, botToken)?.id !== user.id) return json({ error: 'authentication_required' }, 401);
    if (!studio.deps.experiments) return json({ recorded: false, duplicate: false });
    return json(await studio.deps.experiments.acknowledge(user.id, input));
  } catch (error) {
    if (isSchemaValidationError(error)) return json({ error: 'invalid_request' }, 400);
    if (StudioError.is(error)) return json({ error: 'invalid_request' }, error.status);
    if (StudioRateLimitError.is(error)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    return json({ error: 'experiments_unavailable' }, 503);
  }
}
