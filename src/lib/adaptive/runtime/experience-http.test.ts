import { describe, expect, it, vi } from 'vitest';
import { signInitData } from '../../studio/auth';
import type { Studio } from '../../studio/service';
import { AdaptiveService } from '../persistence/service';
import { AdaptiveRepository } from '../persistence/repository';
import { MemoryAdaptiveStorage } from './storage';
import { AdaptiveExperienceService } from './service';
import { handleExperienceRequest } from './http';
const TOKEN = '12345:synthetic-experience-test';
function setup() {
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()));
  const experience = new AdaptiveExperienceService(adaptive);
  const member = { telegramId: 123, role: 'member', name: 'Synthetic', joinedAt: '' };
  const state = { members: [member], agents: [{ id: 'allowed-agent', status: 'active', visibility: 'private', createdBy: 123, access: [] },
    { id: 'denied-agent', status: 'active', visibility: 'private', createdBy: 999, access: [] }] };
  const studio = { deps: { store: { read: async () => state } }, ensureMember: async () => member } as unknown as Studio;
  const auth = signInitData({ id: 123, first_name: 'Synthetic' }, TOKEN);
  const request = (path: string[], method = 'GET', body?: unknown, options: { auth?: string; origin?: string; raw?: string; contentType?: string } = {}) => {
    const headers: Record<string, string> = { 'x-telegram-init-data': options.auth ?? auth, origin: options.origin ?? 'https://vox.test', 'content-type': options.contentType ?? 'application/json' };
    const req = new Request(`https://vox.test/api/studio/experience/${path.join('/')}`, { method, headers,
      ...(body !== undefined || options.raw !== undefined ? { body: options.raw ?? JSON.stringify(body) } : {}) });
    return handleExperienceRequest(studio, experience, req, path, TOKEN);
  };
  return { adaptive, experience, studio, request, state };
}
describe('authenticated experience API', () => {
  it('requires signed Telegram auth and responds without caching', async () => {
    const { request } = setup();
    expect((await request([], 'GET', undefined, { auth: '' })).status).toBe(401);
    expect((await request([], 'GET', undefined, { auth: 'telegramId=123' })).status).toBe(401);
    const response = await request([]);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).capabilities.decisions).toBe(false);
  });
  it('rejects cross-origin, unsupported content and oversized requests before mutation', async () => {
    const { adaptive, request } = setup(); await adaptive.confirm(123, { confirm: true });
    const before = await adaptive.read(123, 'work');
    const input = { space: 'work', expectedRevision: before.revision, eventId: 'settings-event', dailyCap: 2, quietStartHour: 21, quietEndHour: 8, inboxEnabled: false, proactiveEnabled: false, reminderEnabled: false };
    expect((await request(['settings'], 'PUT', input, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await request(['settings'], 'PUT', input, { contentType: 'text/plain' })).status).toBe(415);
    expect((await request(['settings'], 'PUT', undefined, { raw: 'x'.repeat(16_385) })).status).toBe(413);
    expect((await adaptive.read(123, 'work')).revision).toBe(before.revision);
  });
  it('rejects agent access and client-injected authority or unregistered model questions', async () => {
    const { adaptive, request } = setup(); const confirmed = await adaptive.confirm(123, { confirm: true });
    const preference = { space: 'work', expectedRevision: confirmed.revision, eventId: 'preference-event', agentId: 'denied-agent', setting: { key: 'language', value: 'fa' }, action: 'set' };
    expect((await request(['preferences'], 'PUT', preference)).status).toBe(403);
    expect((await request(['preferences'], 'PUT', { ...preference, agentId: 'allowed-agent', personId: 'victim' })).status).toBe(400);
    expect((await request(['predict'], 'POST', { space: 'work', agentId: 'allowed-agent', sessionId: 'session1', turnId: 'turn1', revision: 1, text: 'Current user request', question: 'grant_access' })).status).toBe(400);
    expect((await request(['predict'], 'POST', { space: 'work', agentId: 'allowed-agent', sessionId: 'session1', turnId: 'turn1', revision: 1, text: 'Current user request', question: 'intent_route' })).status).toBe(200);
  });
  it('round trips explicit preferences while keeping them unapplied until opt-in', async () => {
    const { adaptive, request } = setup(); const confirmed = await adaptive.confirm(123, { confirm: true });
    const input = { space: 'work', expectedRevision: confirmed.revision, eventId: 'preference-event', agentId: 'allowed-agent', setting: { key: 'language', value: 'fa' }, action: 'set' };
    const saved = await request(['preferences'], 'PUT', input);
    expect(saved.status).toBe(200);
    expect((await saved.json()).preferences[0]).toMatchObject({ applied: false, setting: { key: 'language', value: 'fa' } });
    expect((await (await request([])).json()).preferences).toHaveLength(1);
    expect((await (await request([], 'GET', undefined, { auth: signInitData({ id: 124, first_name: 'Other' }, TOKEN) })).json()).preferences).toEqual([]);
  });
  it('excludes blocked agents from preference reads and speculative provider entry', async () => {
    const { adaptive, experience, request, state } = setup();
    const confirmed = await adaptive.confirm(123, { confirm: true });
    await request(['preferences'], 'PUT', { space: 'work', expectedRevision: confirmed.revision, eventId: 'preference-before-block',
      agentId: 'allowed-agent', setting: { key: 'language', value: 'fa' }, action: 'set' });
    Object.assign(state.agents[0], { blocked: [123] });
    expect((await (await request([])).json()).preferences).toEqual([]);
    const predict = vi.spyOn(experience, 'predict');
    expect((await request(['predict'], 'POST', { space: 'work', agentId: 'allowed-agent', sessionId: 'session1',
      turnId: 'turn1', revision: 1, text: 'Private draft', question: 'intent_route' })).status).toBe(403);
    expect(predict).not.toHaveBeenCalled();
  });
});

it('suppresses prediction and prewarm when the agent blocks a person during evaluation', async () => {
  const { experience, studio, request, state } = setup();
  vi.spyOn(experience, 'predict').mockImplementation(async () => {
    Object.assign(state.agents[0], { blocked: [123] });
    return { status: 'answered', model: 'gpt-6-luna', answers: [], elapsedMs: 2, policyReceipt: 'receipt' };
  });
  vi.spyOn(experience, 'validatePrediction').mockImplementation(async (_id, _input, authorize) => ({ valid: !!authorize && await authorize() }));
  const prepareContext = vi.fn(async () => true);
  studio.gateway = vi.fn(async () => ({ gateway: { prepareContext }, state: {} })) as unknown as Studio['gateway'];
  const result = await request(['predict'], 'POST', { space: 'work', agentId: 'allowed-agent', sessionId: 'session1',
    turnId: 'turn1', revision: 1, text: 'Private draft', question: 'intent_route' });
  expect(await result.json()).toMatchObject({ status: 'unknown', reason: 'stale' });
  expect(prepareContext).not.toHaveBeenCalled();
});

it('exposes bounded signed cancellation and receipt validation without accepting client authority', async () => {
  const { request } = setup();
  const scope = { space: 'work', agentId: 'allowed-agent', sessionId: 'session1', turnId: 'turn1', revision: 2, contextKey: 'audience1' };
  expect((await request(['prediction-cancel'], 'POST', scope, { auth: '' })).status).toBe(401);
  expect((await request(['prediction-cancel'], 'POST', scope, { origin: 'https://evil.test' })).status).toBe(403);
  const cancelled = await request(['prediction-cancel'], 'POST', scope);
  expect(cancelled.status).toBe(200); expect(cancelled.headers.get('cache-control')).toBe('no-store');
  expect(await cancelled.json()).toEqual({ cancelled: true });
  const validation = await request(['prediction-validate'], 'POST', { ...scope, policyReceipt: 'client-invented' });
  expect(validation.status).toBe(200); expect(await validation.json()).toEqual({ valid: false });
  expect((await request(['prediction-cancel'], 'POST', { ...scope, personId: 'victim' })).status).toBe(400);
  expect((await request(['predict'], 'POST', undefined, { raw: 'x'.repeat(96_001) })).status).toBe(413);
  expect((await request(['prediction-cancel'], 'POST', undefined, { raw: 'x'.repeat(16_385) })).status).toBe(413);
});

it('prewarms only authorized read-only context and rechecks receipt after awaited preparation', async () => {
  const { experience, studio, request } = setup();
  const input = { space: 'work', agentId: 'allowed-agent', sessionId: 'session1', turnId: 'turn1', revision: 2, contextKey: 'audience1', text: 'Current draft', question: 'intent_route' };
  vi.spyOn(experience, 'predict').mockResolvedValue({ status: 'answered', model: 'gpt-6-luna', answers: [], elapsedMs: 2, policyReceipt: 'receipt' });
  const validation = vi.spyOn(experience, 'validatePrediction').mockResolvedValue({ valid: true });
  const prepareContext = vi.fn(async () => true);
  studio.gateway = vi.fn(async () => ({ gateway: { prepareContext }, state: {} })) as unknown as Studio['gateway'];
  const result = await request(['predict'], 'POST', input);
  expect(await result.json()).toMatchObject({ status: 'answered', preparedContext: true });
  expect(prepareContext).toHaveBeenCalledWith('allowed-agent', expect.any(String), 'Current draft', expect.objectContaining({ space: 'work', authorize: expect.any(Function) }));
  prepareContext.mockImplementation(async () => { validation.mockResolvedValue({ valid: false }); return true; });
  const revoked = await request(['predict'], 'POST', input);
  expect(await revoked.json()).toMatchObject({ status: 'unknown', reason: 'stale' });
});
it('bounds context prewarm time and leaves semantic/baseline flow available', async () => {
  const { experience, studio, request } = setup();
  const input = { space: 'work', agentId: 'allowed-agent', sessionId: 'session1', turnId: 'turn1', revision: 2, contextKey: 'audience1', text: 'Current draft', question: 'intent_route' };
  vi.spyOn(experience, 'predict').mockResolvedValue({ status: 'answered', model: 'gpt-6-luna', answers: [], elapsedMs: 2, policyReceipt: 'receipt' });
  vi.spyOn(experience, 'validatePrediction').mockResolvedValue({ valid: true });
  const prepareContext = vi.fn(() => new Promise<boolean>(() => {}));
  studio.gateway = vi.fn(async () => ({ gateway: { prepareContext }, state: {} })) as unknown as Studio['gateway'];
  const result = await request(['predict'], 'POST', input);
  expect(await result.json()).toMatchObject({ status: 'answered', preparedContext: false });
});


it('saves an explicit proxied preference without relaxing account, origin or opt-in authority', async () => {
  const { studio, experience, adaptive } = setup(); const before = await adaptive.confirm(123, { confirm: true });

  const publicOrigin = 'https://vox.test';
  const internalOrigin = 'https://127.0.0.1:3107';
  studio.deps.webAppUrl = `${publicOrigin}/studio`;

  const payload = { space: 'work', expectedRevision: before.revision, eventId: 'proxy-preference-event', agentId: 'allowed-agent', setting: { key: 'language', value: 'fa' }, action: 'set' };
  const proxy = (extra: Record<string, string> = {}) => handleExperienceRequest(studio, experience, new Request(`${internalOrigin}/api/studio/experience/preferences`, {
    method: 'PUT', headers: { 'x-telegram-init-data': signInitData({ id: 123, first_name: 'Synthetic' }, TOKEN), 'content-type': 'application/json', origin: publicOrigin, 'sec-fetch-site': 'same-origin', ...extra },
    body: JSON.stringify(payload),
  }), ['preferences'], TOKEN);

  // Forwarding/Host headers cannot expand the server-owned origin allowlist.
  const rejectedHeaders: Record<string, string>[] = [
    { origin: 'https://hostile.test', host: 'hostile.test', 'x-forwarded-host': 'hostile.test', 'x-forwarded-proto': 'https' },
    { origin: internalOrigin },
    { origin: publicOrigin, 'sec-fetch-site': 'cross-site' },
    { origin: '' },
  ];
  for (const headers of rejectedHeaders) {
    const result = await proxy(headers);
    expect(result.status).toBe(403); expect(await result.json()).toEqual({ error: 'origin_denied' });
  }
  studio.deps.webAppUrl = '';
  const invalid = await proxy({ origin: internalOrigin });
  expect(invalid.status).toBe(503); expect(await invalid.json()).toEqual({ error: 'origin_unavailable' });
  studio.deps.webAppUrl = `${publicOrigin}/studio`;

  expect((await adaptive.read(123, 'work')).revision).toBe(before.revision);
  const saved = await proxy(); expect(saved.status).toBe(200);
  expect((await saved.json()).preferences[0]).toMatchObject({ applied: false, setting: { key: 'language', value: 'fa' } });
});
