import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webhookSecret } from '@/lib/studio/updates';
import { makeStudio, SECRET, seedOrg, type Harness } from '@/lib/studio/__tests__/helpers';

let h: Harness;
vi.mock('@/lib/studio/runtime', () => ({ getStudio: async () => h.studio }));

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
    delete process.env.STUDIO_PUBLIC_URL;
  });

  it('rejects a missing or another bot\'s secret', async () => {
    expect((await call('manager', start)).status).toBe(403);
    expect((await call('manager', start, { 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'ag-x') })).status).toBe(403);
    expect(h.manager.sendMessage).not.toHaveBeenCalled();
  });

  it('handles VoxxBot updates with the right secret', async () => {
    const res = await call('manager', start, { 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'manager') });
    expect(res.status).toBe(200);
    expect(h.manager.sendMessage).toHaveBeenCalledWith(7070, expect.stringContaining("You're on the list"), {});
  });

  it('answers 400 on bad JSON and 200 for unknown agents', async () => {
    expect((await call('manager', '{', { 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'manager') })).status).toBe(400);
    expect((await call('ag-gone', start, { 'x-telegram-bot-api-secret-token': webhookSecret(SECRET, 'ag-gone') })).status).toBe(200);
  });

  it('setup needs the studio secret and a public URL', async () => {
    expect((await call('setup', {}, { authorization: 'Bearer wrong' })).status).toBe(403);
    expect((await call('setup', {}, { authorization: `Bearer ${SECRET}` })).status).toBe(400);
    process.env.STUDIO_PUBLIC_URL = 'https://vox.example';
    const res = await call('setup', {}, { authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ manager: true, agents: [], failed: [] });
    expect(h.manager.setWebhook).toHaveBeenCalled();
  });
});
