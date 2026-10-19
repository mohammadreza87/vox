import { z } from 'zod';
import { verifyInitData } from '../../studio/auth';
import { boundedStudioRequest } from '../../studio/http';
import { StudioError, type Studio } from '../../studio/service';
import { StudioRateLimiter, StudioRateLimitError } from '../../studio/ratelimit';
import { AdaptiveError } from '../persistence/service';
import { MAX_VOICE_BYTES, voiceBeginSchema, voiceCommandSchema, voiceConsentSchema, voicePresentSchema, voiceScopeSchema } from './contracts';
import type { VoiceIdentityService } from './service';
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const limiters = new WeakMap<Studio, StudioRateLimiter>();
export async function handleVoiceIdentityRequest(studio: Studio, service: VoiceIdentityService, request: Request, path: string[], botToken: string): Promise<Response> {
  try {
    if (!botToken.trim()) return json({ error: 'voice_identity_unavailable' }, 503);
    let limiter = studio.deps.rateLimiter ?? limiters.get(studio);
    if (!limiter) { const local = new StudioRateLimiter(); limiters.set(studio, local); limiter = local; }
    await limiter.consume('ingress', 'all');
    const data = request.headers.get('x-telegram-init-data') ?? '';
    if (data.length > 16_384) return json({ error: 'authentication_required' }, 401);
    const user = verifyInitData(data, botToken);
    if (!user) return json({ error: 'authentication_required' }, 401);
    await limiter.consume('api', user.id);
    const member = await studio.ensureMember(user);
    if (member.role === 'pending') return json({ error: 'approval_required' }, 403);
    const url = new URL(request.url), route = `${request.method} ${path.join('/')}`;
    if (route === 'GET ') {
      const scope = voiceScopeSchema.parse({ space: url.searchParams.get('space') ?? 'work', deviceId: url.searchParams.get('deviceId') });
      return json(await service.read(user.id, scope));
    }
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'origin_denied' }, 403);
    await limiter.consume('mutation', user.id);
    if (route === 'POST sample') {
      const scope = voiceScopeSchema.parse({ space: url.searchParams.get('space'), deviceId: url.searchParams.get('deviceId') });
      const captureId = z.string().uuid().parse(url.searchParams.get('captureId'));
      // Reject disabled, unconsented and replayed requests before buffering audio.
      await service.preflight(user.id, scope, captureId);
      await limiter.consume('expensive', user.id);
      const mimeType = request.headers.get('content-type') ?? '';
      if (!/^audio\/(webm|ogg|mp4|wav)(;|$)/.test(mimeType)) return json({ error: 'audio_required' }, 415);
      const bounded = await boundedStudioRequest(request, MAX_VOICE_BYTES);
      const bytes = new Uint8Array(await bounded.arrayBuffer());
      return json(await service.process(user.id, scope, captureId, bytes, mimeType, request.signal));
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'json_required' }, 415);
    const bounded = await boundedStudioRequest(request, 4096);
    let body: unknown;
    try { body = await bounded.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    if (route === 'POST present') {
      const { expectedRevision, locale, ...scope } = voicePresentSchema.parse(body);
      return json(await service.present(user.id, scope, expectedRevision, locale));
    }
    if (route === 'POST enroll') {
      const { expectedRevision, receipt, space, deviceId } = voiceConsentSchema.parse(body);
      return json(await service.acceptEnrollment(user.id, { space, deviceId }, expectedRevision, receipt));
    }
    if (route === 'POST begin') {
      const { expectedRevision, mode, space, deviceId } = voiceBeginSchema.parse(body);
      return json(await service.begin(user.id, { space, deviceId }, expectedRevision, mode));
    }
    if (route === 'POST cancel') return json(await service.cancel(user.id, voiceScopeSchema.parse(body)));
    if (route === 'POST delete') {
      const { space, deviceId } = voiceCommandSchema.omit({ expectedRevision: true }).parse(body);
      return json(await service.remove(user.id, { space, deviceId }));
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'invalid_request' }, 400);
    if (AdaptiveError.is(error)) return json({ error: error.code }, error.status);
    if (StudioError.is(error)) return json({ error: 'invalid_request' }, error.status);
    if (StudioRateLimitError.is(error)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    return json({ error: 'voice_identity_unavailable' }, 503);
  }
}
