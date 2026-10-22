import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTelegramWebhookToken } from './verify';

const request = (token?: string) => new NextRequest('https://vox.example/api/telegram/webhook', {
  method: 'POST', headers: token === undefined ? {} : { 'X-Telegram-Bot-Api-Secret-Token': token },
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('verifyTelegramWebhookToken', () => {
  it('fails closed when TELEGRAM_WEBHOOK_SECRET is unset', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '');
    expect(verifyTelegramWebhookToken(request())).toBe(false);
    expect(verifyTelegramWebhookToken(request('anything'))).toBe(false);
  });

  it('accepts only the configured secret', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 's3cret-token');
    expect(verifyTelegramWebhookToken(request('s3cret-token'))).toBe(true);
    expect(verifyTelegramWebhookToken(request('s3cret-tokeN'))).toBe(false);
    expect(verifyTelegramWebhookToken(request('short'))).toBe(false);
    expect(verifyTelegramWebhookToken(request())).toBe(false);
  });
});
