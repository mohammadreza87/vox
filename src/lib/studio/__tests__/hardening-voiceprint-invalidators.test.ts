/**
 * H5 (VF-S11L low, allSettled): the single adaptive invalidator slot chains VoiceIdentityService and voiceprints
 * with main's semantics. A rejecting first handler no longer stops the voiceprint deletion; the chain still rejects
 * afterwards with the first rejection.
 */
import { describe, expect, it, vi } from 'vitest';
import { chainVoiceInvalidators } from '../identity/voice';
import { setupVoiceprints } from './voiceprint-fixtures';

describe('chainVoiceInvalidators (H5)', () => {
  it('the first handler rejects, the second still runs, and the chain rejects afterwards with the first error', async () => {
    const order: string[] = [];
    const first = { invalidate: vi.fn(async () => { order.push('first'); throw new Error('first failed'); }) };
    const second = { invalidate: vi.fn(async (telegramId: number, space?: 'work' | 'personal') => { order.push(`second:${telegramId}:${space}`); }) };
    const chain = chainVoiceInvalidators(first, second);
    await expect(chain({ telegramId: 7, space: 'work', reason: 'consent_withdrawn' })).rejects.toThrow('first failed');
    expect(order).toEqual(['first', 'second:7:work']);
    expect(second.invalidate).toHaveBeenCalledWith(7, 'work');
  });

  it('a synchronously throwing handler is contained the same way; the first rejection wins over later ones', async () => {
    const a = { invalidate: vi.fn((): Promise<void> => { throw new Error('sync a'); }) };
    const b = { invalidate: vi.fn(async () => { throw new Error('b'); }) };
    const c = { invalidate: vi.fn(async () => undefined) };
    await expect(chainVoiceInvalidators(a, b, c)({ telegramId: 1, reason: 'profile_changed' })).rejects.toThrow('sync a');
    expect(c.invalidate).toHaveBeenCalledWith(1, undefined);
  });

  it('resolves when every handler resolves, and keeps each handler as `this`', async () => {
    class Handler { calls = 0; async invalidate() { this.calls++; } }
    const x = new Handler(), y = new Handler();
    await expect(chainVoiceInvalidators(x, y)({ telegramId: 2, space: 'personal', reason: 'r' })).resolves.toBeUndefined();
    expect([x.calls, y.calls]).toEqual([1, 1]);
  });

  it('wired into the adaptive slot: a failing VoiceIdentityService still lets a withdrawal delete the voiceprint', async () => {
    const s = await setupVoiceprints({ chain: false });
    s.voiceIdentity.invalidate.mockRejectedValue(new Error('voice identity down'));
    s.adaptive.setVoiceIdentityInvalidator(chainVoiceInvalidators(s.voiceIdentity, s.service));
    await s.enroll();
    expect(await s.store.get(s.personId, 'work')).not.toBeNull();
    await s.consent('work', 'withdrawn').catch(() => undefined);
    expect(s.voiceIdentity.invalidate).toHaveBeenCalledWith(s.telegramId, 'work');
    expect(await s.store.get(s.personId, 'work')).toBeNull();
  });
});
