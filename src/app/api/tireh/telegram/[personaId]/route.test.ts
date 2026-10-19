import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { getPersonaGateway } from '@/lib/tireh/runtime';
import { hire, makeStudio, seedOrg } from '@/lib/studio/__tests__/helpers';
import { expectContentFreeTelegramLogs, telegramCanary, telegramCanaryError } from '@/test/telegram-diagnostics';

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
    vi.mocked(getPersonaGateway).mockReset().mockResolvedValue({ handleUpdate } as unknown as Awaited<ReturnType<typeof getPersonaGateway>>);
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.info).mockClear();
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
    handleUpdate.mockRejectedValue(telegramCanaryError());
    const privateUpdate = { ...update, update_id: telegramCanary.update, message: { ...update.message, text: telegramCanary.transcript, chat: { ...update.message.chat, id: telegramCanary.chat } } };
    const res = await POST(request(privateUpdate, 'correct-secret'), { params: Promise.resolve({ personaId: telegramCanary.persona }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
    expect(logger.error).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'persona_webhook', reason: 'operation_failed', outcome: 'http_200' });
    expectContentFreeTelegramLogs([...vi.mocked(logger.error).mock.calls, ...vi.mocked(logger.warn).mock.calls, ...vi.mocked(logger.info).mock.calls]);
  });

  it('keeps gateway startup errors private and returns the same processing acknowledgement', async () => {
    vi.mocked(getPersonaGateway).mockRejectedValueOnce(telegramCanaryError());
    const res = await POST(request(update, 'correct-secret'), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
    expect(handleUpdate).not.toHaveBeenCalled();
    expectContentFreeTelegramLogs(vi.mocked(logger.error).mock.calls);
  });

  it('runs the actual gateway and preserves success and duplicate responses without extra sends', async () => {
    const h = makeStudio();
    const org = await seedOrg(h);
    const { agent, bot } = await hire(h, org.alice, { name: telegramCanary.persona });
    const { gateway } = await h.studio.gateway();
    vi.mocked(getPersonaGateway).mockResolvedValue(gateway);
    const incoming = { update_id: telegramCanary.update, message: { message_id: 1, from: { id: org.alice.telegramId, is_bot: false, first_name: 'Alice' }, chat: { id: org.alice.telegramId, type: 'private' }, date: 0, text: telegramCanary.transcript } };
    const agentParams = { params: Promise.resolve({ personaId: agent.id }) };
    const res = await POST(request(incoming, 'correct-secret'), agentParams);
    expect(await res.json()).toEqual({ ok: true, result: 'replied' });
    expect(res.status).toBe(200);
    const replay = await POST(request(incoming, 'correct-secret'), agentParams);
    expect(await replay.json()).toEqual({ ok: true, result: 'duplicate' });
    expect(bot().sendMessage).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
