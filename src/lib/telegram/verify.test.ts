import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTelegramWebhookToken } from './verify';

const request = (token?: string) => new NextRequest('https://vox.example/api/telegram/webhook', {
  method: 'POST', headers: token === undefined ? {} : { 'X-Telegram-Bot-Api-Secret-Token': token },
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('verifyTelegramWebhookToken', () => {
  it('with TELEGRAM_WEBHOOK_FAIL_CLOSED unset and no secret, keeps the earlier skip-verification behaviour and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '');
    vi.stubEnv('TELEGRAM_WEBHOOK_FAIL_CLOSED', '');
    expect(verifyTelegramWebhookToken(request())).toBe(true);
    expect(verifyTelegramWebhookToken(request('anything'))).toBe(true);
    expect(warn).toHaveBeenCalledWith('TELEGRAM_WEBHOOK_SECRET not configured - webhook verification skipped');
  });

  it('with TELEGRAM_WEBHOOK_FAIL_CLOSED=1 and no secret, fails closed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '');
    vi.stubEnv('TELEGRAM_WEBHOOK_FAIL_CLOSED', '1');
    expect(verifyTelegramWebhookToken(request())).toBe(false);
    expect(verifyTelegramWebhookToken(request('anything'))).toBe(false);
  });

  it('with a secret configured, the flag does not change verification', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 's3cret-token');
    for (const flag of ['', '1']) {
      vi.stubEnv('TELEGRAM_WEBHOOK_FAIL_CLOSED', flag);
      expect(verifyTelegramWebhookToken(request('s3cret-token'))).toBe(true);
      expect(verifyTelegramWebhookToken(request('wrong-token!'))).toBe(false);
      expect(verifyTelegramWebhookToken(request())).toBe(false);
    }
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
