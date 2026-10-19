import { describe, expect, it, vi } from 'vitest';
import { logTelegramDiagnostic, profileStepDiagnostic, voiceFailureDiagnostic, type TelegramDiagnostic } from './diagnostics';
import { expectContentFreeTelegramLogs, telegramCanary, telegramCanaryError } from '@/test/telegram-diagnostics';

describe('Telegram diagnostic allowlist', () => {
  it('emits only a fixed projection and drops unknown or inherited event keys', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logTelegramDiagnostic(log, 'poll_failed');
    for (const event of [telegramCanary.transcript, 'constructor', '__proto__', 'toString']) {
      logTelegramDiagnostic(log, event as TelegramDiagnostic);
    }
    expect(log.warn.mock.calls).toEqual([[{
      type: 'telegram_ingress', stage: 'poll', reason: 'operation_failed', outcome: 'retry_scheduled',
    }]]);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expectContentFreeTelegramLogs(log.warn.mock.calls);
  });

  it('classifies only exact known provider codes and does not inspect error content', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const contentGetter = vi.fn(() => { throw telegramCanaryError(); });
    const hostile = Object.defineProperties({}, {
      message: { get: contentGetter }, stack: { get: contentGetter }, cause: { get: contentGetter },
      code: { get: () => { throw telegramCanaryError(); } },
    });
    for (const error of [telegramCanaryError(), { code: 'private_canary_secret' }, hostile, new Proxy({}, { has: () => { throw telegramCanaryError(); } })]) {
      const event = voiceFailureDiagnostic(error);
      expect(event).toBe('voice_delivery_failed');
      logTelegramDiagnostic(log, event);
    }
    expect(contentGetter).not.toHaveBeenCalled();
    for (const code of ['payment_required', 'quota_exceeded', 'permission_denied', 'rate_limited', 'unavailable', 'provider_error']) {
      logTelegramDiagnostic(log, voiceFailureDiagnostic({ code }));
      expect(log.error).toHaveBeenLastCalledWith({ type: 'telegram_ingress', stage: 'voice_delivery', reason: code, outcome: 'text_fallback' });
    }
    expectContentFreeTelegramLogs(log.error.mock.calls, ['private_canary_secret']);
    expect(profileStepDiagnostic(telegramCanary.credential)).toBe('profile_apply_failed');
    expect(profileStepDiagnostic('__proto__')).toBe('profile_apply_failed');
  });
});
