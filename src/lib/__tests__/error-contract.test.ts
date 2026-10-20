import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { z } from 'zod';
import { isSchemaValidationError, publicDomainError } from '../error-contract';
import { AdaptiveError, type AdaptiveService } from '../adaptive/persistence/service';
import { SharedMemoryError, type SharedMemoryService } from '../adaptive/shared/service';
import { StudioRateLimitError } from '../studio/ratelimit';
import { LLMAuthorizationError } from '../tireh/llm';
import { signInitData } from '../studio/auth';
import { StudioError, type Studio } from '../studio/service';
import { handleAdaptiveRequest } from '../adaptive/persistence/http';
import { handleSharedRequest } from '../adaptive/shared/http';
import { handleExperienceRequest } from '../adaptive/runtime/http';
import type { AdaptiveExperienceService } from '../adaptive/runtime/service';
import { handleVoiceIdentityRequest } from '../adaptive/voice-identity/http';
import type { VoiceIdentityService } from '../adaptive/voice-identity/service';
import { handleLearningRequest } from '../studio/learning-http';
import { handleConversationRequest } from '../studio/conversation';
import { handleStudioRequest } from '../studio/http';
import { ConnectionsError } from '../connections/errors';
import { handleConnectionsRequest } from '../connections/http';
import type { ConnectionsApplication } from '../connections/application';

/** Independent constructor models instrumentation's service copy, while Error
 * and the VM's shared Symbol registry remain the same as the route bundle. */
function otherBundleError(name = 'AdaptiveError', fields: Record<string, unknown> = { status: 409, code: 'invalid_transition' }): Error {
  return runInNewContext(`new (class PeerError extends Error {
    constructor() { super(message); this.name = name; Object.assign(this, fields);
      Object.defineProperty(this, Symbol.for('vox.' + name), { value: true, writable: false, configurable: false }); }
  })()`, { Error, Symbol, name, fields, message: 'PRIVATE_PROMPT_CANARY', });
}
const TOKEN = '123:synthetic-bundle-test';
function request() {
  return new Request('https://vox.synthetic/api/studio/adaptive/consents/present', { method: 'POST', headers: {
    origin: 'https://vox.synthetic', 'content-type': 'application/json',
    'x-telegram-init-data': signInitData({ id: 123, first_name: 'Synthetic' }, TOKEN),
  }, body: JSON.stringify({ space: 'personal', purpose: 'optional.reminder_delivery', locale: 'en',
    expectedRevision: 3, eventId: 'synthetic-reopen', deliberateReopen: true }) });
}
function studio(throwable?: unknown): Studio {
  return { deps: { adaptive: {}, rateLimiter: { consume: () => undefined } }, ensureMember: async () => {
    if (throwable !== undefined) throw throwable;
    return { telegramId: 123, role: 'member' };
  } } as unknown as Studio;
}

it('recognizes branded errors from an independent constructor without exposing their message', async () => {
  const error = otherBundleError(); expect(error instanceof AdaptiveError).toBe(false); expect(AdaptiveError.is(error)).toBe(true);
  expect(SharedMemoryError.is(otherBundleError('SharedMemoryError'))).toBe(true);
  expect(ConnectionsError.is(otherBundleError('ConnectionsError'))).toBe(true);
  expect(ConnectionsError.is(new ConnectionsError(409, 'operation_changed'))).toBe(true);
  expect(StudioError.is(otherBundleError('StudioError', { status: 403 }))).toBe(true);
  expect(StudioError.is(new StudioError(403, 'Not permitted.'))).toBe(true);
  expect(StudioError.is(new StudioError(402, 'This voice requires a paid plan.'))).toBe(true);
  expect(StudioRateLimitError.is(otherBundleError('StudioRateLimitError', { retryAfterSeconds: 4 }))).toBe(true);
  const denied = otherBundleError('LLMAuthorizationError', {}); Object.defineProperty(denied, 'message', { value: 'llm_authority_changed' });
  expect(LLMAuthorizationError.is(denied)).toBe(true);
  const service = { present: async () => { throw error; } } as unknown as AdaptiveService;
  const response = await handleAdaptiveRequest(studio(), service, request(), ['consents', 'present'], TOKEN);
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'invalid_transition' });
});

it('requires immutable own brands and data fields, bounded codes and supported HTTP statuses', () => {
  const read = vi.fn(() => { throw new Error('PRIVATE_GETTER_CANARY'); });
  const getters = ['name', 'status', 'code'].map(field => { const error = otherBundleError(); Object.defineProperty(error, field, { get: read }); return error; });
  const unrelated = Object.assign(new Error('PRIVATE_PROMPT_CANARY'), { name: 'AdaptiveError', status: 409, code: 'invalid_transition' });
  const inherited = Object.create(otherBundleError());
  const mutableBrand = Object.assign(new Error('private'), { name: 'AdaptiveError', status: 409, code: 'invalid_transition' });
  Object.defineProperty(mutableBrand, Symbol.for('vox.AdaptiveError'), { value: true, writable: true });
  const values = [null, {}, { name: 'AdaptiveError', status: 409, code: 'invalid_transition' }, unrelated, inherited, mutableBrand, ...getters,
    ...[NaN, Infinity, 200, 418, 409.5].map(status => otherBundleError('AdaptiveError', { status, code: 'invalid_transition' })),
    ...['', 'PRIVATE text', 'https://private.example', 'x'.repeat(97)].map(code => otherBundleError('AdaptiveError', { status: 409, code })),
    new Proxy(otherBundleError(), { get: read })];
  for (const error of values) expect(AdaptiveError.is(error)).toBe(false);
  expect(read).not.toHaveBeenCalled();
  const descriptorTrap = vi.fn(() => { throw new Error('PRIVATE_DESCRIPTOR_CANARY'); });
  expect(StudioRateLimitError.is(new Proxy(otherBundleError('StudioRateLimitError', { retryAfterSeconds: 4 }), { getOwnPropertyDescriptor: descriptorTrap }))).toBe(false);
  expect(descriptorTrap).not.toHaveBeenCalled();
  expect(StudioRateLimitError.is(otherBundleError('StudioRateLimitError', { retryAfterSeconds: Infinity }))).toBe(false);
  expect(LLMAuthorizationError.is(otherBundleError('LLMAuthorizationError'))).toBe(false);
});

const routes = {
  adaptive: (s: Studio, r: Request) => handleAdaptiveRequest(s, {} as AdaptiveService, r, [], TOKEN),
  shared: (s: Studio, r: Request) => handleSharedRequest(s, {} as SharedMemoryService, r, [], TOKEN),
  experience: (s: Studio, r: Request) => handleExperienceRequest(s, {} as AdaptiveExperienceService, r, [], TOKEN),
  voice: (s: Studio, r: Request) => handleVoiceIdentityRequest(s, {} as VoiceIdentityService, r, [], TOKEN),
  learning: (s: Studio, r: Request) => handleLearningRequest(s, r, [], TOKEN),
  conversation: (s: Studio, r: Request) => handleConversationRequest(s, r, TOKEN),
};
it.each(Object.entries(routes))('%s preserves cross-bundle domain conflicts and rate limits with no private payload', async (_name, route) => {
  const unauthenticated = request(); unauthenticated.headers.set('x-telegram-init-data', '');
  expect((await route(studio(otherBundleError()), unauthenticated)).status).toBe(401);
  const conflict = await route(studio(otherBundleError()), request());
  expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: 'invalid_transition' });
  const limited = await route(studio(otherBundleError('StudioRateLimitError', { retryAfterSeconds: 4 })), request());
  expect(limited.status).toBe(429); expect(limited.headers.get('Retry-After')).toBe('4'); expect(await limited.json()).toEqual({ error: 'rate_limited' });
  const unknown = await route(studio(Object.assign(new Error('PRIVATE_PROMPT_CANARY'), { name: 'AdaptiveError', status: 409, code: 'private_canary' })), request());
  expect(unknown.status).toBe(503); expect(await unknown.text()).not.toContain('private_canary');
});

it('maps branded shared conflicts and provider revocation through their adjacent HTTP boundaries', async () => {
  for (const route of [routes.shared, routes.learning]) {
    const response = await route(studio(otherBundleError('SharedMemoryError', { status: 409, code: 'audience_changed' })), request());
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'audience_changed' });
  }
  const error = otherBundleError('LLMAuthorizationError', {}); Object.defineProperty(error, 'message', { value: 'llm_authority_changed' });
  const response = await routes.conversation(studio(error), request());
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'conversation_changed' });
});

it('the standard Studio rate-limit boundary uses fixed copy without reading a private message getter', async () => {
  const error = otherBundleError('StudioRateLimitError', { retryAfterSeconds: 4 });
  const message = vi.fn(() => { throw new Error('PRIVATE_MESSAGE_CANARY'); });
  Object.defineProperty(error, 'message', { get: message });
  const s = studio(); s.deps.rateLimiter = { consume: () => { throw error; } };
  const response = await handleStudioRequest(s, request(), [], { botToken: TOKEN });
  expect(response.status).toBe(429); expect(await response.json()).toEqual({ error: 'Too many requests. Please try again shortly.' });
  expect(message).not.toHaveBeenCalled();
});

it('Connections preserves duplicate-bundle conflicts and rate limits without exposing lookalikes or getters', async () => {
  const invoke = (error: unknown) => handleConnectionsRequest(studio(error), {} as ConnectionsApplication, request(), [], TOKEN);
  const conflict = await invoke(otherBundleError('ConnectionsError', { status: 409, code: 'operation_changed' }));
  expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: 'operation_changed' });
  const limited = await invoke(otherBundleError('StudioRateLimitError', { retryAfterSeconds: 4 }));
  expect(limited.status).toBe(429); expect(limited.headers.get('Retry-After')).toBe('4');
  expect(await limited.json()).toEqual({ error: 'rate_limited' });
  const touched = vi.fn(() => { throw new Error('PRIVATE_GETTER_CANARY'); });
  const getter = otherBundleError('ConnectionsError'); Object.defineProperty(getter, 'code', { get: touched });
  for (const error of [getter, Object.assign(new Error('PRIVATE_PROMPT_CANARY'), { name: 'ConnectionsError', status: 409, code: 'private_canary' }),
    otherBundleError('ConnectionsError', { status: 200, code: 'invalid_status' }), new Proxy(otherBundleError('ConnectionsError'), { getOwnPropertyDescriptor: touched })]) {
    const response = await invoke(error); expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'connections_unavailable' });
  }
  expect(touched).not.toHaveBeenCalled();
});

it('all adaptive HTTP boundaries reject hostile legacy Studio error metadata without invoking accessors', async () => {
  const touched = vi.fn(() => { throw new Error('PRIVATE_GETTER_CANARY'); });
  const errors = ['name', 'status', 'message'].map(field => {
    const error = otherBundleError('StudioError', { status: 403 }); Object.defineProperty(error, field, { get: touched }); return error;
  });
  errors.push(new Proxy(otherBundleError('StudioError', { status: 403 }), { get: touched, getOwnPropertyDescriptor: touched }));
  errors.push(otherBundleError('StudioError', { status: 200 }));
  errors.push(Object.assign(new Error('PRIVATE_CANARY'), { name: 'StudioError', status: 403 }));
  const zodGetter = Object.assign(new Error('PRIVATE_CANARY'), { name: 'ZodError' });
  Object.defineProperty(zodGetter, '_zod', { get: touched }); errors.push(zodGetter);
  for (const error of errors) {
    expect(StudioError.is(error)).toBe(false);
    for (const route of [...Object.values(routes), (s: Studio, r: Request) => handleConnectionsRequest(s, {} as ConnectionsApplication, r, [], TOKEN)]) {
      const response = await route(studio(error), request()); expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('PRIVATE');
    }
  }
  expect(touched).not.toHaveBeenCalled();
});

it('recognizes the installed real schema error and returns only invalid_request across HTTP boundaries', async () => {
  const parsed = z.object({ allowed: z.boolean() }).strict().safeParse({ allowed: 'PRIVATE_INPUT_CANARY' });
  if (parsed.success) throw new Error('Invalid synthetic schema fixture');
  expect(isSchemaValidationError(parsed.error)).toBe(true);
  for (const route of [...Object.values(routes), (s: Studio, r: Request) => handleConnectionsRequest(s, {} as ConnectionsApplication, r, [], TOKEN)]) {
    const response = await route(studio(parsed.error), request()); expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  }
});

it('classifies native errors without traversing a hostile prototype', async () => {
  const trap = vi.fn(() => { throw new Error('PRIVATE_PROTOTYPE_CANARY'); });
  const prototype = new Proxy(Error.prototype, { getPrototypeOf: trap });
  const domain = otherBundleError('ConnectionsError', { status: 409, code: 'operation_changed' });
  Object.setPrototypeOf(domain, prototype);
  expect(ConnectionsError.is(domain)).toBe(true);
  const conflict = await handleConnectionsRequest(studio(domain), {} as ConnectionsApplication, request(), [], TOKEN);
  expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: 'operation_changed' });
  const parsed = z.string().safeParse(1); if (parsed.success) throw new Error('Invalid synthetic schema fixture');
  Object.setPrototypeOf(parsed.error, prototype);
  expect(isSchemaValidationError(parsed.error)).toBe(true);
  const invalid = await handleConnectionsRequest(studio(parsed.error), {} as ConnectionsApplication, request(), [], TOKEN);
  expect(invalid.status).toBe(400); expect(await invalid.json()).toEqual({ error: 'invalid_request' });
  expect(trap).not.toHaveBeenCalled();
});

it('preserves only branded 410 record expiry errors across independent bundles', () => {
  expect(publicDomainError(otherBundleError('RightsError', { status: 410, code: 'rights_record_expired' }), 'RightsError')).toBe(true);
  expect(publicDomainError(Object.assign(new Error('private'), { name: 'RightsError', status: 410, code: 'rights_record_expired' }), 'RightsError')).toBe(false);
});
