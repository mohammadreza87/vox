/**
 * Test-only fakes for the S11L voiceprint library. No tests here and no
 * network: the pyannote adapter is never constructed with a real key.
 * Temporary directories come from os.tmpdir() (honours TMPDIR).
 */
import { afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import type { VoiceThresholdConfig } from '../identity/config';
import { VoiceprintCipher } from '../identity/crypto';
import { VoiceprintProviderError, type SpeechActivity, type VoiceprintProvider } from '../identity/provider';
import type { SelfEchoSource } from '../identity/self-echo';
import { FileVoiceprintStore, InMemoryVoiceprintStore, type VoiceprintStore } from '../identity/store';
import { chainVoiceInvalidators, VoiceprintService, type VoiceprintServiceOptions } from '../identity/voice';

export const VP_NOW = Date.UTC(2026, 9, 20, 12);
export const TELEGRAM_ID = 123;
export const PERSON_ID = `tg-${TELEGRAM_ID}`;
export const PERSONA_ID = 'aria';
/** Fixed 32-byte test key; never a real key. */
export const TEST_KEY = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
export const TEMPLATE_CANARY = 'VP_TEMPLATE_CANARY';
export const AUDIO_CANARY_TEXT = 'AUDIO_CANARY_7f3a9c';
export const AUDIO_CANARY = new TextEncoder().encode(`${AUDIO_CANARY_TEXT}|opus-bytes-that-are-not-real`);
export const THRESHOLDS: VoiceThresholdConfig = { default: { match: 0.8, noMatch: 0.4, selfEcho: 0.7 } };

export const audioBuffer = (bytes: Uint8Array = AUDIO_CANARY): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
};
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Deterministic provider: voiceprint returns the template canary; identify returns scripted scores per label. */
export class FakeVoiceprintProvider implements VoiceprintProvider {
  readonly id = 'fake-vp';
  modelVersion = 'fake-vp:1';
  /** Score per candidate label; owner defaults to 0.9 and echo labels to 0.1. */
  readonly scores = new Map<string, number>([['owner', 0.9]]);
  mode: 'ok' | 'throw' | 'hang' | 'mixed' = 'ok';
  /** When set, voiceprint waits for it (used to race withdrawal). */
  voiceprintGate?: Promise<void>;
  readonly identifyCalls: Array<{ labels: string[]; templates: string[]; queryLength: number }> = [];

  voiceprint = vi.fn(async (_audio: Uint8Array, _mimeType: string, signal: AbortSignal): Promise<Uint8Array> => {
    await this.gate(signal);
    if (this.voiceprintGate) await this.voiceprintGate;
    return new TextEncoder().encode(TEMPLATE_CANARY);
  });

  identify = vi.fn(async (query: Uint8Array, candidates: readonly { id: string; template: Uint8Array }[], signal: AbortSignal) => {
    this.identifyCalls.push({ labels: candidates.map(c => c.id), templates: candidates.map(c => decode(c.template)), queryLength: query.byteLength });
    await this.gate(signal);
    if (this.mode === 'mixed') throw new VoiceprintProviderError('mixed_speakers');
    let best: { candidateId?: string; score: number } = { score: 0 };
    for (const c of candidates) {
      const score = this.scores.get(c.id) ?? (c.id.startsWith('echo-') ? 0.1 : 0);
      if (best.candidateId === undefined || score > best.score) best = { candidateId: c.id, score };
    }
    return best;
  });

  /** True when any label ever sent to identify contains a person id. */
  labelsContainPersonIds(): boolean {
    return this.identifyCalls.some(call => call.labels.some(label => label.includes('tg-')));
  }

  private async gate(signal: AbortSignal) {
    if (this.mode === 'throw') throw new VoiceprintProviderError('http');
    if (this.mode === 'hang') await new Promise(() => undefined);
    void signal;
  }
}

export class FakeSpeechActivity implements SpeechActivity {
  result = { netSpeechMs: 12_000, speakers: 1 };
  measure = vi.fn<SpeechActivity['measure']>(async () => ({ ...this.result }));
}

export class FakeEchoSource implements SelfEchoSource {
  list: { id: string; template: Uint8Array }[] | null = [{ id: 'echo-0', template: new TextEncoder().encode('ECHO_TEMPLATE_0') }];
  templates = vi.fn<SelfEchoSource['templates']>(async () => this.list ? this.list.map(e => ({ id: e.id, template: new Uint8Array(e.template) })) : null);
  warm = vi.fn<SelfEchoSource['warm']>(async () => undefined);
}

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

export interface SetupOptions {
  /** STUDIO_VOICE_RECOGNITION, stubbed in the environment (default on). */
  flag?: boolean;
  /** AdaptiveService voiceRecognitionEnabled (default true). */
  voiceRecognitionEnabled?: boolean;
  /** Manifest approval for biometric_recognition (default true). */
  approve?: boolean;
  confirm?: boolean;
  /** Grant optional.biometric_recognition in work (default when the gates allow it). */
  consent?: boolean;
  /** Grant the persona agent access in work (default true when consent is granted). */
  agent?: boolean;
  store?: 'memory' | 'file';
  thresholds?: VoiceThresholdConfig | null;
  pilot?: boolean;
  telegramId?: number;
  service?: Partial<VoiceprintServiceOptions>;
  /** Install the chained invalidator exactly as runtime.ts does (default true). */
  chain?: boolean;
}

export async function setupVoiceprints(o: SetupOptions = {}) {
  const flag = o.flag ?? true;
  const recognition = o.voiceRecognitionEnabled ?? true;
  const approve = o.approve ?? true;
  const telegramId = o.telegramId ?? TELEGRAM_ID;
  const personId = `tg-${telegramId}`;
  let now = VP_NOW, event = 0;
  const directory = await mkdtemp(join(tmpdir(), 'vox-voiceprint-'));
  directories.push(directory);
  const capabilities = ['core_text', ...(approve ? ['biometric_recognition'] : [])];
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-voiceprint-config', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(telegramId), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `synthetic-${i}`, revision: 1, createdAt: VP_NOW, updatedAt: VP_NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-voiceprint-config', effectiveAt: VP_NOW,
      reviewExpiresAt: VP_NOW + 800 * 86_400_000, owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) });
  vi.stubEnv('STUDIO_VOICE_RECOGNITION', flag ? '1' : '');
  const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(directory, 'adaptive'))),
    { ...adaptiveOptionsFromManifest(manifest), voiceRecognitionEnabled: recognition, now: () => now });
  const storePath = join(directory, 'voiceprints', 'voiceprints-v1.json');
  const store: VoiceprintStore = o.store === 'file' ? new FileVoiceprintStore(storePath) : new InMemoryVoiceprintStore();
  const cipher = new VoiceprintCipher(TEST_KEY);
  const provider = new FakeVoiceprintProvider();
  const speech = new FakeSpeechActivity();
  const selfEcho = new FakeEchoSource();
  const members = new Map<number, boolean>([[telegramId, true]]);
  const eligiblePerson = vi.fn(async (id: number) => members.get(id) === true);
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const service = new VoiceprintService({
    adaptive, store, cipher, provider, speech, selfEcho, thresholds: o.thresholds === undefined ? THRESHOLDS : o.thresholds,
    orgKey: 'HOOR', pilot: o.pilot ?? false, eligiblePerson, now: () => now, logger, ...o.service,
  });
  const voiceIdentity = { invalidate: vi.fn<(telegramId: number, space?: 'work' | 'personal') => Promise<void>>(async () => undefined) };
  if (o.chain ?? true) {
    // Exactly as runtime.ts: the single invalidator slot chains VoiceIdentityService and voiceprints.
    adaptive.setVoiceIdentityInvalidator(chainVoiceInvalidators(voiceIdentity, service));
  }
  const confirm = () => adaptive.confirm(telegramId, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  const purpose = 'optional.biometric_recognition' as const;
  const revisionOf = async (space: 'work' | 'personal') => (await adaptive.read(telegramId, space)).purposes.find(p => p.purpose === purpose)!.revision;
  const present = async (space: 'work' | 'personal' = 'work') => adaptive.present(telegramId, { space, purpose, locale: 'en',
    expectedRevision: await revisionOf(space), eventId: `present-voiceprint-${++event}`, deliberateReopen: true });
  /** Moves optional.biometric_recognition to `state`; 'granted' presents first and uses the receipt. */
  const consent = async (space: 'work' | 'personal' = 'work', state: 'granted' | 'withdrawn' | 'declined' = 'granted') => {
    let receipt: string | undefined;
    if (state !== 'withdrawn') receipt = (await present(space)).receipt;
    return adaptive.changeConsent(telegramId, { space, purpose, state, expectedRevision: await revisionOf(space),
      eventId: `consent-voiceprint-${++event}`, ...(receipt ? { receipt } : {}) });
  };
  const grantAgent = async (agentId = PERSONA_ID, space: 'work' | 'personal' = 'work', allowed = true) => {
    const current = await adaptive.read(telegramId, space);
    return adaptive.setAgentAccess(telegramId, agentId, { space, allowed, expectedRevision: current.revision, eventId: `agent-voiceprint-${++event}` });
  };
  if (o.confirm ?? true) await confirm();
  const consented = o.consent ?? (recognition && approve && (o.confirm ?? true));
  if (consented) await consent();
  if (o.agent ?? consented) await grantAgent();
  const enroll = (space: 'work' | 'personal' = 'work', audio: Uint8Array = AUDIO_CANARY) =>
    service.enroll({ telegramId, audio, mimeType: 'audio/webm;codecs=opus', space, channel: 'mini_app' });
  const voiceNote = (overrides: Partial<Parameters<VoiceprintService['verifyVoiceNote']>[0]> = {}) => ({
    personaId: PERSONA_ID, personId, space: 'work' as const, chatKind: 'private' as const, guestAudience: false,
    audio: audioBuffer(), mimeType: 'audio/ogg', durationSec: 6, channel: 'telegram_voice_note' as const, ...overrides,
  });
  return {
    adaptive, store, storePath, cipher, provider, speech, selfEcho, service, directory, voiceIdentity, members, eligiblePerson, logger,
    confirm, present, consent, grantAgent, enroll, voiceNote, telegramId, personId,
    setNow: (value: number) => { now = value; }, now: () => now,
  };
}
