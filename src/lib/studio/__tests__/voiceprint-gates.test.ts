import { existsSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdaptiveDocument } from '../../adaptive/persistence/repository';
import { biometricGrant, VoiceprintError } from '../identity/voice';
import { setupVoiceprints, THRESHOLDS } from './voiceprint-fixtures';

type Setup = Awaited<ReturnType<typeof setupVoiceprints>>;

/** Asserts a refusal with zero provider, speech, echo or store-write activity and no voiceprint file. */
async function expectRefused(s: Setup, status: number, code: string) {
  const put = vi.spyOn(s.store, 'put');
  const error = await s.enroll().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(VoiceprintError);
  expect(error).toMatchObject({ status, code, message: code });
  expect(s.provider.voiceprint).not.toHaveBeenCalled();
  expect(s.provider.identify).not.toHaveBeenCalled();
  expect(s.speech.measure).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
  expect(existsSync(s.storePath)).toBe(false);
}

describe('voiceprint enrollment gates', () => {
  it('(1) STUDIO_VOICE_RECOGNITION unset refuses with 404 disabled', async () => {
    const s = await setupVoiceprints({ flag: false, store: 'file' });
    await expectRefused(s, 404, 'disabled');
    expect(s.selfEcho.templates).not.toHaveBeenCalled();
  });

  it('(2) flag set but voiceRecognitionEnabled false keeps the feature_not_released deny', async () => {
    const s = await setupVoiceprints({ voiceRecognitionEnabled: false, store: 'file' });
    const status = await s.adaptive.withAccountDocument(s.telegramId, (d, now) => s.adaptive.capabilityStatus(d, 'biometric_recognition', now));
    expect(status).toEqual({ eligible: false, reason: 'feature_not_released' });
    await expectRefused(s, 403, 'capability_unavailable');
  });

  it('(3) a manifest without biometric_recognition approval refuses with capability_unavailable', async () => {
    const s = await setupVoiceprints({ approve: false, store: 'file' });
    await expectRefused(s, 403, 'capability_unavailable');
  });

  it('(4) an unconfirmed profile refuses with profile_confirmation_required', async () => {
    const s = await setupVoiceprints({ confirm: false, store: 'file' });
    await expectRefused(s, 403, 'profile_confirmation_required');
  });

  it.each([
    ['not_asked', async (_s: Setup) => undefined],
    ['presented only', async (s: Setup) => { await s.present(); }],
    ['declined', async (s: Setup) => { await s.consent('work', 'declined'); }],
    ['withdrawn', async (s: Setup) => { await s.consent('work'); await s.consent('work', 'withdrawn'); }],
  ])('(5) consent %s refuses with biometric_consent_required', async (_label, arrange) => {
    const s = await setupVoiceprints({ consent: false, store: 'file' });
    await arrange(s);
    await expectRefused(s, 403, 'biometric_consent_required');
  });

  it('(6) biometricGrant() is null when the last event lacks affirmative evidence', async () => {
    const s = await setupVoiceprints();
    const doc = await s.adaptive.withAccountDocument(s.telegramId, d => structuredClone(d) as AdaptiveDocument);
    expect(biometricGrant(doc, 'work', s.now())).not.toBeNull();
    const permission = doc.permissions.find(p => p.purpose === 'optional.biometric_recognition' && p.spaceId.endsWith(':work'))!;
    const withoutEvidence = structuredClone(doc);
    withoutEvidence.consentEvents = withoutEvidence.consentEvents.map(e => e.eventId === permission.lastEventId
      ? (({ evidence: _evidence, ...rest }) => rest)(e) : e) as AdaptiveDocument['consentEvents'];
    expect(biometricGrant(withoutEvidence, 'work', s.now())).toBeNull();
    const notAffirmative = structuredClone(doc);
    notAffirmative.consentEvents = notAffirmative.consentEvents.map(e => e.eventId === permission.lastEventId && e.evidence
      ? { ...e, evidence: { ...e.evidence, affirmative: false } } : e) as unknown as AdaptiveDocument['consentEvents'];
    expect(biometricGrant(notAffirmative, 'work', s.now())).toBeNull();
    const missingEvent = structuredClone(doc);
    missingEvent.consentEvents = missingEvent.consentEvents.filter(e => e.eventId !== permission.lastEventId);
    expect(biometricGrant(missingEvent, 'work', s.now())).toBeNull();
    const otherPerson = structuredClone(doc);
    otherPerson.consentEvents = otherPerson.consentEvents.map(e => e.eventId === permission.lastEventId ? { ...e, personId: 'someone-else' } : e);
    expect(biometricGrant(otherPerson, 'work', s.now())).toBeNull();
    expect(biometricGrant(doc, 'personal', s.now())).toBeNull();
  });

  it('(7) a pending member (eligiblePerson false) refuses with not_member', async () => {
    const s = await setupVoiceprints({ store: 'file' });
    s.members.set(s.telegramId, false);
    await expectRefused(s, 403, 'not_member');
  });

  it('(8) the internal-pilot manifest withholds the provider: 503 provider_unavailable', async () => {
    const s = await setupVoiceprints({ pilot: true, store: 'file' });
    await expectRefused(s, 503, 'provider_unavailable');
  });

  it('(9) unset thresholds refuse with 503 thresholds_unconfigured', async () => {
    const s = await setupVoiceprints({ thresholds: null, store: 'file' });
    await expectRefused(s, 503, 'thresholds_unconfigured');
  });

  it('a missing provider, speech activity or echo source is provider_unavailable; an echo source that is not ready is self_echo_unavailable', async () => {
    const s = await setupVoiceprints({ service: { provider: undefined } });
    await expectRefused(s, 503, 'provider_unavailable');
    const t = await setupVoiceprints({ store: 'file' });
    t.selfEcho.list = null;
    await expectRefused(t, 503, 'self_echo_unavailable');
  });

  it('(10) with every gate, enrollment succeeds and status shows enrolled without template bytes', async () => {
    const s = await setupVoiceprints({ store: 'file' });
    const status = await s.enroll();
    expect(status).toEqual({ space: 'work', available: true, consent: 'granted', enrolled: true, provider: 'fake-vp', modelVersion: 'fake-vp:1',
      channel: 'mini_app', createdAt: new Date(s.now()).toISOString() });
    expect(status).not.toHaveProperty('template');
    expect(status).not.toHaveProperty('consentEventId');
    expect(s.provider.voiceprint).toHaveBeenCalledTimes(1);
    expect(s.speech.measure).toHaveBeenCalledTimes(1);
    expect(s.provider.identifyCalls.map(c => c.labels)).toEqual([['echo-0']]);
    expect(s.provider.labelsContainPersonIds()).toBe(false);
    const row = await s.store.get(s.personId, 'work');
    expect(row).toMatchObject({ personId: s.personId, space: 'work', provider: 'fake-vp', modelVersion: 'fake-vp:1', channel: 'mini_app' });
    expect(Object.keys(row!).sort()).toEqual(['channel', 'consentEventId', 'createdAt', 'modelVersion', 'personId', 'provider', 'space', 'template']);
    expect(row!.template.startsWith('vp1.')).toBe(true);
    expect(await s.service.status(s.telegramId, 'personal')).toMatchObject({ enrolled: false, consent: 'missing', available: false, reason: 'biometric_consent_required' });
  });

  it('enrollment refusals after capture: too large, mixed speakers, too short and self-echo leave no row', async () => {
    const s = await setupVoiceprints();
    await expect(s.enroll('work', new Uint8Array(0))).rejects.toMatchObject({ status: 413, code: 'too_large' });
    s.speech.result = { netSpeechMs: 20_000, speakers: 2 };
    await expect(s.enroll()).rejects.toMatchObject({ status: 422, code: 'mixed_speakers' });
    s.speech.result = { netSpeechMs: 9_999, speakers: 1 };
    await expect(s.enroll()).rejects.toMatchObject({ status: 422, code: 'too_short' });
    s.speech.result = { netSpeechMs: 10_000, speakers: 1 };
    s.provider.scores.set('echo-0', THRESHOLDS.default!.selfEcho);
    await expect(s.enroll()).rejects.toMatchObject({ status: 422, code: 'self_echo' });
    expect(await s.store.get(s.personId, 'work')).toBeNull();
    s.provider.scores.set('echo-0', 0.1);
    s.provider.mode = 'throw';
    await expect(s.enroll()).rejects.toMatchObject({ status: 502, code: 'provider_error' });
    expect(s.logger.warn).toHaveBeenCalledWith('voiceprint_provider_error');
    expect(s.logger.warn.mock.calls.every(call => call.length === 1)).toBe(true);
    expect(await s.store.get(s.personId, 'work')).toBeNull();
  });

  it('an enrollment past its deadline is 504 timeout with no row', async () => {
    const s = await setupVoiceprints({ service: { enrollDeadlineMs: 20 } });
    s.provider.mode = 'hang';
    await expect(s.enroll()).rejects.toMatchObject({ status: 504, code: 'timeout' });
    expect(await s.store.get(s.personId, 'work')).toBeNull();
  });
});
