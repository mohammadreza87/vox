/**
 * tirehFlags(): the one reader of the agent-intelligence server flags. Pure
 * unit tests over an injected environment; no process.env, no I/O.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tirehFlags } from '../flags';

describe('tirehFlags voiceShadow (S11L STUDIO_VOICE_SHADOW)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  const REC = { STUDIO_VOICE_RECOGNITION: '1' };

  it('is off when unset, empty or anything but 1', () => {
    expect(tirehFlags({}).voiceShadow).toBe(false);
    for (const value of ['', '0', 'true', 'on', 'yes', '11']) {
      expect(tirehFlags({ ...REC, STUDIO_VOICE_SHADOW: value }).voiceShadow).toBe(false);
    }
  });

  it('is on only for 1, trimmed, with STUDIO_VOICE_RECOGNITION on', () => {
    expect(tirehFlags({ ...REC, STUDIO_VOICE_SHADOW: '1' }).voiceShadow).toBe(true);
    expect(tirehFlags({ ...REC, STUDIO_VOICE_SHADOW: ' 1 ' }).voiceShadow).toBe(true);
  });

  // F207, F260: composed with its parent like promptSystemTail and vectorRetrieval.
  it('is off without STUDIO_VOICE_RECOGNITION, whatever STUDIO_VOICE_SHADOW says', () => {
    for (const recognition of [undefined, '', '0', 'true']) {
      expect(tirehFlags({ STUDIO_VOICE_RECOGNITION: recognition, STUDIO_VOICE_SHADOW: '1' }).voiceShadow).toBe(false);
    }
    expect(tirehFlags({ STUDIO_VOICE_SHADOW: '1' })).toEqual(tirehFlags({}));
  });

  it('changes nothing but itself when on', () => {
    const shadow = tirehFlags({ ...REC, STUDIO_VOICE_SHADOW: '1' });
    expect({ ...shadow, voiceShadow: false }).toEqual(tirehFlags(REC));
    expect(tirehFlags(REC).voiceShadow).toBe(false);
  });

  it('reads the process environment at call time by default', () => {
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '1');
    vi.stubEnv('STUDIO_VOICE_SHADOW', '1');
    expect(tirehFlags().voiceShadow).toBe(true);
    vi.stubEnv('STUDIO_VOICE_SHADOW', '0');
    expect(tirehFlags().voiceShadow).toBe(false);
    vi.stubEnv('STUDIO_VOICE_SHADOW', '1');
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '');
    expect(tirehFlags().voiceShadow).toBe(false);
  });
});

describe('tirehFlags voiceRecognition (S11L STUDIO_VOICE_RECOGNITION)', () => {
  it('is on for 1 with surrounding whitespace (F045, F159, F245: every reader goes through tirehFlags)', () => {
    for (const value of ['1', ' 1', '1 ', ' 1\n', '1\r']) expect(tirehFlags({ STUDIO_VOICE_RECOGNITION: value }).voiceRecognition).toBe(true);
    for (const value of [undefined, '', '0', 'true', '11']) expect(tirehFlags({ STUDIO_VOICE_RECOGNITION: value }).voiceRecognition).toBe(false);
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
