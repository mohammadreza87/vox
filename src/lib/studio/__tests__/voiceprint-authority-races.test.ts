import { expect, it, vi } from 'vitest';
import { PERSON_ID, setupVoiceprints, speakerAudio } from './voiceprint-fixtures';

const note = () => ({ personaId: 'aria', personId: PERSON_ID, space: 'work' as const,
  chatKind: 'private' as const, guestAudience: false, audio: speakerAudio('reza', 'voice note'),
  mimeType: 'audio/ogg', durationSec: 5, channel: 'telegram_voice_note' as const });

it('does not export enrollment audio after consent is withdrawn during echo preparation', async () => {
  const s = await setupVoiceprints();
  await s.service.ensureEchoTemplates();
  s.provider.identify.mockClear(); s.provider.voiceprint.mockClear();
  vi.spyOn(s.service, 'ensureEchoTemplates').mockImplementationOnce(async () => {
    await s.changeConsent('work', 'withdrawn'); return 1;
  });
  await expect(s.enroll()).rejects.toMatchObject({ code: 'consent_changed' });
  expect(s.provider.identify).not.toHaveBeenCalled();
  expect(s.provider.voiceprint).not.toHaveBeenCalled();
});

it('does not decrypt or compare an enrolled voice after awaited echo lookup loses authority', async () => {
  const s = await setupVoiceprints();
  await s.enroll(); await s.grantAgent('aria');
  s.provider.identify.mockClear();
  const original = s.store.listEcho.bind(s.store);
  vi.spyOn(s.store, 'listEcho').mockImplementationOnce(async (...args) => {
    const rows = await original(...args); await s.changeConsent('work', 'withdrawn'); return rows;
  });
  const open = vi.spyOn(s.cipher, 'open');
  expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_OPINION', reason: 'consent_missing' });
  expect(open).not.toHaveBeenCalled();
  expect(s.provider.identify).not.toHaveBeenCalled();
});

it('drops a provider match that returns after withdrawal', async () => {
  const s = await setupVoiceprints();
  await s.enroll(); await s.grantAgent('aria');
  s.provider.identify.mockImplementationOnce(async () => {
    await s.changeConsent('work', 'withdrawn'); return { candidateId: 'self', score: 0.99 };
  });
  expect(await s.service.verifyVoiceNote(note())).toEqual({ band: 'NO_OPINION', reason: 'consent_missing' });
});
