/**
 * Main 8a7dc55, ported onto the wave A r2 fixtures: the synchronous committed
 * authority fence runs after every awaited preparation step and immediately
 * before decrypting a template or exporting audio to the provider. Each case
 * runs with the chained invalidator (as runtime.ts wires it, which also aborts
 * in-flight enrollment) and without it, so the fence alone is exercised too.
 */
import { describe, expect, it, vi } from 'vitest';
import { setupVoiceprints } from './voiceprint-fixtures';

describe.each([
  { chain: true, label: 'with the chained invalidator' },
  { chain: false, label: 'with the fence alone' },
])('voiceprint authority races ($label)', ({ chain }) => {
  it('does not export enrollment audio after consent is withdrawn during echo preparation', async () => {
    const s = await setupVoiceprints({ chain });
    const original = s.selfEcho.templates.getMockImplementation()!;
    s.selfEcho.templates.mockImplementationOnce(async (...args) => {
      const rows = await original(...args);
      await s.consent('work', 'withdrawn');
      return rows;
    });
    await expect(s.enroll()).rejects.toMatchObject({ name: 'VoiceprintError', code: 'consent_changed' });
    expect(s.provider.identify).not.toHaveBeenCalled();
    expect(s.provider.voiceprint).not.toHaveBeenCalled();
    expect(s.speech.measure).not.toHaveBeenCalled();
    expect(await s.store.get(s.personId, 'work')).toBeNull();
  });

  it('does not decrypt or compare an enrolled voice after an awaited lookup loses authority', async () => {
    const s = await setupVoiceprints({ chain });
    await s.enroll();
    s.provider.identify.mockClear(); s.speech.measure.mockClear();
    const original = s.store.get.bind(s.store);
    const get = vi.spyOn(s.store, 'get').mockImplementationOnce(async (...args) => {
      const row = await original(...args);
      await s.consent('work', 'withdrawn');
      return row;
    });
    const open = vi.spyOn(s.cipher, 'open');
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'consent_missing' });
    expect(get).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(s.provider.identify).not.toHaveBeenCalled();
    expect(s.speech.measure).not.toHaveBeenCalled();
  });

  it('does not upload a voice note after consent is withdrawn during the echo lookup', async () => {
    const s = await setupVoiceprints({ chain });
    await s.enroll();
    s.provider.identify.mockClear(); s.speech.measure.mockClear();
    const original = s.selfEcho.templates.getMockImplementation()!;
    s.selfEcho.templates.mockImplementationOnce(async (...args) => {
      const rows = await original(...args);
      await s.consent('work', 'withdrawn');
      return rows;
    });
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'consent_missing' });
    expect(s.provider.identify).not.toHaveBeenCalled();
    expect(s.speech.measure).not.toHaveBeenCalled();
  });

  it('drops a provider match that returns after withdrawal', async () => {
    const s = await setupVoiceprints({ chain });
    await s.enroll();
    s.provider.identify.mockImplementationOnce(async () => {
      await s.consent('work', 'withdrawn');
      return { candidateId: 'owner', score: 0.99 };
    });
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toEqual({ band: 'NO_OPINION', reason: 'consent_missing' });
  });

  it('still verifies when authority is unchanged (the fence does not deny a valid turn)', async () => {
    const s = await setupVoiceprints({ chain });
    await s.enroll();
    expect(await s.service.verifyVoiceNote(s.voiceNote())).toMatchObject({ band: 'MATCH' });
  });
});
