import { describe, expect, it, vi } from 'vitest';
import { chainVoiceInvalidators } from '../identity/voice';
import { PERSON_ID, setupVoiceprints, speakerAudio, TELEGRAM_ID, VP_NOW } from './voiceprint-fixtures';

const note = (overrides: Record<string, unknown> = {}) => ({
  personaId: 'aria', personId: PERSON_ID, space: 'work' as const, chatKind: 'private' as const, guestAudience: false,
  audio: speakerAudio('reza', 'voice note'), mimeType: 'audio/ogg', durationSec: 5, channel: 'telegram_voice_note' as const, ...overrides,
});
const statusOf = (s: Awaited<ReturnType<typeof setupVoiceprints>>, space: 'work' | 'personal' = 'work') =>
  s.service.status({ telegramId: TELEGRAM_ID, personId: PERSON_ID, space });

describe('voiceprint withdrawal and deletion', () => {
  it('deletes the template when consent is withdrawn, through the chained invalidator', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    expect((await statusOf(s)).enrolled).toBe(true);
    await s.changeConsent('work', 'withdrawn');
    expect(await s.store.get(PERSON_ID, 'work')).toBeNull();
    expect(s.otherInvalidator.invalidate).toHaveBeenCalledWith(TELEGRAM_ID, 'work');
    expect(await statusOf(s)).toMatchObject({ enrolled: false, available: false, reason: 'biometric_consent_required' });
  });

  it('withdrawal in Personal leaves the Work template', async () => {
    const s = await setupVoiceprints();
    await s.changeConsent('personal');
    await s.enroll('work');
    await s.enroll('personal');
    await s.changeConsent('personal', 'withdrawn');
    expect(await s.store.get(PERSON_ID, 'personal')).toBeNull();
    expect(await s.store.get(PERSON_ID, 'work')).not.toBeNull();
  });

  it('a profile change (invalidation without space) deletes both spaces', async () => {
    const s = await setupVoiceprints();
    await s.changeConsent('personal');
    await s.enroll('work');
    await s.enroll('personal');
    await s.confirm();
    expect(await s.store.get(PERSON_ID, 'work')).toBeNull();
    expect(await s.store.get(PERSON_ID, 'personal')).toBeNull();
    expect(s.otherInvalidator.invalidate).toHaveBeenCalledWith(TELEGRAM_ID, undefined);
  });

  it('lazily deletes on status after the permission expires', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    // Prove status() itself deletes, independent of the adaptive invalidator.
    s.adaptive.setVoiceIdentityInvalidator(async () => undefined);
    s.setNow(VP_NOW + 366 * 86400_000);
    expect(await statusOf(s)).toMatchObject({ enrolled: false, available: false });
    expect(await s.store.get(PERSON_ID, 'work')).toBeNull();
  });

  it('deleteVoiceprint is idempotent and works with the flag unset', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '');
    expect(await statusOf(s)).toEqual({ space: 'work', available: false, reason: 'disabled', enrolled: true });
    expect(await s.service.delete({ personId: PERSON_ID, space: 'work' })).toEqual({ deleted: 1 });
    expect(await s.service.delete({ personId: PERSON_ID, space: 'work' })).toEqual({ deleted: 0 });
    expect(await s.service.delete({ personId: PERSON_ID })).toEqual({ deleted: 0 });
  });

  it('verification after withdrawal is not_enrolled and never compares', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    await s.grantAgent('aria');
    expect((await s.service.verifyVoiceNote(note())).band).toBe('MATCH');
    s.provider.identify.mockClear();
    await s.changeConsent('work', 'withdrawn');
    expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_OPINION', reason: 'not_enrolled' });
    expect(s.provider.identify).not.toHaveBeenCalled();
  });

  it('a withdrawal while the provider is extracting leaves no template (409)', async () => {
    const s = await setupVoiceprints();
    expect(await s.service.ensureEchoTemplates()).toBe(1);
    let release!: () => void;
    const started = new Promise<void>(resolve => {
      s.provider.voiceprint.mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>(r => { release = r; });
        return new TextEncoder().encode('TPL:reza');
      });
    });
    const pending = s.enroll();
    await started;
    await s.changeConsent('work', 'withdrawn');
    release();
    await expect(pending).rejects.toMatchObject({ code: 'consent_changed', status: 409 });
    expect(await s.store.get(PERSON_ID, 'work')).toBeNull();
  });

  it('chainVoiceInvalidators calls every handler and rethrows the first rejection', async () => {
    const first = { invalidate: vi.fn(async () => { throw new Error('first failed'); }) };
    const second = { invalidate: vi.fn(async () => undefined) };
    const chained = chainVoiceInvalidators(first, second);
    await expect(chained({ telegramId: 5, space: 'work', reason: 'voice_consent_changed' })).rejects.toThrow('first failed');
    expect(first.invalidate).toHaveBeenCalledWith(5, 'work');
    expect(second.invalidate).toHaveBeenCalledWith(5, 'work');
  });
});
