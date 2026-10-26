/**
 * H5 (VF-S11L low, verify cap): verifyVoiceNote applies enroll's MAX_VOICEPRINT_AUDIO_BYTES cap before any store
 * read, authority read, tracking or provider upload. The shared reason union (tireh/identity/voice-band.ts) is
 * byte-pinned and has no 'too_large', so the result carries VERIFY_TOO_LARGE_REASON (its generic bucket).
 */
import { describe, expect, it, vi } from 'vitest';
import { MAX_VOICEPRINT_AUDIO_BYTES, VERIFY_TOO_LARGE_REASON } from '../identity/voice';
import { setupVoiceprints } from './voiceprint-fixtures';

describe('verifyVoiceNote caps the audio size before anything else (H5)', () => {
  it('oversize audio gives no opinion with zero provider, speech, echo, store or authority calls', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.provider.identify.mockClear(); s.provider.voiceprint.mockClear(); s.speech.measure.mockClear(); s.selfEcho.templates.mockClear();
    s.eligiblePerson.mockClear();
    const get = vi.spyOn(s.store, 'get');
    const touch = vi.spyOn(s.store, 'touch');
    const authority = vi.spyOn(s.adaptive, 'withAccountDocument');
    const fence = vi.spyOn(s.adaptive, 'readDirectAuthorityForEffect');
    const audio = new ArrayBuffer(MAX_VOICEPRINT_AUDIO_BYTES + 1);
    expect(await s.service.verifyVoiceNote(s.voiceNote({ audio }))).toEqual({ band: 'NO_OPINION', reason: VERIFY_TOO_LARGE_REASON });
    expect(s.provider.identify).not.toHaveBeenCalled();
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
    expect(s.speech.measure).not.toHaveBeenCalled();
    expect(s.selfEcho.templates).not.toHaveBeenCalled();
    expect(s.eligiblePerson).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
    expect(authority).not.toHaveBeenCalled();
    expect(fence).not.toHaveBeenCalled();
  });

  it('audio at exactly the cap is still verified (positive control)', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    s.provider.identify.mockClear();
    const audio = new ArrayBuffer(MAX_VOICEPRINT_AUDIO_BYTES);
    expect(await s.service.verifyVoiceNote(s.voiceNote({ audio }))).toMatchObject({ band: 'MATCH' });
    expect(s.provider.identify).toHaveBeenCalled();
  });

  it('with the flag off the result stays disabled, whatever the size', async () => {
    const s = await setupVoiceprints();
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '');
    const audio = new ArrayBuffer(MAX_VOICEPRINT_AUDIO_BYTES + 1);
    expect(await s.service.verifyVoiceNote(s.voiceNote({ audio }))).toEqual({ band: 'NO_OPINION', reason: 'disabled' });
  });
});
