import { afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { AdaptiveService } from '../persistence/service';
import { AdaptiveRepository, accountIdFor } from '../persistence/repository';
import { FileAdaptiveStorage } from '../persistence/storage';
import { adaptiveOptionsFromManifest } from '../persistence/config';
import { VoiceIdentityService } from './service';
import { VoiceIdentityRepository, VoiceTemplateCipher } from './repository';
import type { VoiceIdentityProvider, VoiceProviderApproval } from './provider';
import type { VoiceScope } from './contracts';
export const NOW = Date.UTC(2026, 9, 19, 12);
export const scope: VoiceScope = { space: 'work', deviceId: '11111111-1111-4111-8111-111111111111' };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
export async function setupVoiceIdentity(withProvider = true) {
  let now = NOW, event = 0;
  const directory = await mkdtemp(join(tmpdir(), 'vox-voice-synthetic-')); directories.push(directory);
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-voice-config', enabledCapabilities: ['core_text', 'biometric_recognition'],
    accounts: [{ accountId: accountIdFor(123), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: ['core_text', 'biometric_recognition'].map((capability, i) => ({ schemaVersion: 1, id: `synthetic-${i}`, revision: 1, createdAt: NOW, updatedAt: NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-voice-config', effectiveAt: NOW, reviewExpiresAt: NOW + 400 * 86400_000, owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) });
  const options = { ...adaptiveOptionsFromManifest(manifest), voiceRecognitionEnabled: withProvider, now: () => now };
  const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(directory, 'authority'))), options);
  const provider: VoiceIdentityProvider = { id: 'synthetic-protocol-fixture', version: '1', location: 'server', retention: 'request_only',
    inspect: vi.fn(async () => 'eligible_single_live' as const),
    extract: vi.fn(async () => new Uint8Array(Buffer.from('SYNTHETIC_OPAQUE_TEMPLATE_CANARY'))),
    compare: vi.fn(async () => ({ candidateId: 'self' })), purge: vi.fn(async () => undefined) };
  const approval: VoiceProviderApproval = { providerId: provider.id, providerVersion: provider.version, location: provider.location,
    approvalReference: 'synthetic-protocol-only-not-legal-approval', noticeVersion: 'voice-enrollment-v1', expiresAt: NOW + 400 * 86400_000,
    templateTtlMs: 86400_000, consentTtlMs: 2 * 86400_000,
    disclosure: { en: 'Synthetic test disclosure: own live voice only; test fixture runs on this server. Samples are not persisted. Encrypted templates last one day. Delete in this panel. Text/manual identity remains available.', fa: 'افشای آزمایشی: فقط صدای زندهٔ خودتان؛ الگوی مصنوعی روی این سرور اجرا می‌شود. نمونه ذخیره نمی‌شود. الگوی رمزگذاری‌شده یک روز اعتبار دارد. حذف در این بخش ممکن است و متن و انتخاب دستی هویت در دسترس است.' } };
  const repository = new VoiceIdentityRepository(new FileAdaptiveStorage(join(directory, 'voice')));
  const cipher = new VoiceTemplateCipher('synthetic-key', new Uint8Array(32).fill(7));
  const factory = () => new VoiceIdentityService(adaptive, repository, { ...(withProvider ? { provider, providerApproval: approval, cipher } : {}), enabled: withProvider, now: () => now });
  const service = factory();
  adaptive.setVoiceIdentityInvalidator(async ({ telegramId, space }) => { await service.invalidate(telegramId, space); });
  await adaptive.confirm(123, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  const consent = async (space: VoiceScope['space'] = 'work', state: 'granted' | 'withdrawn' = 'granted') => {
    const purpose = 'optional.biometric_recognition';
    let current = await adaptive.read(123, space);
    let receipt: string | undefined;
    if (state === 'granted') {
      const presented = await adaptive.present(123, { space, purpose, locale: 'en', expectedRevision: current.purposes.find(p => p.purpose === purpose)!.revision,
        eventId: `present-synthetic-${++event}`, deliberateReopen: true });
      receipt = presented.receipt; current = presented;
    }
    return adaptive.changeConsent(123, { space, purpose, state, expectedRevision: current.purposes.find(p => p.purpose === purpose)!.revision,
      eventId: `consent-synthetic-${++event}`, ...(receipt ? { receipt } : {}) });
  };
  const intent = async (target = scope) => {
    const initial = await service.read(123, target);
    const presented = await service.present(123, target, initial.revision, 'en');
    return service.acceptEnrollment(123, target, presented.revision, presented.receipt!);
  };
  const begin = async (mode: 'enroll' | 'test' = 'enroll', target = scope) => {
    const current = await service.read(123, target);
    return service.begin(123, target, current.revision, mode);
  };
  const enroll = async (target = scope) => {
    await intent(target); const capture = await begin('enroll', target);
    return service.process(123, target, capture.capture!.id, new Uint8Array(Buffer.from('SYNTHETIC_AUDIO_CANARY')), 'audio/webm');
  };
  return { adaptive, provider, approval, cipher, repository, service, factory, directory, consent, intent, begin, enroll, setNow: (value: number) => { now = value; } };
}
