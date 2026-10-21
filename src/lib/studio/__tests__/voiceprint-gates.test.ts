import { describe, expect, it } from 'vitest';
import { MAX_ENROLL_AUDIO_BYTES } from '../identity/voice';
import { PERSON_ID, setupVoiceprints, TELEGRAM_ID } from './voiceprint-fixtures';

describe('voiceprint enrollment gates', () => {
  it('refuses with STUDIO_VOICE_RECOGNITION unset and never calls the provider', async () => {
    const { enroll, provider, store } = await setupVoiceprints({ flag: false });
    await expect(enroll()).rejects.toMatchObject({ code: 'disabled', status: 403 });
    expect(provider.voiceprint).not.toHaveBeenCalled();
    expect(provider.identify).not.toHaveBeenCalled();
    expect(await store.get(PERSON_ID, 'work')).toBeNull();
  });

  it('keeps the base adaptive deny with the flag unset', async () => {
    const { adaptive, changeConsent } = await setupVoiceprints({ flag: false });
    const status = await adaptive.withDirectAuthority(TELEGRAM_ID, 'work', (d, now) => ({ value: adaptive.capabilityStatus(d, 'biometric_recognition', now) }));
    expect(status.reason).toBe('feature_not_released');
    await expect(changeConsent()).rejects.toMatchObject({ status: 403, code: 'capability_unavailable' });
  });

  it('requires capability approval for biometric_recognition', async () => {
    const { enroll, provider, service } = await setupVoiceprints({ approve: false });
    await expect(enroll()).rejects.toMatchObject({ code: 'capability_unavailable', status: 403 });
    expect((await service.status({ telegramId: TELEGRAM_ID, personId: PERSON_ID, space: 'work' })).reason).toBe('capability_unavailable');
    expect(provider.voiceprint).not.toHaveBeenCalled();
  });

  it('requires a granted biometric consent', async () => {
    const { enroll, provider } = await setupVoiceprints({ consent: false });
    await expect(enroll()).rejects.toMatchObject({ code: 'biometric_consent_required', status: 403 });
    expect(provider.voiceprint).not.toHaveBeenCalled();
  });

  it('requires a confirmed profile', async () => {
    const { enroll } = await setupVoiceprints({ confirm: false, consent: false });
    await expect(enroll()).rejects.toMatchObject({ code: 'profile_confirmation_required', status: 403 });
  });

  it('enrolls when every gate holds and stores only a sealed contract row', async () => {
    const { enroll, store, adaptive, provider } = await setupVoiceprints();
    const status = await enroll();
    expect(status).toMatchObject({ space: 'work', available: true, enrolled: true, provider: 'fake-vp', modelVersion: 'fake-1', channel: 'mini_app' });
    expect(status).not.toHaveProperty('consentEventId');
    expect(JSON.stringify(status)).not.toContain('vpk1.');
    const row = (await store.get(PERSON_ID, 'work'))!;
    const permission = await adaptive.withDirectAuthority(TELEGRAM_ID, 'work', d => ({
      value: d.permissions.find(p => p.purpose === 'optional.biometric_recognition' && p.spaceId.endsWith('work'))!.lastEventId! }));
    expect(row).toMatchObject({ personId: PERSON_ID, space: 'work', channel: 'mini_app', consentEventId: permission, provider: 'fake-vp', modelVersion: 'fake-1' });
    expect(row.template.startsWith('vpk1.')).toBe(true);
    expect(Object.keys(row).sort()).toEqual(['channel', 'consentEventId', 'createdAt', 'modelVersion', 'personId', 'provider', 'space', 'template']);
    expect(provider.voiceprintCalls.map(c => c.tag)).toEqual(['echo-persona-voice-1', 'reza']);
  });

  it('maps net speech and size limits to 422, 415 and 413', async () => {
    const { enroll, estimator, store } = await setupVoiceprints();
    estimator.set({ netMs: 9_999, grossMs: 15_000 });
    await expect(enroll()).rejects.toMatchObject({ code: 'too_short', status: 422 });
    estimator.set(null);
    await expect(enroll()).rejects.toMatchObject({ code: 'unsupported_audio', status: 415 });
    estimator.set({ netMs: 12_000, grossMs: 31_000 });
    await expect(enroll()).rejects.toMatchObject({ code: 'too_long', status: 413 });
    await expect(enroll('work', new ArrayBuffer(MAX_ENROLL_AUDIO_BYTES + 1))).rejects.toMatchObject({ code: 'too_long', status: 413 });
    await expect(enroll('work', new ArrayBuffer(0))).rejects.toMatchObject({ code: 'empty_audio', status: 400 });
    expect(await store.get(PERSON_ID, 'work')).toBeNull();
  });

  it('refuses a sample that matches a Vox persona voice', async () => {
    const { enroll, provider, store } = await setupVoiceprints();
    provider.scores.set('reza->echo-persona-voice-1', 0.7);
    await expect(enroll()).rejects.toMatchObject({ code: 'self_echo', status: 422 });
    expect(await store.get(PERSON_ID, 'work')).toBeNull();
    expect(provider.voiceprintCalls.map(c => c.tag)).toEqual(['echo-persona-voice-1']);
  });

  it('refuses without any echo voice (the self-echo guard is mandatory)', async () => {
    const { enroll, provider } = await setupVoiceprints({ echo: false });
    await expect(enroll()).rejects.toMatchObject({ code: 'echo_guard_unavailable', status: 503 });
    expect(provider.voiceprint).not.toHaveBeenCalled();
  });

  it('maps provider failures to 502 and missing thresholds to 503', async () => {
    const failing = await setupVoiceprints();
    failing.provider.mode = 'throw';
    await expect(failing.enroll()).rejects.toMatchObject({ code: 'echo_guard_unavailable', status: 503 });
    await failing.service.registerEchoVoice('persona-voice-1', new ArrayBuffer(4), 'audio/mpeg').catch(() => undefined);
    const noThresholds = await setupVoiceprints({ thresholds: null });
    await expect(noThresholds.enroll()).rejects.toMatchObject({ code: 'thresholds_missing', status: 503 });
    const flaky = await setupVoiceprints();
    await flaky.service.ensureEchoTemplates();
    flaky.provider.identify.mockRejectedValueOnce(new Error('synthetic'));
    await expect(flaky.enroll()).rejects.toMatchObject({ code: 'provider_error', status: 502 });
  });
});
