import { afterEach, describe, expect, it, vi } from 'vitest';
import { bandFor, parseVoiceThresholds, VoiceprintService, VOICE_VERIFY_TIMEOUT_MS } from '../identity/voice';
import { PERSON_ID, setupVoiceprints, speakerAudio, TELEGRAM_ID, THRESHOLDS } from './voiceprint-fixtures';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const note = (overrides: Record<string, unknown> = {}) => ({
  personaId: 'aria', personId: PERSON_ID, space: 'work' as const, chatKind: 'private' as const, guestAudience: false,
  audio: speakerAudio('reza', 'voice note'), mimeType: 'audio/ogg', durationSec: 5, channel: 'telegram_voice_note' as const, ...overrides,
});

async function enrolled(options: Parameters<typeof setupVoiceprints>[0] = {}) {
  const s = await setupVoiceprints(options);
  await s.enroll();
  await s.grantAgent('aria');
  s.provider.identify.mockClear(); s.provider.voiceprint.mockClear(); s.estimator.estimate.mockClear();
  s.provider.identifyCalls.length = 0;
  s.estimator.set({ netMs: 4_000, grossMs: 5_000 });
  return s;
}

describe('bands and thresholds', () => {
  it('maps scores to bands at the boundaries', () => {
    const t = THRESHOLDS.default;
    expect(bandFor(0.8, t)).toBe('MATCH');
    expect(bandFor(0.99, t)).toBe('MATCH');
    expect(bandFor(0.6, t)).toBe('UNCERTAIN');
    expect(bandFor(0.7999, t)).toBe('UNCERTAIN');
    expect(bandFor(0.5999, t)).toBe('NO_MATCH');
  });

  it('verifies through the provider with netSpeechMs and modelVersion', async () => {
    const s = await enrolled();
    for (const [score, band] of [[0.8, 'MATCH'], [0.6, 'UNCERTAIN'], [0.59, 'NO_MATCH']] as const) {
      s.provider.scores.set('reza->reza', score);
      expect(await s.service.verifyVoiceNote(note())).toEqual({ band, netSpeechMs: 4_000, modelVersion: 'fake-1' });
    }
  });

  it('uses per-org thresholds with a fallback to the default', async () => {
    const s = await enrolled({ thresholds: { default: THRESHOLDS.default, orgs: { HOOR: { match: 0.95, uncertain: 0.9, echo: 0.5 } } } });
    s.provider.scores.set('reza->reza', 0.85);
    expect((await s.service.verifyVoiceNote(note())).band).toBe('NO_MATCH');
    const other = new VoiceprintService({ ...s.service.deps, orgKey: 'Elsewhere' });
    expect((await other.verifyVoiceNote(note())).band).toBe('MATCH');
  });

  it('parseVoiceThresholds rejects inconsistent, out-of-range and extra values', () => {
    expect(parseVoiceThresholds(undefined)).toBeNull();
    expect(parseVoiceThresholds('  ')).toBeNull();
    expect(parseVoiceThresholds(JSON.stringify(THRESHOLDS))).toEqual(THRESHOLDS);
    for (const bad of [
      { default: { match: 0.8, uncertain: 0.6, echo: 0.7 } },
      { default: { match: 0.6, uncertain: 0.6, echo: 0.5 } },
      { default: { match: 1.1, uncertain: 0.6, echo: 0.5 } },
      { default: { match: 0.8, uncertain: 0.6, echo: 0 } },
      { default: { match: 0.8, uncertain: 0.6, echo: 0.5, extra: 1 } },
      { default: { match: 0.8, uncertain: 0.6, echo: 0.5 }, other: true },
      { default: THRESHOLDS.default, orgs: { HOOR: { match: 0.5, uncertain: 0.6, echo: 0.4 } } },
    ]) expect(() => parseVoiceThresholds(JSON.stringify(bad))).toThrow('VOICE_MATCH_THRESHOLDS_JSON is invalid');
    expect(() => parseVoiceThresholds('{nope')).toThrow('VOICE_MATCH_THRESHOLDS_JSON is invalid');
  });
});

describe('verifyVoiceNote guards', () => {
  it('refuses short audio before any store, adaptive or provider call', async () => {
    const s = await enrolled();
    const get = vi.spyOn(s.store, 'get'), authority = vi.spyOn(s.adaptive, 'withDirectAuthority');
    expect(await s.service.verifyVoiceNote(note({ durationSec: 2 }))).toEqual({ band: 'NO_OPINION', reason: 'too_short' });
    expect(get).not.toHaveBeenCalled(); expect(authority).not.toHaveBeenCalled(); expect(s.provider.identify).not.toHaveBeenCalled();
  });

  it('applies the 3 s net-speech guard', async () => {
    const s = await enrolled();
    s.estimator.set({ netMs: 2_999, grossMs: 5_000 });
    expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_OPINION', reason: 'too_short', netSpeechMs: 2_999 });
    s.estimator.set(null);
    expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_OPINION', reason: 'too_short' });
    expect(s.provider.identify).not.toHaveBeenCalled();
    s.estimator.set({ netMs: 3_000, grossMs: 5_000 });
    expect(await s.service.verifyVoiceNote(note())).toMatchObject({ band: 'MATCH', netSpeechMs: 3_000 });
  });

  it('reports self-echo when a persona voice wins at or above the echo threshold', async () => {
    const s = await enrolled();
    s.provider.scores.set('reza->echo-persona-voice-1', 0.95);
    expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_OPINION', reason: 'self_echo', netSpeechMs: 4_000 });
    s.provider.scores.set('reza->echo-persona-voice-1', 0.3);
    s.provider.scores.set('reza->reza', 0.05);
    expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_MATCH', netSpeechMs: 4_000, modelVersion: 'fake-1' });
  });

  it('never reads a template or compares for guests or groups', async () => {
    const s = await enrolled();
    const get = vi.spyOn(s.store, 'get'), echo = vi.spyOn(s.store, 'listEcho'), authority = vi.spyOn(s.adaptive, 'withDirectAuthority');
    const open = vi.spyOn(s.cipher, 'open');
    for (const input of [note({ chatKind: 'group' }), note({ guestAudience: true }), note({ chatKind: 'group', guestAudience: true })]) {
      expect(await s.service.verifyVoiceNote(input)).toEqual({ band: 'NO_OPINION', reason: 'guest_or_group' });
    }
    for (const spy of [get, echo, authority, open, s.estimator.estimate, s.provider.identify, s.provider.voiceprint]) expect(spy).not.toHaveBeenCalled();
  });

  it('is not_enrolled without a template or for a non-account person id', async () => {
    const s = await setupVoiceprints();
    await s.grantAgent('aria');
    expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_OPINION', reason: 'not_enrolled' });
    expect(await s.service.verifyVoiceNote(note({ personId: 'reza' }))).toEqual({ band: 'NO_OPINION', reason: 'not_enrolled' });
    expect(s.provider.identify).not.toHaveBeenCalled();
  });

  it('requires the persona agent grant and keeps the template without it', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_OPINION', reason: 'consent_missing' });
    expect(await s.store.get(PERSON_ID, 'work')).not.toBeNull();
    expect(s.provider.identify).toHaveBeenCalledTimes(1); // the enrollment echo check only
  });

  it('sends only opaque candidate ids', async () => {
    const s = await enrolled();
    await s.service.verifyVoiceNote(note());
    const call = s.provider.identifyCalls.at(-1)!;
    expect(call.candidateIds).toEqual(['self', 'echo:0']);
    expect(JSON.stringify(s.provider.identify.mock.calls[0][1].map((c: { id: string }) => c.id))).not.toMatch(new RegExp(`${PERSON_ID}|${TELEGRAM_ID}`));
  });

  it('maps a provider error and a provider that never answers', async () => {
    const s = await enrolled();
    s.provider.mode = 'throw';
    expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_OPINION', reason: 'provider_error' });
    s.provider.mode = 'hang';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = s.service.verifyVoiceNote(note());
    await vi.waitFor(() => expect(s.provider.identify).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(VOICE_VERIFY_TIMEOUT_MS);
    expect(await pending).toEqual({ band: 'NO_OPINION', reason: 'timeout' });
  });

  it('never rejects, even when the store throws', async () => {
    const s = await enrolled();
    vi.spyOn(s.store, 'get').mockRejectedValue(new Error('store down'));
    await expect(s.service.verifyVoiceNote(note())).resolves.toEqual({ band: 'NO_OPINION', reason: 'provider_error' });
  });

  it('never mutates the audio shared with speech-to-text', async () => {
    const s = await enrolled();
    const input = note();
    const before = new Uint8Array(input.audio.slice(0));
    await s.service.verifyVoiceNote(input);
    expect(new Uint8Array(input.audio)).toEqual(before);
  });

  it('is disabled with the flag unset and refuses oversized audio without a provider call', async () => {
    const s = await enrolled();
    expect((await s.service.verifyVoiceNote(note({ audio: new ArrayBuffer(2_000_001) }))).band).toBe('NO_OPINION');
    expect(s.provider.identify).not.toHaveBeenCalled();
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '');
    expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_OPINION', reason: 'disabled' });
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', ' 1 ');
    expect((await s.service.verifyVoiceNote(note())).band).toBe('MATCH');
  });
});
