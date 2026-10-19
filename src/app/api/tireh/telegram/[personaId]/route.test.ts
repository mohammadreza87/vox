import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const handleUpdate = vi.fn();

vi.mock('@/lib/tireh/runtime', () => ({
  getPersonaGateway: vi.fn(async () => ({ handleUpdate })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { POST } = await import('./route');

function request(body: unknown, secret?: string) {
  return new NextRequest('http://localhost/api/tireh/telegram/aria', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret !== undefined ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ personaId: 'aria' }) };
const update = { update_id: 1, message: { message_id: 1, chat: { id: 1, type: 'private' }, date: 0, text: 'hi' } };

describe('POST /api/tireh/telegram/[personaId]', () => {
  beforeEach(() => {
    handleUpdate.mockReset();
    process.env.TIREH_WEBHOOK_SECRET = 'correct-secret';
  });
  afterEach(() => {
    delete process.env.TIREH_WEBHOOK_SECRET;
  });

  it('is disabled (503) when no secret is configured', async () => {
    delete process.env.TIREH_WEBHOOK_SECRET;
    const res = await POST(request(update, 'anything'), params);
    expect(res.status).toBe(503);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('rejects missing or wrong secrets with 403', async () => {
    expect((await POST(request(update), params)).status).toBe(403);
    expect((await POST(request(update, 'wrong-secret!'), params)).status).toBe(403);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies with 400', async () => {
    expect((await POST(request('{not json', 'correct-secret'), params)).status).toBe(400);
    expect((await POST(request({ hello: 1 }, 'correct-secret'), params)).status).toBe(400);
  });

  it('passes valid updates to the gateway', async () => {
    handleUpdate.mockResolvedValue('replied');
    const res = await POST(request(update, 'correct-secret'), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: 'replied' });
    expect(handleUpdate).toHaveBeenCalledWith('aria', update);
  });

  it('returns 404 for unknown personas', async () => {
    handleUpdate.mockResolvedValue('unknown-persona');
    expect((await POST(request(update, 'correct-secret'), params)).status).toBe(404);
  });

  it('returns 200 on processing errors so Telegram does not retry forever', async () => {
    handleUpdate.mockRejectedValue(new Error('boom'));
    const res = await POST(request(update, 'correct-secret'), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });
});
