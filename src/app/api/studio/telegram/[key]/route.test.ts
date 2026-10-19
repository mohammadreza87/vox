import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_STUDIO_JSON_BYTES } from '@/lib/studio/http';
import { webhookSecret } from '@/lib/studio/updates';
import { hire, makeStudio, SECRET, seedOrg, type Harness } from '@/lib/studio/__tests__/helpers';

let h: Harness;
const getStudio = vi.hoisted(() => vi.fn());
vi.mock('@/lib/studio/runtime', () => ({ getStudio }));

const { POST } = await import('./route');

const call = (key: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request(`https://vox.example/api/studio/telegram/${key}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ key }),
  });

const start = { update_id: 1, message: { message_id: 1, from: { id: 7070, is_bot: false, first_name: 'Neda' }, chat: { id: 7070, type: 'private' }, date: 0, text: '/start' } };

describe('POST /api/studio/telegram/[key]', () => {
  beforeEach(async () => {
    h = makeStudio();
    await seedOrg(h);
    getStudio.mockReset().mockImplementation(async () => h.studio);
    vi.stubEnv('STUDIO_SECRET', SECRET);
    vi.stubEnv('STUDIO_PUBLIC_URL', '');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('rejects a missing or another bot\'s secret', async () => {
    expect((await call('manager', start)).status).toBe(403);
    expect((await call('manager', start, { 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'ag-x') })).status).toBe(403);
    expect(getStudio).not.toHaveBeenCalled();
    expect(h.manager.sendMessage).not.toHaveBeenCalled();
  });

  it('handles VoxxBot updates with the right secret', async () => {
    const res = await call('manager', start, { 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'manager') });
    expect(res.status).toBe(200);
    expect(h.manager.sendMessage).toHaveBeenCalledWith(7070, expect.stringContaining("You're on the list"), {});
    const reply = h.manager.sendMessage.mock.calls[0][1];
    expect(reply).toContain('First name: Neda');
    expect(reply).toContain('Last name: —');
    expect(reply).toContain('User ID: 7070');
  });

  it('answers 400 on bad JSON and 200 for unknown agents', async () => {
    expect((await call('manager', '{', { 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'manager') })).status).toBe(400);
    expect(getStudio).not.toHaveBeenCalled();
    expect((await call('ag-gone', start, { 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'ag-gone') })).status).toBe(200);
  });

  it('setup needs the studio secret and a public URL', async () => {
    expect((await call('setup', {}, { authorization: 'Bearer wrong' })).status).toBe(403);
    expect((await call('setup', {}, { authorization: SECRET })).status).toBe(403);
    expect(getStudio).not.toHaveBeenCalled();
    expect((await call('setup', {}, { authorization: `Bearer ${SECRET}` })).status).toBe(400);
    process.env.STUDIO_PUBLIC_URL = 'https://vox.example';
    const res = await call('setup', {}, { authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ manager: true, agents: [], failed: [] });
    expect(h.manager.setWebhook).toHaveBeenCalled();
  });

  it('fails before startup if the server secret is missing', async () => {
    vi.stubEnv('STUDIO_SECRET', '');
    expect((await call('manager', start)).status).toBe(503);
    expect(getStudio).not.toHaveBeenCalled();
  });

  it('counts actual streamed webhook bytes before startup despite a false content-length', async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_STUDIO_JSON_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel: cancelled,
    });
    const request = new Request('https://vox.example/api/studio/telegram/manager', {
      method: 'POST', body: stream, duplex: 'half',
      headers: { 'content-length': '1', 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'manager') },
    } as RequestInit);
    expect((await POST(request, { params: Promise.resolve({ key: 'manager' }) })).status).toBe(413);
    expect(cancelled).toHaveBeenCalled();
    expect(getStudio).not.toHaveBeenCalled();
  });

  it('caps setup requests as well as bot updates', async () => {
    const response = await call('setup', '{}', { authorization: `Bearer ${SECRET}`, 'content-length': String(MAX_STUDIO_JSON_BYTES + 1) });
    expect(response.status).toBe(413);
    expect(getStudio).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { update_id: '1' }, { update_id: -1 }])('rejects invalid update shapes before startup: %j', async (update) => {
    expect((await call('manager', update, { 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'manager') })).status).toBe(400);
    expect(getStudio).not.toHaveBeenCalled();
  });

  it('reports an incomplete manager or agent setup as a failed deployment check', async () => {
    process.env.STUDIO_PUBLIC_URL = 'https://vox.example';
    h.studio.deps.managerBot = null;
    expect((await call('setup', {}, { authorization: `Bearer ${SECRET}` })).status).toBe(502);
    h.studio.deps.managerBot = h.manager;
    const org = await seedOrg(h);
    const { agent, bot } = await hire(h, org.alice);
    bot().setWebhook.mockRejectedValueOnce(new Error('provider unavailable'));
    const response = await call('setup', {}, { authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(502);
    expect((await response.json()).failed).toEqual([agent.id]);
  });

  it('keeps setup errors generic and preserves success acknowledgements on handler failures', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      process.env.STUDIO_PUBLIC_URL = 'https://vox.example';
      h.manager.setWebhook.mockRejectedValueOnce(new Error('private provider diagnostic'));
      const response = await call('setup', {}, { authorization: `Bearer ${SECRET}` });
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('private provider diagnostic');
      vi.spyOn(h.studio, 'ensureMember').mockRejectedValueOnce(new Error('handler unavailable'));
      expect((await call('manager', start, { 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'manager') })).status).toBe(200);
    } finally { log.mockRestore(); }
  });
});
