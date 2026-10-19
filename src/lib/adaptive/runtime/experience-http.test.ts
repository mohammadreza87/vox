import { describe, expect, it } from 'vitest';
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
  return { adaptive, experience, studio, request };
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
});
