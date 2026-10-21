/**
 * Voiceprint enrollment and verification (S11L), behind
 * STUDIO_VOICE_RECOGNITION=1 and in shadow mode.
 *
 * Gates (docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.9, PRIV-017 to PRIV-025):
 * the flag, a confirmed profile, capability approval for biometric_recognition
 * (jurisdiction registry), a granted optional.biometric_recognition permission
 * with affirmative evidence, and for verification the persona's agent grant.
 *
 * A verification band is evidence that can only lower an identity level. It
 * never unlocks memory, approves sharing or overrides the account. Candidates
 * are the account's own template plus Vox persona voices (self-echo guard);
 * never other people (verification, not identification). Guests and groups get
 * no template read, no decode and no comparison. Raw audio is never persisted;
 * templates are sealed with VOICEPRINT_KEY in the isolated 'vox_voiceprints'
 * store. Nothing here logs.
 */
import { z } from 'zod';
import type { AdaptiveService } from '../../adaptive/persistence/service';
import { spaceIdFor } from '../../adaptive/persistence/repository';
import type { DirectAuthorityEvaluator } from '../../adaptive/persistence/authority';
import { tirehFlags, type TirehFlags } from '../../tireh/flags';
import { MIN_NET_SPEECH_MS, type VoiceBand, type VoiceNoteInput, type VoiceNoteVerifier, type VoiceVerification } from '../../tireh/identity/voice-band';
import { defaultVoiceId, type ElevenLabsStudio } from '../media';
import type { StudioStorage } from '../store';
import type { VoiceprintCipher } from './crypto';
import { MAX_ENROLL_GROSS_MS, MIN_ENROLL_NET_SPEECH_MS, opusNetSpeech, type NetSpeechEstimator } from './net-speech';
import type { EchoTemplateRow, VoiceprintRow, VoiceprintStore } from './store';

export interface VoiceprintProvider {
  readonly id: string;
  readonly modelVersion: string;
  voiceprint(audio: Uint8Array, mimeType: string, signal: AbortSignal): Promise<Uint8Array>;
  /** query = raw voice-note audio; candidates carry opaque ids only ('self', 'echo:<n>'). */
  identify(query: Uint8Array, candidates: readonly { id: string; template: Uint8Array }[], signal: AbortSignal): Promise<{ candidateId?: string; score: number }>;
}

/** 0 < echo <= uncertain < match <= 1 */
export interface VoiceBandThresholds { readonly match: number; readonly uncertain: number; readonly echo: number }
export interface VoiceThresholdConfig { readonly default: VoiceBandThresholds; readonly orgs?: Readonly<Record<string, VoiceBandThresholds>> }

const bandSchema = z.object({ match: z.number(), uncertain: z.number(), echo: z.number() }).strict()
  .refine(t => t.echo > 0 && t.echo <= t.uncertain && t.uncertain < t.match && t.match <= 1);
const thresholdSchema = z.object({ default: bandSchema, orgs: z.record(z.string().min(1).max(200), bandSchema).optional() }).strict();

/** VOICE_MATCH_THRESHOLDS_JSON. Null when unset or blank; throws on any violation. */
export function parseVoiceThresholds(raw: string | undefined): VoiceThresholdConfig | null {
  if (raw === undefined || !raw.trim()) return null;
  try {
    const parsed = thresholdSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch { /* reported below without echoing the value */ }
  throw new Error('VOICE_MATCH_THRESHOLDS_JSON is invalid');
}

export function bandFor(score: number, t: VoiceBandThresholds): VoiceBand {
  if (score >= t.match) return 'MATCH';
  if (score >= t.uncertain) return 'UNCERTAIN';
  return 'NO_MATCH';
}

export type VoiceprintUnavailableReason = 'disabled' | 'adaptive_unavailable' | 'profile_confirmation_required' | 'capability_unavailable'
  | 'biometric_consent_required' | 'provider_unavailable' | 'thresholds_missing' | 'echo_guard_unavailable';

export interface VoiceprintStatus {
  space: 'work' | 'personal';
  available: boolean;
  reason?: VoiceprintUnavailableReason;
  enrolled: boolean;
  provider?: string;
  modelVersion?: string;
  channel?: VoiceprintRow['channel'];
  createdAt?: string;
  lastConfirmedAt?: string;
}

export type VoiceprintErrorCode = VoiceprintUnavailableReason | 'empty_audio' | 'too_short' | 'too_long' | 'unsupported_audio'
  | 'self_echo' | 'consent_changed' | 'provider_error';

/** Content-free: carries only a code and an HTTP status. */
export class VoiceprintError extends Error {
  override readonly name = 'VoiceprintError';
  constructor(readonly code: VoiceprintErrorCode, readonly status: number) { super(code); }
  static is(error: unknown): error is VoiceprintError {
    return error instanceof VoiceprintError || (!!error && typeof error === 'object' && (error as { name?: unknown }).name === 'VoiceprintError'
      && typeof (error as { code?: unknown }).code === 'string' && typeof (error as { status?: unknown }).status === 'number');
  }
}

export type EchoVoiceSource = () => Promise<readonly { voiceId: string; synthesize(signal: AbortSignal): Promise<{ audio: ArrayBuffer; mimeType: string }> }[]>;

export interface VoiceprintServiceDeps {
  store: VoiceprintStore;
  cipher: VoiceprintCipher;
  provider?: VoiceprintProvider;
  adaptive?: Pick<AdaptiveService, 'withDirectAuthority' | 'readDirectAuthorityForEffect' | 'isPurposeAllowed' | 'isProfileConfirmed' | 'capabilityStatus'>;
  thresholds: VoiceThresholdConfig | null;
  /** Org name used to select per-org thresholds. */
  orgKey: string;
  echoVoices?: EchoVoiceSource;
  netSpeech?: NetSpeechEstimator;
  flags?: () => Pick<TirehFlags, 'voiceRecognition'>;
  now?: () => Date;
  deadlineMs?: number;
  enrollTimeoutMs?: number;
}

export const VOICE_VERIFY_TIMEOUT_MS = 3_000;
export const ENROLL_TIMEOUT_MS = 30_000;
export const MAX_ENROLL_AUDIO_BYTES = 1_000_000;
export const MAX_VERIFY_AUDIO_BYTES = 2_000_000;
/** Neutral calibration sentence spoken by each persona voice for the self-echo guard. Never user content. */
export const ECHO_CALIBRATION_TEXT = 'This is a calibration sample for the Vox voice guard. It is read aloud by a synthetic voice, '
  + 'so that recordings of our own assistants are never mistaken for a person. The quick brown fox jumps over the lazy dog, '
  + 'and seven bright kites drift slowly across the morning sky.';

const PURPOSE = 'optional.biometric_recognition' as const;
/** Reasons that mean the person's authority to keep a template has ended; only these trigger lazy deletion. */
const REVOKED = new Set<VoiceprintUnavailableReason>(['profile_confirmation_required', 'capability_unavailable', 'biometric_consent_required']);

interface Authority {
  personAllowed: boolean;
  agentAllowed: boolean;
  reason?: VoiceprintUnavailableReason;
  consentEventId?: string;
}

class DeadlineExceeded extends Error { constructor() { super('deadline'); this.name = 'DeadlineExceeded'; } }

/** Runs `run` with a signal linked to `outer` and aborted after `ms`; rejects at the deadline even if `run` ignores the signal. */
function withDeadline<T>(ms: number, outer: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const onOuter = () => controller.abort();
  if (outer?.aborted) controller.abort(); else outer?.addEventListener('abort', onOuter, { once: true });
  const timer = setTimeout(() => controller.abort(), ms);
  return new Promise<T>((resolve, reject) => {
    if (controller.signal.aborted) { reject(new DeadlineExceeded()); return; }
    controller.signal.addEventListener('abort', () => reject(new DeadlineExceeded()), { once: true });
    let started: Promise<T>;
    try { started = run(controller.signal); } catch (error) { reject(error); return; }
    started.then(resolve, reject);
  }).finally(() => { clearTimeout(timer); outer?.removeEventListener('abort', onOuter); });
}

const zero = (...buffers: (Uint8Array | undefined)[]) => { for (const b of buffers) b?.fill(0); };
const iso = (d: Date | undefined) => d ? d.toISOString() : undefined;

export class VoiceprintService implements VoiceNoteVerifier {
  private echoFlight?: Promise<number>;

  constructor(readonly deps: VoiceprintServiceDeps) {}

  private enabled(): boolean { return (this.deps.flags ?? tirehFlags)().voiceRecognition === true; }
  private now(): Date { return this.deps.now?.() ?? new Date(); }
  private get netSpeech(): NetSpeechEstimator { return this.deps.netSpeech ?? opusNetSpeech; }
  private thresholds(): VoiceBandThresholds | null {
    const config = this.deps.thresholds;
    if (!config) return null;
    return config.orgs && Object.hasOwn(config.orgs, this.deps.orgKey) ? config.orgs[this.deps.orgKey] : config.default;
  }

  private authorityEvaluator(space: 'work' | 'personal', agentId?: string): DirectAuthorityEvaluator<Authority> {
    const adaptive = this.deps.adaptive!;
    return (d, now) => {
      const p = d.permissions.find(x => x.spaceId === spaceIdFor(d.accountId, space) && x.purpose === PURPOSE);
      const confirmed = adaptive.isProfileConfirmed(d, now);
      const eligibility = adaptive.capabilityStatus(d, 'biometric_recognition', now);
      const personAllowed = !!p && adaptive.isPurposeAllowed(d, space, PURPOSE, now) && p.state === 'granted' && p.expiresAt > now && !!p.lastEventId;
      const agentAllowed = personAllowed && (!agentId || adaptive.isPurposeAllowed(d, space, PURPOSE, now, agentId));
      const reason: VoiceprintUnavailableReason | undefined = personAllowed ? undefined
        : !confirmed ? 'profile_confirmation_required'
          : eligibility.reason === 'feature_not_released' ? 'disabled'
            : !eligibility.eligible ? 'capability_unavailable' : 'biometric_consent_required';
      const value: Authority = { personAllowed, agentAllowed, ...(reason ? { reason } : {}), ...(personAllowed ? { consentEventId: p!.lastEventId! } : {}) };
      return !personAllowed ? { value, denied: true } : { value, deadline: Math.min(p!.expiresAt, eligibility.validUntil ?? p!.expiresAt, d.binding!.expiresAt) };
    };
  }

  /** Current biometric authority from the adaptive store. Any failure is not allowed. */
  private async authority(telegramId: number, space: 'work' | 'personal', agentId?: string): Promise<Authority> {
    if (!this.deps.adaptive || !this.enabled()) return { personAllowed: false, agentAllowed: false, reason: 'disabled' };
    try { return await this.deps.adaptive.withDirectAuthority(telegramId, space, this.authorityEvaluator(space, agentId)); }
    catch { return { personAllowed: false, agentAllowed: false, reason: 'adaptive_unavailable' }; }
  }

  /** Synchronous committed fence after awaited preparation and immediately before
   * each provider export. Unsupported or busy authority cannot authorize audio. */
  private authorityNow(telegramId: number, space: 'work' | 'personal', consentEventId: string | undefined, agentId?: string): boolean {
    if (!this.deps.adaptive || !this.enabled() || !consentEventId) return false;
    try {
      const current = this.deps.adaptive.readDirectAuthorityForEffect(telegramId, space, this.authorityEvaluator(space, agentId));
      return current.status === 'ready' && current.value.personAllowed && current.value.agentAllowed && current.value.consentEventId === consentEventId;
    } catch { return false; }
  }

  async verifyVoiceNote(input: VoiceNoteInput, signal?: AbortSignal): Promise<VoiceVerification> {
    const opened: Uint8Array[] = [];
    try {
      if (!this.enabled()) return { band: 'NO_OPINION', reason: 'disabled' };
      // PRIV-020: no template read, decode or comparison when a guest or a group can hear.
      if (input.chatKind !== 'private' || input.guestAudience) return { band: 'NO_OPINION', reason: 'guest_or_group' };
      const { provider, adaptive } = this.deps;
      const thresholds = this.thresholds();
      if (!provider || !adaptive || !thresholds) return { band: 'NO_OPINION', reason: 'disabled' };
      if (input.durationSec !== undefined && input.durationSec < MIN_NET_SPEECH_MS / 1000) return { band: 'NO_OPINION', reason: 'too_short' };
      if (input.audio.byteLength > MAX_VERIFY_AUDIO_BYTES) return { band: 'NO_OPINION', reason: 'provider_error' };
      const match = /^tg-([1-9]\d*)$/.exec(input.personId);
      const telegramId = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(telegramId)) return { band: 'NO_OPINION', reason: 'not_enrolled' };
      const row = await this.deps.store.get(input.personId, input.space);
      if (!row) return { band: 'NO_OPINION', reason: 'not_enrolled' };
      const authority = await this.authority(telegramId, input.space, input.personaId);
      if (!authority.personAllowed) {
        if (authority.reason && REVOKED.has(authority.reason)) await this.deps.store.delete(input.personId, input.space);
        return { band: 'NO_OPINION', reason: 'consent_missing' };
      }
      if (!authority.agentAllowed) return { band: 'NO_OPINION', reason: 'consent_missing' };
      if (row.consentEventId !== authority.consentEventId) {
        await this.deps.store.delete(input.personId, input.space);
        return { band: 'NO_OPINION', reason: 'not_enrolled' };
      }
      if (row.provider !== provider.id || row.modelVersion !== provider.modelVersion) return { band: 'NO_OPINION', reason: 'not_enrolled' };
      const echo = await this.deps.store.listEcho(provider.id, provider.modelVersion);
      if (!echo.length) return { band: 'NO_OPINION', reason: 'disabled' };
      // A read-only view: input.audio is shared with speech-to-text and is never mutated.
      const bytes = new Uint8Array(input.audio);
      const speech = this.netSpeech.estimate(bytes, input.mimeType);
      if (!speech) return { band: 'NO_OPINION', reason: 'too_short' };
      const netSpeechMs = speech.netMs;
      if (netSpeechMs < MIN_NET_SPEECH_MS) return { band: 'NO_OPINION', reason: 'too_short', netSpeechMs };
      if (!this.authorityNow(telegramId, input.space, authority.consentEventId, input.personaId)) return { band: 'NO_OPINION', reason: 'consent_missing' };
      const self = this.deps.cipher.open(row.template, [row.personId, row.space, row.provider, row.modelVersion, row.consentEventId]);
      opened.push(self);
      const candidates = [{ id: 'self', template: self }, ...this.openEcho(echo, opened)];
      let result: { candidateId?: string; score: number };
      try {
        result = await withDeadline(this.deps.deadlineMs ?? VOICE_VERIFY_TIMEOUT_MS, signal, s => {
          if (!this.authorityNow(telegramId, input.space, authority.consentEventId, input.personaId)) throw new VoiceprintError('consent_changed', 409);
          return provider.identify(bytes, candidates, s);
        });
      } catch (error) {
        if (error instanceof DeadlineExceeded || signal?.aborted) return { band: 'NO_OPINION', reason: 'timeout' };
        return { band: 'NO_OPINION', reason: 'provider_error' };
      }
      if (!this.authorityNow(telegramId, input.space, authority.consentEventId, input.personaId)) return { band: 'NO_OPINION', reason: 'consent_missing' };
      const score = Number.isFinite(result.score) ? result.score : 0;
      if (result.candidateId?.startsWith('echo:')) {
        if (score >= thresholds.echo) return { band: 'NO_OPINION', reason: 'self_echo', netSpeechMs };
        return { band: 'NO_MATCH', netSpeechMs, modelVersion: provider.modelVersion };
      }
      if (result.candidateId === 'self') return { band: bandFor(score, thresholds), netSpeechMs, modelVersion: provider.modelVersion };
      return { band: 'NO_MATCH', netSpeechMs, modelVersion: provider.modelVersion };
    } catch {
      return { band: 'NO_OPINION', reason: 'provider_error' };
    } finally {
      zero(...opened);
    }
  }

  private openEcho(echo: readonly EchoTemplateRow[], opened: Uint8Array[]): { id: string; template: Uint8Array }[] {
    return echo.map((e, i) => {
      const template = this.deps.cipher.open(e.template, ['echo', e.voiceId, e.provider, e.modelVersion]);
      opened.push(template);
      return { id: `echo:${i}`, template };
    });
  }

  async enroll(input: { telegramId: number; personId: string; space: 'work' | 'personal'; audio: ArrayBuffer; mimeType: string; channel: VoiceprintRow['channel'] },
    signal?: AbortSignal): Promise<VoiceprintStatus> {
    if (!this.enabled()) throw new VoiceprintError('disabled', 403);
    const provider = this.deps.provider;
    if (!provider) throw new VoiceprintError('provider_unavailable', 503);
    const thresholds = this.thresholds();
    if (!thresholds) throw new VoiceprintError('thresholds_missing', 503);
    if (!input.audio.byteLength) throw new VoiceprintError('empty_audio', 400);
    if (input.audio.byteLength > MAX_ENROLL_AUDIO_BYTES) throw new VoiceprintError('too_long', 413);
    const before = await this.authority(input.telegramId, input.space);
    if (!before.personAllowed) {
      const reason = before.reason ?? 'biometric_consent_required';
      throw new VoiceprintError(reason, reason === 'adaptive_unavailable' ? 503 : 403);
    }
    // Internal copy: the only buffer this service zero-fills.
    const bytes = new Uint8Array(input.audio.byteLength);
    bytes.set(new Uint8Array(input.audio));
    const opened: Uint8Array[] = [];
    let template: Uint8Array | undefined;
    try {
      const speech = this.netSpeech.estimate(bytes, input.mimeType);
      if (!speech) throw new VoiceprintError('unsupported_audio', 415);
      if (speech.netMs < MIN_ENROLL_NET_SPEECH_MS) throw new VoiceprintError('too_short', 422);
      if (speech.grossMs > MAX_ENROLL_GROSS_MS) throw new VoiceprintError('too_long', 413);
      await this.ensureEchoTemplates(signal);
      const echo = await this.deps.store.listEcho(provider.id, provider.modelVersion);
      if (!echo.length) throw new VoiceprintError('echo_guard_unavailable', 503);
      const timeout = this.deps.enrollTimeoutMs ?? ENROLL_TIMEOUT_MS;
      const candidates = this.openEcho(echo, opened);
      const check = () => { if (!this.authorityNow(input.telegramId, input.space, before.consentEventId)) throw new VoiceprintError('consent_changed', 409); };
      const echoCheck = await this.providerCall(() => withDeadline(timeout, signal, s => { check(); return provider.identify(bytes, candidates, s); }));
      if (Number.isFinite(echoCheck.score) && echoCheck.score >= thresholds.echo) throw new VoiceprintError('self_echo', 422);
      template = await this.providerCall(() => withDeadline(timeout, signal, s => { check(); return provider.voiceprint(bytes, input.mimeType, s); }));
      const during = await this.authority(input.telegramId, input.space);
      if (!during.personAllowed || during.consentEventId !== before.consentEventId) throw new VoiceprintError('consent_changed', 409);
      const consentEventId = before.consentEventId!;
      const sealed = this.deps.cipher.seal(template, [input.personId, input.space, provider.id, provider.modelVersion, consentEventId]);
      await this.deps.store.put({ personId: input.personId, space: input.space, provider: provider.id, modelVersion: provider.modelVersion,
        channel: input.channel, consentEventId, createdAt: this.now(), template: sealed });
      // Closes the race with a withdrawal whose invalidator ran before the put.
      const after = await this.authority(input.telegramId, input.space);
      if (!after.personAllowed || after.consentEventId !== consentEventId) {
        await this.deps.store.delete(input.personId, input.space);
        throw new VoiceprintError('consent_changed', 409);
      }
    } finally {
      zero(bytes, template, ...opened);
    }
    return this.status(input);
  }

  private async providerCall<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (error) {
      if (VoiceprintError.is(error)) throw error;
      throw new VoiceprintError('provider_error', 502);
    }
  }

  async status(input: { telegramId: number; personId: string; space: 'work' | 'personal' }): Promise<VoiceprintStatus> {
    let row = await this.deps.store.get(input.personId, input.space);
    if (!this.enabled()) return { space: input.space, available: false, reason: 'disabled', enrolled: !!row };
    const authority = await this.authority(input.telegramId, input.space);
    // Lazy deletion: an expired or withdrawn permission, a changed profile or a re-granted consent ends the template.
    if (row && ((!authority.personAllowed && authority.reason && REVOKED.has(authority.reason))
      || (authority.personAllowed && row.consentEventId !== authority.consentEventId))) {
      await this.deps.store.delete(input.personId, input.space);
      row = null;
    }
    const reason: VoiceprintUnavailableReason | undefined = !authority.personAllowed ? authority.reason ?? 'biometric_consent_required'
      : !this.deps.provider ? 'provider_unavailable' : !this.thresholds() ? 'thresholds_missing' : undefined;
    return {
      space: input.space, available: !reason, ...(reason ? { reason } : {}), enrolled: !!row,
      ...(row ? { provider: row.provider, modelVersion: row.modelVersion, channel: row.channel, createdAt: iso(row.createdAt),
        ...(row.lastConfirmedAt ? { lastConfirmedAt: iso(row.lastConfirmedAt) } : {}) } : {}),
    };
  }

  /** Works with the flag off and is idempotent. */
  async delete(input: { personId: string; space?: 'work' | 'personal' }): Promise<{ deleted: number }> {
    return { deleted: await this.deps.store.delete(input.personId, input.space) };
  }

  /** Adaptive voice-identity invalidator: consent withdrawal (one space) or profile change (all spaces). */
  async invalidate(telegramId: number, space?: 'work' | 'personal'): Promise<void> {
    await this.deps.store.delete(`tg-${telegramId}`, space);
  }

  /** Single-flight: generates missing persona echo templates for the current provider/model. Returns the count. */
  ensureEchoTemplates(signal?: AbortSignal): Promise<number> {
    this.echoFlight ??= this.generateEcho(signal).finally(() => { this.echoFlight = undefined; });
    return this.echoFlight;
  }

  private async generateEcho(signal?: AbortSignal): Promise<number> {
    const provider = this.deps.provider;
    if (!provider) return 0;
    const existing = await this.deps.store.listEcho(provider.id, provider.modelVersion);
    if (!this.deps.echoVoices) return existing.length;
    const have = new Set(existing.map(e => e.voiceId));
    let voices: Awaited<ReturnType<EchoVoiceSource>> = [];
    try { voices = await this.deps.echoVoices(); } catch { voices = []; }
    for (const voice of voices) {
      if (have.has(voice.voiceId)) continue;
      try {
        const timeout = this.deps.enrollTimeoutMs ?? ENROLL_TIMEOUT_MS;
        const { audio, mimeType } = await withDeadline(timeout, signal, s => voice.synthesize(s));
        await this.registerEchoVoice(voice.voiceId, audio, mimeType, signal);
        have.add(voice.voiceId);
      } catch { /* swallowed per voice; enrollment refuses when no echo template exists */ }
    }
    return (await this.deps.store.listEcho(provider.id, provider.modelVersion)).length;
  }

  async registerEchoVoice(voiceId: string, audio: ArrayBuffer, mimeType: string, signal?: AbortSignal): Promise<void> {
    if (!this.enabled()) throw new VoiceprintError('disabled', 403);
    const provider = this.deps.provider;
    if (!provider) throw new VoiceprintError('provider_unavailable', 503);
    const bytes = new Uint8Array(audio.byteLength);
    bytes.set(new Uint8Array(audio));
    let template: Uint8Array | undefined;
    try {
      template = await this.providerCall(() => withDeadline(this.deps.enrollTimeoutMs ?? ENROLL_TIMEOUT_MS, signal, s => provider.voiceprint(bytes, mimeType, s)));
      const sealed = this.deps.cipher.seal(template, ['echo', voiceId, provider.id, provider.modelVersion]);
      await this.deps.store.putEcho({ voiceId, provider: provider.id, modelVersion: provider.modelVersion, createdAt: this.now(), template: sealed });
    } finally {
      zero(bytes, template);
    }
  }
}

/** Distinct voices of active agents (their ElevenLabs voice or the presentation default); [] without ElevenLabs. */
export function echoVoicesFromStudio(store: StudioStorage, eleven: ElevenLabsStudio | null): EchoVoiceSource {
  return async () => {
    if (!eleven) return [];
    const state = await store.read();
    const ids = [...new Set(state.agents.filter(a => a.status === 'active')
      .map(a => a.voice?.voiceId ?? defaultVoiceId(a.persona.presentation)))];
    return ids.map(voiceId => ({
      voiceId,
      async synthesize(signal: AbortSignal) {
        if (signal.aborted) throw new DeadlineExceeded();
        const buffer = await eleven.speak(ECHO_CALIBRATION_TEXT, voiceId);
        const audio = new ArrayBuffer(buffer.byteLength);
        new Uint8Array(audio).set(buffer);
        return { audio, mimeType: 'audio/mpeg' };
      },
    }));
  };
}

/** One adaptive voiceIdentityInvalidator calling every handler; the first rejection is rethrown after all settle. */
export function chainVoiceInvalidators(...handlers: { invalidate(telegramId: number, space?: 'work' | 'personal'): Promise<unknown> }[]):
  (input: { telegramId: number; space?: 'work' | 'personal'; reason: string }) => Promise<void> {
  return async input => {
    const results = await Promise.allSettled(handlers.map(handler => Promise.resolve().then(() => handler.invalidate(input.telegramId, input.space))));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  };
}
