import { describe, expect, it, vi } from 'vitest';
import { signInitData } from '../../studio/auth';
import type { Studio } from '../../studio/service';
import { handleSharedRequest } from '../shared/http';
import { SharedMemoryError, type SharedMemoryService } from '../shared/service';
const TOKEN = '12345:shared-synthetic-token';
function setup() {
  const service = { list: vi.fn(async () => ({ revision: 1, space: 'work', containers: [] })),
    preview: vi.fn(async () => ({ previewToken: 'synthetic-preview', recipients: [], expiresAt: 123, authorityRevision: 'synthetic' })),
    create: vi.fn(async () => ({ revision: 1, space: 'work', containers: [] })), addMemory: vi.fn(), deleteMemory: vi.fn(), revokeParticipant: vi.fn(), setAgentAccess: vi.fn() };
  const studio = { deps: {}, ensureMember: async (user: { id: number }) => ({ telegramId: user.id, role: 'member' }) } as unknown as Studio;
  const auth = signInitData({ id: 101, first_name: 'Synthetic' }, TOKEN);
  const request = (path: string[], options: { method?: string; body?: unknown; raw?: string; auth?: string; origin?: string; contentType?: string; query?: string } = {}) => {
    const mutating = options.body !== undefined || options.raw !== undefined;
    const req = new Request(`https://vox.test/api/studio/shared/${path.join('/')}${options.query ?? ''}`, {
      method: options.method ?? (mutating ? 'POST' : 'GET'),
      headers: { 'x-telegram-init-data': options.auth ?? auth, ...(mutating ? { Origin: options.origin ?? 'https://vox.test', 'Content-Type': options.contentType ?? 'application/json' } : {}) },
      ...(mutating ? { body: options.raw ?? JSON.stringify(options.body) } : {}),
    });
    return handleSharedRequest(studio, service as unknown as SharedMemoryService, req, path, TOKEN);
  };
  return { service, studio, request };
}
describe('shared memory HTTP authentication and privacy boundary', () => {
  it('requires signed Telegram auth and never uses body profile claims as caller identity', async () => {
    const ctx = setup();
    expect((await ctx.request([], { auth: '' })).status).toBe(401);
    expect((await ctx.request([], { auth: 'telegramId=102' })).status).toBe(401);
    expect(ctx.service.list).not.toHaveBeenCalled();
    const result = await ctx.request([], { query: '?space=personal' });
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
    expect(ctx.service.list).toHaveBeenCalledWith(101, 'personal');
    await ctx.request(['preview'], { body: { actor: 102, space: 'work' } });
    expect(ctx.service.preview.mock.calls[0][0]).toBe(101);
  });
  it('blocks pending accounts, hostile origins, oversized bodies and malformed JSON before mutation', async () => {
    const ctx = setup();
    expect((await ctx.request(['preview'], { body: {}, origin: 'https://evil.test' })).status).toBe(403);
    expect((await ctx.request(['preview'], { raw: '{' })).status).toBe(400);
    expect((await ctx.request(['preview'], { raw: 'x'.repeat(8193) })).status).toBe(413);
    expect((await ctx.request(['preview'], { body: {}, contentType: 'text/plain' })).status).toBe(415);
    expect(ctx.service.preview).not.toHaveBeenCalled();
    ctx.studio.ensureMember = async () => ({ telegramId: 101, name: 'Synthetic pending', joinedAt: '', role: 'pending' });
    expect((await ctx.request([])).status).toBe(403);
  });
  it('routes CAS mutations with exact container/memory/recipient identity from URL', async () => {
    const ctx = setup(), body = { space: 'work', eventId: 'event-1', expectedRevision: 2 };
    await ctx.request(['containers', 'container-one', 'memories', 'memory-one'], { method: 'DELETE', body });
    expect(ctx.service.deleteMemory).toHaveBeenCalledWith(101, 'container-one', 'memory-one', body);
    await ctx.request(['containers', 'container-one', 'participants', '102'], { body: { ...body, revoked: true } });
    expect(ctx.service.revokeParticipant).toHaveBeenCalledWith(101, 'container-one', 102, { ...body, revoked: true });
    await ctx.request(['containers', 'container-one', 'agents', 'aria'], { method: 'PUT', body: { ...body, allowed: false } });
    expect(ctx.service.setAgentAccess).toHaveBeenCalledWith(101, 'container-one', 'aria', { ...body, allowed: false });
  });
  it('returns sanitized errors without storage details or source text', async () => {
    const ctx = setup();
    ctx.service.list.mockRejectedValueOnce(new Error('PRIVATE_SOURCE_CANARY database credentials'));
    const result = await ctx.request([]);
    expect(result.status).toBe(503); expect(await result.text()).toBe('{"error":"shared_memory_unavailable"}');
    ctx.service.list.mockRejectedValueOnce(new SharedMemoryError(409, 'revision_conflict'));
    const conflict = await ctx.request([]);
    expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: 'revision_conflict' });
  });
});


it('routes shared preview through the configured public proxy without trusting forwarding headers', async () => {
  const { studio, service } = setup();

  const publicOrigin = 'https://vox.test';
  const internalOrigin = 'https://127.0.0.1:3107';
  studio.deps.webAppUrl = `${publicOrigin}/studio`;

  const payload = { space: 'work', recipientTelegramIds: [102], agentIds: [] };
  const proxy = (extra: Record<string, string> = {}) => handleSharedRequest(studio, service as unknown as SharedMemoryService, new Request(`${internalOrigin}/api/studio/shared/preview`, {
    method: 'POST', headers: { 'x-telegram-init-data': signInitData({ id: 101, first_name: 'Synthetic' }, TOKEN), 'content-type': 'application/json', origin: publicOrigin, 'sec-fetch-site': 'same-origin', ...extra },
    body: JSON.stringify(payload),
  }), ['preview'], TOKEN);

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

  expect(service.preview).not.toHaveBeenCalled();
  const preview = await proxy();
  expect(preview.status).toBe(200); expect(preview.headers.get('cache-control')).toBe('no-store');
  expect(service.preview).toHaveBeenCalledExactlyOnceWith(101, payload);
});
