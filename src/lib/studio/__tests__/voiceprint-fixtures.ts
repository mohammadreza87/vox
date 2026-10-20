/**
 * Test-only fakes for the S11L voiceprint library. No network: the pyannote
 * adapter is never constructed; FakeVoiceprintProvider derives "templates"
 * from a speaker tag inside synthetic audio ('SPEAKER:<tag>|...').
 */
import { afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { AdaptiveRepository, accountIdFor } from '../../adaptive/persistence/repository';
import { FileAdaptiveStorage } from '../../adaptive/persistence/storage';
import { adaptiveOptionsFromManifest } from '../../adaptive/persistence/config';
import { AesGcmVoiceprintCipher } from '../identity/crypto';
import { FileVoiceprintStore, InMemoryVoiceprintStore, type VoiceprintStore } from '../identity/store';
import type { NetSpeechEstimator } from '../identity/net-speech';
import { chainVoiceInvalidators, VoiceprintService, type EchoVoiceSource, type VoiceThresholdConfig, type VoiceprintProvider } from '../identity/voice';

export const VP_NOW = Date.UTC(2026, 9, 20, 12);
export const TELEGRAM_ID = 123;
export const PERSON_ID = `tg-${TELEGRAM_ID}`;
export const TEST_KEY = new Uint8Array(32).fill(9);
export const THRESHOLDS: VoiceThresholdConfig = { default: { match: 0.8, uncertain: 0.6, echo: 0.5 } };

export const speakerAudio = (tag: string, extra = ''): ArrayBuffer => {
  const bytes = new TextEncoder().encode(`SPEAKER:${tag}|${extra}`);
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
};
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
const tagOf = (bytes: Uint8Array) => /SPEAKER:([^|]+)\|/.exec(text(bytes))?.[1] ?? 'unknown';

export class FakeVoiceprintProvider implements VoiceprintProvider {
  readonly id = 'fake-vp';
  readonly modelVersion = 'fake-1';
  /** `${queryTag}->${templateTag}` → score; default 0.9 for the same tag, 0.1 otherwise. */
  readonly scores = new Map<string, number>();
  mode: 'ok' | 'throw' | 'hang' = 'ok';
  delay?: Promise<void>;
  readonly voiceprintCalls: Array<{ tag: string; mimeType: string }> = [];
  readonly identifyCalls: Array<{ tag: string; candidateIds: string[]; templateTags: string[] }> = [];
  voiceprint = vi.fn(async (audio: Uint8Array, mimeType: string, signal: AbortSignal): Promise<Uint8Array> => {
    this.voiceprintCalls.push({ tag: tagOf(audio), mimeType });
    await this.gate(signal);
    return new TextEncoder().encode(`TPL:${tagOf(audio)}`);
  });
  identify = vi.fn(async (query: Uint8Array, candidates: readonly { id: string; template: Uint8Array }[], signal: AbortSignal) => {
    const tag = tagOf(query);
    const templateTags = candidates.map(c => text(c.template).replace(/^TPL:/, ''));
    this.identifyCalls.push({ tag, candidateIds: candidates.map(c => c.id), templateTags });
    await this.gate(signal);
    let best: { candidateId?: string; score: number } = { score: 0 };
    candidates.forEach((c, i) => {
      const score = this.scores.get(`${tag}->${templateTags[i]}`) ?? (tag === templateTags[i] ? 0.9 : 0.1);
      if (best.candidateId === undefined || score > best.score) best = { candidateId: c.id, score };
    });
    return best;
  });
  private async gate(signal: AbortSignal) {
    if (this.mode === 'throw') throw new Error('synthetic provider failure');
    if (this.mode === 'hang') await new Promise(() => undefined);
    if (this.delay) await this.delay;
    void signal;
  }
}

export function fakeEstimator(netMs: number, grossMs = Math.max(netMs, 1)) {
  const state: { value: { netMs: number; grossMs: number } | null } = { value: { netMs, grossMs } };
  const estimator: NetSpeechEstimator & { estimate: ReturnType<typeof vi.fn> } = {
    estimate: vi.fn(() => state.value),
  };
  return Object.assign(estimator, { set(value: { netMs: number; grossMs: number } | null) { state.value = value; } });
}

export const echoSource = (voices: string[] = ['persona-voice-1']): EchoVoiceSource & ReturnType<typeof vi.fn> =>
  vi.fn(async () => voices.map(voiceId => ({ voiceId, synthesize: async () => ({ audio: speakerAudio(`echo-${voiceId}`), mimeType: 'audio/mpeg' }) })));

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

export interface SetupOptions {
  flag?: boolean; approve?: boolean; consent?: boolean; confirm?: boolean; echo?: boolean;
  store?: 'memory' | 'file'; estimator?: ReturnType<typeof fakeEstimator>; thresholds?: VoiceThresholdConfig | null; deadlineMs?: number;
}

export async function setupVoiceprints(o: SetupOptions = {}) {
  const flag = o.flag ?? true, approve = o.approve ?? true;
  let now = VP_NOW, event = 0;
  const directory = await mkdtemp(join(tmpdir(), 'vox-voiceprint-')); directories.push(directory);
  const capabilities = ['core_text', ...(approve ? ['biometric_recognition'] : [])];
  const manifest = JSON.stringify({ schemaVersion: 1, configurationVersion: 'synthetic-voiceprint-config', enabledCapabilities: capabilities,
    accounts: [{ accountId: accountIdFor(TELEGRAM_ID), jurisdictionKeys: ['SYNTHETIC'], allowDeclaredAdult: true }],
    approvals: capabilities.map((capability, i) => ({ schemaVersion: 1, id: `synthetic-${i}`, revision: 1, createdAt: VP_NOW, updatedAt: VP_NOW,
      jurisdiction: 'SYNTHETIC', capability, state: 'approved', configurationVersion: 'synthetic-voiceprint-config', effectiveAt: VP_NOW,
      reviewExpiresAt: VP_NOW + 800 * 86400_000, owner: 'synthetic-owner', approvalReference: 'synthetic-only' })) });
  vi.stubEnv('STUDIO_VOICE_RECOGNITION', flag ? '1' : '');
  const adaptive = new AdaptiveService(new AdaptiveRepository(new FileAdaptiveStorage(join(directory, 'adaptive'))),
    { ...adaptiveOptionsFromManifest(manifest), voiceRecognitionEnabled: flag, now: () => now });
  const store: VoiceprintStore = o.store === 'file' ? new FileVoiceprintStore(join(directory, 'voiceprints-v1.json')) : new InMemoryVoiceprintStore();
  const cipher = new AesGcmVoiceprintCipher(TEST_KEY);
  const provider = new FakeVoiceprintProvider();
  const estimator = o.estimator ?? fakeEstimator(12_000, 15_000);
  const echoVoices = o.echo === false ? undefined : echoSource();
  const service = new VoiceprintService({
    store, cipher, provider, adaptive, thresholds: o.thresholds === undefined ? THRESHOLDS : o.thresholds, orgKey: 'HOOR',
    ...(echoVoices ? { echoVoices } : {}), netSpeech: estimator, now: () => new Date(now),
    ...(o.deadlineMs !== undefined ? { deadlineMs: o.deadlineMs } : {}),
  });
  const otherInvalidator = { invalidate: vi.fn(async () => undefined) };
  adaptive.setVoiceIdentityInvalidator(chainVoiceInvalidators(otherInvalidator, service));
  const confirm = () => adaptive.confirm(TELEGRAM_ID, { confirm: true, adultConfirmed: true, declaredJurisdiction: 'EE' });
  const changeConsent = async (space: 'work' | 'personal' = 'work', state: 'granted' | 'withdrawn' = 'granted') => {
    const purpose = 'optional.biometric_recognition';
    let current = await adaptive.read(TELEGRAM_ID, space);
    let receipt: string | undefined;
    if (state === 'granted') {
      const presented = await adaptive.present(TELEGRAM_ID, { space, purpose, locale: 'en', expectedRevision: current.purposes.find(p => p.purpose === purpose)!.revision,
        eventId: `present-voiceprint-${++event}`, deliberateReopen: true });
      receipt = presented.receipt; current = presented;
    }
    return adaptive.changeConsent(TELEGRAM_ID, { space, purpose, state, expectedRevision: current.purposes.find(p => p.purpose === purpose)!.revision,
      eventId: `consent-voiceprint-${++event}`, ...(receipt ? { receipt } : {}) });
  };
  const grantAgent = async (agentId: string, space: 'work' | 'personal' = 'work', allowed = true) => {
    const current = await adaptive.read(TELEGRAM_ID, space);
    return adaptive.setAgentAccess(TELEGRAM_ID, agentId, { space, allowed, expectedRevision: current.revision, eventId: `agent-voiceprint-${++event}` });
  };
  if (o.confirm ?? true) await confirm();
  if (o.consent ?? (flag && approve)) await changeConsent();
  const enroll = (space: 'work' | 'personal' = 'work', audio = speakerAudio('reza', 'enrollment sample')) =>
    service.enroll({ telegramId: TELEGRAM_ID, personId: PERSON_ID, space, audio, mimeType: 'audio/webm;codecs=opus', channel: 'mini_app' });
  return { adaptive, store, cipher, provider, estimator, echoVoices, service, directory, otherInvalidator, confirm, changeConsent, grantAgent, enroll,
    setNow: (value: number) => { now = value; }, now: () => now };
}

/** Minimal Firestore double: collection/doc/get/set/delete and chained equality where(). */
export function fakeFirestore() {
  const docs = new Map<string, Record<string, unknown>>();
  const key = (collection: string, id: string) => `${collection}/${id}`;
  const ref = (collection: string, id: string) => ({
    id,
    get: vi.fn(async () => {
      const data = docs.get(key(collection, id));
      return { exists: !!data, id, data: () => (data ? { ...data } : undefined) };
    }),
    set: vi.fn(async (data: Record<string, unknown>) => {
      for (const [field, value] of Object.entries(data)) if (value === undefined) throw new Error(`undefined field ${field}`);
      docs.set(key(collection, id), { ...data });
    }),
    delete: vi.fn(async () => { docs.delete(key(collection, id)); }),
  });
  const query = (collection: string, filters: Array<[string, unknown]>) => ({
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error('equality only');
      return query(collection, [...filters, [field, value]]);
    },
    get: vi.fn(async () => {
      const prefix = `${collection}/`;
      const matches = [...docs.entries()].filter(([k, data]) => k.startsWith(prefix) && filters.every(([f, v]) => data[f] === v));
      return { docs: matches.map(([k, data]) => ({ id: k.slice(prefix.length), data: () => ({ ...data }), ref: ref(collection, k.slice(prefix.length)) })) };
    }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(name, id), where: (f: string, op: string, v: unknown) => query(name, []).where(f, op, v) }),
  };
  return { db: db as unknown as Firestore, docs };
}
