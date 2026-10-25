/**
 * tirehFlags(): the one reader of the agent-intelligence server flags. Pure
 * unit tests over an injected environment; no process.env, no I/O.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tirehFlags } from '../flags';

describe('tirehFlags voiceShadow (S11L STUDIO_VOICE_SHADOW)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('is off when unset, empty or anything but 1', () => {
    expect(tirehFlags({}).voiceShadow).toBe(false);
    for (const value of ['', '0', 'true', 'on', 'yes', '11']) {
      expect(tirehFlags({ STUDIO_VOICE_SHADOW: value }).voiceShadow).toBe(false);
    }
  });

  it('is on only for 1, trimmed', () => {
    expect(tirehFlags({ STUDIO_VOICE_SHADOW: '1' }).voiceShadow).toBe(true);
    expect(tirehFlags({ STUDIO_VOICE_SHADOW: ' 1 ' }).voiceShadow).toBe(true);
  });

  it('is independent of the other flags and leaves them unchanged', () => {
    const shadow = tirehFlags({ STUDIO_VOICE_SHADOW: '1' });
    expect({ ...shadow, voiceShadow: false }).toEqual(tirehFlags({}));
    expect(tirehFlags({ STUDIO_VOICE_RECOGNITION: '1' }).voiceShadow).toBe(false);
  });

  it('reads the process environment at call time by default', () => {
    vi.stubEnv('STUDIO_VOICE_SHADOW', '1');
    expect(tirehFlags().voiceShadow).toBe(true);
    vi.stubEnv('STUDIO_VOICE_SHADOW', '0');
    expect(tirehFlags().voiceShadow).toBe(false);
  });
});

describe('tirehFlags webhookFailClosed (legacy TELEGRAM_WEBHOOK_FAIL_CLOSED)', () => {
  it('is off unless the value is 1, trimmed, and independent of the other flags', () => {
    expect(tirehFlags({}).webhookFailClosed).toBe(false);
    for (const value of ['', '0', 'true']) expect(tirehFlags({ TELEGRAM_WEBHOOK_FAIL_CLOSED: value }).webhookFailClosed).toBe(false);
    expect(tirehFlags({ TELEGRAM_WEBHOOK_FAIL_CLOSED: '1' }).webhookFailClosed).toBe(true);
    expect(tirehFlags({ TELEGRAM_WEBHOOK_FAIL_CLOSED: ' 1 ' }).webhookFailClosed).toBe(true);
    expect({ ...tirehFlags({ TELEGRAM_WEBHOOK_FAIL_CLOSED: '1' }), webhookFailClosed: false }).toEqual(tirehFlags({}));
  });
});
