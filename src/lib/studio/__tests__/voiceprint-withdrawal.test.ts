import { readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { voiceprintDocId } from '../identity/store';
import { deferred, setupVoiceprints } from './voiceprint-fixtures';

describe('voiceprint withdrawal and deletion', () => {
  it('withdrawing consent through the chained invalidator deletes the template from the file store', async () => {
    const s = await setupVoiceprints({ store: 'file' });
    await s.enroll();
    const before = readFileSync(s.storePath, 'utf8');
    expect(before).toContain(s.personId);
    await s.consent('work', 'withdrawn');
    expect(await s.store.get(s.personId, 'work')).toBeNull();
    expect(await s.service.status(s.telegramId, 'work')).toMatchObject({ enrolled: false, consent: 'missing' });
    const after = readFileSync(s.storePath, 'utf8');
    expect(after).not.toContain(s.personId);
    expect(after).not.toContain(voiceprintDocId(s.personId, 'work'));
    expect(JSON.parse(after)).toEqual({ version: 1, rows: [] });
  });

  it('the chained handler calls both VoiceIdentityService.invalidate and VoiceprintService.invalidate', async () => {
    const s = await setupVoiceprints();
    const spy = vi.spyOn(s.service, 'invalidate');
    await s.enroll();
    await s.consent('work', 'withdrawn');
    expect(s.voiceIdentity.invalidate).toHaveBeenCalledWith(s.telegramId, 'work');
    expect(spy).toHaveBeenCalledWith(s.telegramId, 'work');
  });

  it('a profile change (re-confirmation) deletes both spaces', async () => {
    const s = await setupVoiceprints();
    await s.consent('personal');
    await s.enroll('work');
    await s.enroll('personal');
    expect(await s.store.list()).toHaveLength(2);
    await s.confirm();
    expect(await s.store.list()).toHaveLength(0);
    expect(s.voiceIdentity.invalidate).toHaveBeenCalledWith(s.telegramId, undefined);
  });

  it('withdrawing in work leaves the personal row', async () => {
    const s = await setupVoiceprints();
    await s.consent('personal');
    await s.enroll('work');
    await s.enroll('personal');
    await s.consent('work', 'withdrawn');
    expect(await s.store.get(s.personId, 'work')).toBeNull();
    expect(await s.store.get(s.personId, 'personal')).not.toBeNull();
  });

  it('withdrawing while provider.voiceprint is pending rejects 409 consent_changed and leaves no row', async () => {
    const s = await setupVoiceprints();
    const gate = deferred();
    s.provider.voiceprintGate = gate.promise;
    const pending = s.enroll().catch((e: unknown) => e);
    await vi.waitFor(() => expect(s.provider.voiceprint).toHaveBeenCalled());
    await s.consent('work', 'withdrawn');
    gate.resolve();
    expect(await pending).toMatchObject({ status: 409, code: 'consent_changed' });
    expect(await s.store.get(s.personId, 'work')).toBeNull();
  });

  it('a consent change between capture and the final check discards the template', async () => {
    const s = await setupVoiceprints();
    const gate = deferred();
    s.provider.voiceprintGate = gate.promise;
    // Re-grant without the invalidator: the fingerprint check alone must refuse.
    s.adaptive.setVoiceIdentityInvalidator(async () => undefined);
    const pending = s.enroll().catch((e: unknown) => e);
    await vi.waitFor(() => expect(s.provider.voiceprint).toHaveBeenCalled());
    await s.consent('work', 'withdrawn');
    await s.consent('work', 'granted');
    gate.resolve();
    expect(await pending).toMatchObject({ status: 409, code: 'consent_changed' });
    expect(await s.store.get(s.personId, 'work')).toBeNull();
  });

  it('deleteVoiceprint works with the flag unset', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '');
    const status = await s.service.delete(s.telegramId, 'work');
    expect(status).toMatchObject({ enrolled: false, available: false, reason: 'disabled' });
    expect(await s.store.get(s.personId, 'work')).toBeNull();
  });

  it('re-granting consent does not resurrect the old template: verify is not_enrolled and the row is deleted', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    // Without the invalidator the stale row survives withdrawal; the consentEventId check must still end it.
    s.adaptive.setVoiceIdentityInvalidator(async () => undefined);
    await s.consent('work', 'withdrawn');
    await s.consent('work', 'granted');
    expect(await s.store.get(s.personId, 'work')).not.toBeNull();
    // F010: enrollment called the provider; clear it so "not called" covers every argument shape and label.
    s.provider.identify.mockClear(); s.provider.voiceprint.mockClear(); s.speech.measure.mockClear();
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'not_enrolled' });
    expect(await s.store.get(s.personId, 'work')).toBeNull();
    expect(s.provider.identify).not.toHaveBeenCalled();
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
    expect(s.speech.measure).not.toHaveBeenCalled();
  });

  it('the sweep deletes rows older than 365 days and rows of people who left', async () => {
    const s = await setupVoiceprints();
    await s.enroll();
    expect(await s.service.sweep()).toBe(0);
    s.members.set(s.telegramId, false);
    expect(await s.service.sweep()).toBe(1);
    s.members.set(s.telegramId, true);
    await s.enroll();
    s.setNow(s.now() + 366 * 86_400_000);
    expect(await s.service.sweep()).toBe(1);
    expect(await s.store.list()).toEqual([]);
  });
});
