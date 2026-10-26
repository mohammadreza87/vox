/**
 * Voiceprint enrollment and 1:1 verification (S11L), shadow mode, behind
 * STUDIO_VOICE_RECOGNITION=1.
 *
 * Nothing runs unless every gate holds: the flag (tirehFlags() at call time),
 * the adaptive capability approval for biometric_recognition (eligible(), with
 * voiceRecognitionEnabled set from the flag in runtime.ts), a granted
 * optional.biometric_recognition consent whose last event carries affirmative
 * ConsentEvidence, a confirmed profile, a non-pending member and, for
 * verification, the persona's agent grant. The internal-pilot manifest
 * withholds the provider: employer availability is not member consent.
 *
 * A band is evidence that can only lower an identity level; it never grants
 * access (PRIV-017). Verification compares the account's own template only
 * (plus Vox persona voices for the self-echo guard), never other people.
 * Groups, guests, non-members and pending people get no template read and no
 * provider contact (PRIV-020). Audio is never stored or logged; templates are
 * sealed in the isolated 'vox_voiceprints' store. The only log line is the
 * field-free 'voiceprint_provider_error'.
 *
 * Authority fence (main 8a7dc55, ported): after every awaited preparation step
 * and immediately before decrypting the owner template or exporting audio to
 * the provider (speech.measure, provider.voiceprint, provider.identify), a
 * synchronous committed read (readDirectAuthorityForEffect) must still show the
 * same authority fingerprint and permission. Unsupported or busy authority
 * never authorizes an export.
 */
import { createHash } from 'node:crypto';
import type { AdaptiveService } from '../../adaptive/persistence/service';
import type { AdaptiveAuthorityDocument, AdaptiveDocument } from '../../adaptive/persistence/repository';
import { spaceIdFor } from '../../adaptive/persistence/repository';
import { tirehFlags, type TirehFlags } from '../../tireh/flags';
import type { VoiceNoteInput, VoiceNoteVerifier, VoiceVerification } from '../../tireh/identity/voice-band';
import { bandFor, resolveThresholds, type BandThresholds, type VoiceThresholdConfig } from './config';
import type { VoiceprintCipher } from './crypto';
import { ENROLL_MIN_NET_SPEECH_MS, grossTooShort, meetsNetSpeech, MIN_NET_SPEECH_MS } from './net-speech';
import { VoiceprintProviderError, type SpeechActivity, type VoiceprintProvider } from './provider';
import type { SelfEchoSource } from './self-echo';
import type { VoiceChannel, VoiceprintStore, VoiceSpace } from './store';

export const MAX_VOICEPRINT_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_TEMPLATE_AGE_MS = 365 * 86_400_000;
export const DEFAULT_VERIFY_DEADLINE_MS = 3_000;
export const DEFAULT_ENROLL_DEADLINE_MS = 60_000;
/** The no-opinion reason verifyVoiceNote gives for a voice note above MAX_VOICEPRINT_AUDIO_BYTES (see verifyVoiceNote). */
export const VERIFY_TOO_LARGE_REASON = 'provider_error' as const;
/** Default period of startVoiceprintSweep: daily. */
export const VOICEPRINT_SWEEP_EVERY_MS = 86_400_000;
const MAX_IDENTIFY_CANDIDATES = 50;
const PURPOSE = 'optional.biometric_recognition' as const;

export type VoiceprintErrorCode =
  | 'disabled' | 'provider_unavailable' | 'thresholds_unconfigured' | 'not_member' | 'capability_unavailable'
  | 'biometric_consent_required' | 'profile_confirmation_required' | 'too_large' | 'self_echo_unavailable'
  | 'mixed_speakers' | 'too_short' | 'self_echo' | 'timeout' | 'provider_error' | 'consent_changed';

/** Content-free: a status and a code, never provider text. */
export class VoiceprintError extends Error {
  override readonly name = 'VoiceprintError';
  constructor(readonly status: number, readonly code: VoiceprintErrorCode) { super(code); }
}

export interface VoiceprintStatus {
  space: VoiceSpace;
  available: boolean;
  reason?: VoiceprintErrorCode;
  consent: 'granted' | 'missing';
  enrolled: boolean;
  provider?: string;
  modelVersion?: string;
  channel?: VoiceChannel;
  createdAt?: string;
  lastConfirmedAt?: string;
}

export interface VoiceprintServiceOptions {
  adaptive: Pick<AdaptiveService, 'withAccountDocument' | 'readDirectAuthorityForEffect' | 'isProfileConfirmed' | 'capabilityStatus' | 'isPurposeAllowed'>;
  store: VoiceprintStore;
  cipher: VoiceprintCipher;
  provider?: VoiceprintProvider;
  speech?: SpeechActivity;
  selfEcho?: SelfEchoSource;
  thresholds: VoiceThresholdConfig | null;
  orgKey: string;
  pilot?: boolean;
  eligiblePerson: (telegramId: number) => Promise<boolean>;
  /**
   * Every eligible member's telegram id, read once per sweep (one Studio state read for N rows). Without it the
   * sweep falls back to eligiblePerson per row.
   */
  eligiblePeople?: () => Promise<ReadonlySet<number>>;
  verifyDeadlineMs?: number;
  enrollDeadlineMs?: number;
  now?: () => number;
  flags?: () => Pick<TirehFlags, 'voiceRecognition'>;
  logger?: Pick<Console, 'warn'>;
}

/**
 * The granted biometric permission of `space` and its event id, only when the
 * last event is a 'granted' consent event for the same person and purpose with
 * affirmative evidence. Anything else is null (fail closed).
 */
export function biometricGrant(d: AdaptiveDocument, space: VoiceSpace, now: number): { permissionId: string; eventId: string } | null {
  const spaceId = spaceIdFor(d.accountId, space);
  const p = d.permissions.find(x => x.spaceId === spaceId && x.purpose === PURPOSE);
  if (!p || p.state !== 'granted' || !(p.expiresAt > now) || !p.lastEventId) return null;
  const event = (d.consentEvents ?? []).find(e => e.eventId === p.lastEventId);
  if (!event || event.state !== 'granted' || event.purpose !== PURPOSE || event.personId !== d.personId
    || event.evidence?.kind !== 'consent' || event.evidence.affirmative !== true) return null;
  return { permissionId: p.id, eventId: p.lastEventId };
}

interface Authority {
  allowedEnroll: boolean;
  allowedVerify: boolean;
  grantEventId?: string;
  reason?: 'capability_unavailable' | 'profile_confirmation_required' | 'biometric_consent_required';
  fingerprint: string;
}

/** Evidence-free decision over the compact direct controls; shared by the transactional read and the synchronous fence. */
interface ControlsDecision {
  /** Confirmed profile, eligible capability, purpose allowed and an unexpired granted permission with an event id. */
  allowed: boolean;
  /** allowed plus the agent's purpose grant (false without an agent). */
  allowedAgent: boolean;
  confirmed: boolean;
  capabilityEligible: boolean;
  fingerprint: string;
  deadline?: number;
}

/** Thrown inside an export callback when the committed fence no longer authorizes the export. */
class FenceLost extends Error { constructor() { super('fence_lost'); this.name = 'FenceLost'; } }

const DENIED: Authority = { allowedEnroll: false, allowedVerify: false, reason: 'biometric_consent_required', fingerprint: 'unavailable' };
const NO_OPINION = (reason: Extract<VoiceVerification, { band: 'NO_OPINION' }>['reason'], netSpeechMs?: number): VoiceVerification =>
  netSpeechMs === undefined ? { band: 'NO_OPINION', reason } : { band: 'NO_OPINION', reason, netSpeechMs };
const personIdFor = (telegramId: number) => `tg-${telegramId}`;
const telegramIdOf = (personId: string): number | null => {
  const match = /^tg-([1-9]\d{0,15})$/.exec(personId);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) ? value : null;
};
const iso = (d?: Date) => d?.toISOString();
const batches = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

class Aborted extends Error { constructor() { super('aborted'); this.name = 'Aborted'; } }
/** Rejects as soon as `signal` aborts, even when `run` ignores the signal. */
function untilAborted<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new Aborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    let started: Promise<T>;
    try { started = run(); } catch (error) { signal.removeEventListener('abort', onAbort); reject(error); return; }
    started.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(signal.aborted ? new Aborted() : error); });
  });
}

export class VoiceprintService implements VoiceNoteVerifier {
  private readonly inflight = new Map<string, Set<AbortController>>();

  constructor(private readonly o: VoiceprintServiceOptions) {}

  private enabled(): boolean { return (this.o.flags ?? tirehFlags)().voiceRecognition === true; }
  private now(): number { return this.o.now?.() ?? Date.now(); }
  private ready(): boolean { return !!this.o.provider && !!this.o.speech && !!this.o.selfEcho && !this.o.pilot; }

  /**
   * Pure, synchronous and content-free: everything the fence needs is in the
   * direct authority controls. The fingerprint carries the permission's last
   * consent event id, so an unchanged fingerprint means the same consent event
   * whose affirmative evidence the transactional read verified.
   */
  private decide(d: AdaptiveAuthorityDocument, space: VoiceSpace, now: number, agentId?: string): ControlsDecision {
    const adaptive = this.o.adaptive;
    const spaceId = spaceIdFor(d.accountId, space);
    const permission = d.permissions.find(x => x.spaceId === spaceId && x.purpose === PURPOSE);
    const capability = adaptive.capabilityStatus(d, 'biometric_recognition', now);
    const confirmed = adaptive.isProfileConfirmed(d, now);
    const granted = !!permission && permission.state === 'granted' && permission.expiresAt > now && !!permission.lastEventId;
    const allowed = confirmed && capability.eligible && adaptive.isPurposeAllowed(d, space, PURPOSE, now) && granted;
    const allowedAgent = allowed && !!agentId && adaptive.isPurposeAllowed(d, space, PURPOSE, now, agentId);
    const agentGrant = agentId ? d.agentGrants.filter(g => g.space === space && g.agentId === agentId) : null;
    const fingerprint = createHash('sha256').update(JSON.stringify([
      d.accountId, d.personId, d.binding ?? null,
      permission ? [permission.id, permission.revision, permission.epoch, permission.state, permission.expiresAt, permission.lastEventId ?? null] : null,
      capability, agentGrant,
    ])).digest('hex');
    const deadline = allowed && permission
      ? Math.min(permission.expiresAt, capability.validUntil ?? permission.expiresAt, d.binding?.expiresAt ?? permission.expiresAt) : undefined;
    return { allowed, allowedAgent, confirmed, capabilityEligible: capability.eligible, fingerprint, ...(deadline === undefined ? {} : { deadline }) };
  }

  /** Content-free authority snapshot read through the public adaptive transaction seam. Any failure denies. */
  private async authority(telegramId: number, space: VoiceSpace, agentId?: string): Promise<Authority> {
    try {
      return await this.o.adaptive.withAccountDocument(telegramId, (d, now): Authority => {
        const decision = this.decide(d, space, now, agentId);
        const grant = biometricGrant(d, space, now);
        const allowedEnroll = decision.allowed && !!grant;
        const allowedVerify = allowedEnroll && decision.allowedAgent;
        // An unconfirmed profile is reported first: it is the step the member can take.
        const reason = !decision.confirmed ? 'profile_confirmation_required' as const
          : !decision.capabilityEligible ? 'capability_unavailable' as const
            : !allowedEnroll ? 'biometric_consent_required' as const : undefined;
        return { allowedEnroll, allowedVerify, ...(grant ? { grantEventId: grant.eventId } : {}), ...(reason ? { reason } : {}), fingerprint: decision.fingerprint };
      });
    } catch {
      return DENIED;
    }
  }

  /**
   * Synchronous committed fence (main 8a7dc55): true only when the committed
   * direct authority is 'ready', has the same fingerprint as the snapshot the
   * work started from and still allows verification (with an agent) or
   * enrollment (without). Busy, unsupported, missing or any error is false.
   */
  private authorityNow(telegramId: number, space: VoiceSpace, fingerprint: string, agentId?: string): boolean {
    if (!this.enabled()) return false;
    try {
      const current = this.o.adaptive.readDirectAuthorityForEffect(telegramId, space, (d, now) => {
        const decision = this.decide(d, space, now, agentId);
        const ok = agentId ? decision.allowedAgent : decision.allowed;
        const value = { ok, fingerprint: decision.fingerprint };
        return ok ? { value, ...(decision.deadline === undefined ? {} : { deadline: decision.deadline }) } : { value, denied: true };
      });
      return current.status === 'ready' && current.value.ok && current.value.fingerprint === fingerprint;
    } catch {
      return false;
    }
  }

  private track(telegramId: number, space: VoiceSpace): { controller: AbortController; done: () => void } {
    const key = `${telegramId}|${space}`;
    const controller = new AbortController();
    const set = this.inflight.get(key) ?? new Set<AbortController>();
    set.add(controller);
    this.inflight.set(key, set);
    return { controller, done: () => { set.delete(controller); if (!set.size && this.inflight.get(key) === set) this.inflight.delete(key); } };
  }

  private abortInflight(telegramId: number, space?: VoiceSpace): void {
    for (const s of space ? [space] : ['work', 'personal'] as const) {
      for (const controller of this.inflight.get(`${telegramId}|${s}`) ?? []) controller.abort();
    }
  }

  async enroll(input: { telegramId: number; audio: Uint8Array; mimeType: string; space: VoiceSpace; channel: VoiceChannel }, signal?: AbortSignal): Promise<VoiceprintStatus> {
    if (!this.enabled()) throw new VoiceprintError(404, 'disabled');
    const { provider, speech, selfEcho } = this.o;
    if (!this.ready() || !provider || !speech || !selfEcho) throw new VoiceprintError(503, 'provider_unavailable');
    const thresholds = resolveThresholds(this.o.thresholds, this.o.orgKey, input.channel);
    if (!thresholds) throw new VoiceprintError(503, 'thresholds_unconfigured');
    if (!(await this.o.eligiblePerson(input.telegramId))) throw new VoiceprintError(403, 'not_member');
    const before = await this.authority(input.telegramId, input.space);
    if (!before.allowedEnroll || !before.grantEventId) throw new VoiceprintError(403, before.reason ?? 'biometric_consent_required');
    if (input.audio.byteLength < 1 || input.audio.byteLength > MAX_VOICEPRINT_AUDIO_BYTES) throw new VoiceprintError(413, 'too_large');

    const tracked = this.track(input.telegramId, input.space);
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(this.o.enrollDeadlineMs ?? DEFAULT_ENROLL_DEADLINE_MS), tracked.controller.signal]);
    let template: Uint8Array | undefined;
    const echoTemplates: Uint8Array[] = [];
    try {
      const echo = await untilAborted(combined, () => selfEcho.templates(combined)).catch(error => {
        if (!(error instanceof Aborted)) return null;
        throw tracked.controller.signal.aborted ? new VoiceprintError(409, 'consent_changed') : new VoiceprintError(504, 'timeout');
      });
      if (!echo) throw new VoiceprintError(503, 'self_echo_unavailable');
      echoTemplates.push(...echo.map(e => e.template));
      let measured: { netSpeechMs: number; speakers: number };
      let echoScores: number[];
      try {
        [measured, template, ...echoScores] = await untilAborted(combined, () => {
          // Fence: nothing leaves for the provider unless the committed authority is unchanged.
          if (!this.authorityNow(input.telegramId, input.space, before.fingerprint)) throw new FenceLost();
          return Promise.all([
            speech.measure(input.audio, input.mimeType, combined),
            provider.voiceprint(input.audio, input.mimeType, combined),
            ...batches(echo, MAX_IDENTIFY_CANDIDATES).map(batch => provider.identify(input.audio, batch, combined).then(r => r.score)),
          ]);
        }) as [{ netSpeechMs: number; speakers: number }, Uint8Array, ...number[]];
      } catch (error) {
        if (tracked.controller.signal.aborted || error instanceof FenceLost) throw new VoiceprintError(409, 'consent_changed');
        if (error instanceof Aborted || combined.aborted) throw new VoiceprintError(504, 'timeout');
        if (error instanceof VoiceprintProviderError && error.code === 'mixed_speakers') throw new VoiceprintError(422, 'mixed_speakers');
        this.o.logger?.warn('voiceprint_provider_error');
        throw new VoiceprintError(502, 'provider_error');
      }
      if (measured.speakers > 1) throw new VoiceprintError(422, 'mixed_speakers');
      if (!meetsNetSpeech(measured.netSpeechMs, ENROLL_MIN_NET_SPEECH_MS)) throw new VoiceprintError(422, 'too_short');
      if (echoScores.some(score => Number.isFinite(score) && score >= thresholds.selfEcho)) throw new VoiceprintError(422, 'self_echo');
      if (tracked.controller.signal.aborted) throw new VoiceprintError(409, 'consent_changed');

      const during = await this.authority(input.telegramId, input.space);
      if (during.fingerprint !== before.fingerprint || !during.allowedEnroll) throw new VoiceprintError(409, 'consent_changed');
      const personId = personIdFor(input.telegramId);
      const provenance = { personId, space: input.space, provider: provider.id, modelVersion: provider.modelVersion, consentEventId: before.grantEventId };
      const sealed = this.o.cipher.seal(template, provenance);
      await this.o.store.put({ ...provenance, channel: input.channel, createdAt: new Date(this.now()), template: sealed });
      // Closes the race with a withdrawal whose invalidator ran before the put.
      const after = await this.authority(input.telegramId, input.space);
      if (after.fingerprint !== before.fingerprint || !after.allowedEnroll || tracked.controller.signal.aborted) {
        await this.o.store.delete(personId, input.space);
        throw new VoiceprintError(409, 'consent_changed');
      }
    } finally {
      template?.fill(0);
      for (const t of echoTemplates) t.fill(0);
      tracked.done();
    }
    return this.status(input.telegramId, input.space);
  }

  /** Never returns template bytes or the consent event id. Works without the flag and without a provider. */
  async status(telegramId: number, space: VoiceSpace): Promise<VoiceprintStatus> {
    const personId = personIdFor(telegramId);
    const authority = await this.authority(telegramId, space);
    let row = await this.o.store.get(personId, space);
    // A template from an earlier consent never survives re-consent.
    if (row && authority.grantEventId && row.consentEventId !== authority.grantEventId) {
      await this.o.store.delete(personId, space);
      row = null;
    }
    const reason: VoiceprintErrorCode | undefined = !this.enabled() ? 'disabled'
      : !this.ready() ? 'provider_unavailable'
        : !resolveThresholds(this.o.thresholds, this.o.orgKey, 'mini_app') ? 'thresholds_unconfigured'
          : !authority.allowedEnroll ? authority.reason ?? 'biometric_consent_required' : undefined;
    return {
      space, available: !reason, ...(reason ? { reason } : {}), consent: authority.grantEventId ? 'granted' : 'missing', enrolled: !!row,
      ...(row ? { provider: row.provider, modelVersion: row.modelVersion, channel: row.channel, createdAt: iso(row.createdAt),
        ...(row.lastConfirmedAt ? { lastConfirmedAt: iso(row.lastConfirmedAt) } : {}) } : {}),
    };
  }

  /** Always allowed, including with the flag off. Aborts in-flight work first. */
  async delete(telegramId: number, space: VoiceSpace): Promise<VoiceprintStatus> {
    this.abortInflight(telegramId, space);
    await this.o.store.delete(personIdFor(telegramId), space);
    return this.status(telegramId, space);
  }

  /** Adaptive invalidator: consent withdrawal or change (one space) or profile change (both spaces). */
  async invalidate(telegramId: number, space?: VoiceSpace): Promise<void> {
    this.abortInflight(telegramId, space);
    await this.o.store.delete(personIdFor(telegramId), space);
  }

  /**
   * Deletes rows older than MAX_TEMPLATE_AGE_MS and rows of people who are no longer members. Returns the count.
   * Iterates the store's keys only (never a sealed template) and reads membership once per sweep when
   * eligiblePeople is wired. When that read fails, membership is unknown: only expired rows are deleted (a failed
   * state read never mass-deletes templates), and the sweep rejects afterwards so the caller gets a signal.
   */
  async sweep(): Promise<number> {
    const now = this.now();
    let people: ReadonlySet<number> | undefined;
    let membershipUnknown = false;
    if (this.o.eligiblePeople) {
      try { people = await this.o.eligiblePeople(); } catch { membershipUnknown = true; }
    }
    const isMember = async (telegramId: number): Promise<boolean> => {
      if (membershipUnknown) return true;
      if (people) return people.has(telegramId);
      return this.o.eligiblePerson(telegramId).catch(() => true);
    };
    let removed = 0;
    for await (const key of this.o.store.listKeys()) {
      const telegramId = telegramIdOf(key.personId);
      const expired = now - key.createdAt.getTime() > MAX_TEMPLATE_AGE_MS;
      const member = telegramId !== null && await isMember(telegramId);
      if (expired || !member) removed += await this.o.store.delete(key.personId, key.space);
    }
    if (membershipUnknown) throw new Error('voiceprint_membership_unavailable');
    return removed;
  }

  async warmSelfEcho(signal?: AbortSignal): Promise<void> {
    await this.o.selfEcho?.warm(signal);
  }

  async verifyVoiceNote(input: VoiceNoteInput, signal?: AbortSignal): Promise<VoiceVerification> {
    let owner: Uint8Array | undefined;
    let tracked: ReturnType<VoiceprintService['track']> | undefined;
    const echoTemplates: Uint8Array[] = [];
    try {
      if (!this.enabled()) return NO_OPINION('disabled');
      // Same cap as enroll, before any read, authority, tracking or upload. The shared reason union
      // (tireh/identity/voice-band.ts, byte-pinned by voice-band.test.ts) has no 'too_large', so this returns its
      // generic bucket. TODO(H5): add 'too_large' to VoiceNoOpinionReason and use it here when that contract file and
      // its sha256 pin next move (the file is outside this change).
      if (input.audio.byteLength > MAX_VOICEPRINT_AUDIO_BYTES) return NO_OPINION(VERIFY_TOO_LARGE_REASON);
      const { provider, speech, selfEcho } = this.o;
      const thresholds: BandThresholds | null = resolveThresholds(this.o.thresholds, this.o.orgKey, input.channel);
      if (!this.ready() || !provider || !speech || !selfEcho || !thresholds) return NO_OPINION('disabled');
      // PRIV-020: nothing is read, uploaded or compared when a group or a guest can hear.
      if (input.chatKind !== 'private' || input.guestAudience) return NO_OPINION('guest_or_group');
      const telegramId = telegramIdOf(input.personId);
      if (telegramId === null) return NO_OPINION('not_enrolled');
      if (!(await this.o.eligiblePerson(telegramId))) return NO_OPINION('guest_or_group');
      if (grossTooShort(input.durationSec)) return NO_OPINION('too_short');
      // Registered like enroll: invalidate() aborts an in-flight verification (and its touch) before deleting.
      tracked = this.track(telegramId, input.space);
      const withdrawn = tracked.controller.signal;
      const before = await this.authority(telegramId, input.space, input.personaId);
      if (!before.allowedVerify || !before.grantEventId) return NO_OPINION('consent_missing');
      const row = await this.o.store.get(input.personId, input.space);
      if (!row || row.modelVersion !== provider.modelVersion || row.provider !== provider.id
        || this.now() - row.createdAt.getTime() > MAX_TEMPLATE_AGE_MS) return NO_OPINION('not_enrolled');
      if (row.consentEventId !== before.grantEventId) {
        await this.o.store.delete(input.personId, input.space);
        return NO_OPINION('not_enrolled');
      }
      // Fence: the awaited reads above may have raced a withdrawal; never decrypt without current authority.
      if (!this.authorityNow(telegramId, input.space, before.fingerprint, input.personaId)) return NO_OPINION('consent_missing');
      try {
        owner = this.o.cipher.open(row.template, row);
      } catch {
        return NO_OPINION('provider_error');
      }
      const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(this.o.verifyDeadlineMs ?? DEFAULT_VERIFY_DEADLINE_MS), withdrawn]);
      const echo = await untilAborted(combined, () => selfEcho.templates(combined)).catch(() => null);
      if (withdrawn.aborted) return NO_OPINION('consent_missing');
      if (!echo) return NO_OPINION(combined.aborted ? 'timeout' : 'provider_error');
      echoTemplates.push(...echo.map(e => e.template));
      // A view, not a copy: STT reads the same buffer and nothing here mutates it.
      const query = new Uint8Array(input.audio);
      const ownerTemplate = owner;
      let measured: { netSpeechMs: number; speakers: number };
      let ownerResult: { candidateId?: string; score: number };
      let echoScores: number[];
      try {
        [measured, ownerResult, ...echoScores] = await untilAborted(combined, () => {
          // Fence: a withdrawal during the echo lookup must stop the upload, not only drop the band.
          if (!this.authorityNow(telegramId, input.space, before.fingerprint, input.personaId)) throw new FenceLost();
          return Promise.all([
            speech.measure(query, input.mimeType, combined),
            provider.identify(query, [{ id: 'owner', template: ownerTemplate }], combined),
            ...batches(echo, MAX_IDENTIFY_CANDIDATES).map(batch => provider.identify(query, batch, combined).then(r => r.score)),
          ]);
        }) as [{ netSpeechMs: number; speakers: number }, { candidateId?: string; score: number }, ...number[]];
      } catch (error) {
        if (error instanceof FenceLost || withdrawn.aborted) return NO_OPINION('consent_missing');
        if (error instanceof Aborted || combined.aborted) return NO_OPINION('timeout');
        // A second voice means a bystander: PRIV-020 applies.
        if (error instanceof VoiceprintProviderError && error.code === 'mixed_speakers') return NO_OPINION('guest_or_group');
        this.o.logger?.warn('voiceprint_provider_error');
        return NO_OPINION('provider_error');
      }
      if (measured.speakers > 1) return NO_OPINION('guest_or_group');
      const netSpeechMs = Math.max(0, Math.round(measured.netSpeechMs));
      if (!meetsNetSpeech(netSpeechMs, MIN_NET_SPEECH_MS)) return NO_OPINION('too_short', netSpeechMs);
      if (echoScores.some(score => Number.isFinite(score) && score >= thresholds.selfEcho)) return NO_OPINION('self_echo', netSpeechMs);
      const after = await this.authority(telegramId, input.space, input.personaId);
      if (withdrawn.aborted || after.fingerprint !== before.fingerprint || !after.allowedVerify) return NO_OPINION('consent_missing');
      const ownerScore = ownerResult.candidateId === undefined || ownerResult.candidateId === 'owner' ? ownerResult.score : 0;
      const band = bandFor(ownerScore, thresholds);
      if (band === 'MATCH') await this.o.store.touch(input.personId, input.space, new Date(this.now())).catch(() => undefined);
      return { band, netSpeechMs, modelVersion: provider.modelVersion };
    } catch {
      return NO_OPINION('provider_error');
    } finally {
      tracked?.done();
      owner?.fill(0);
      for (const t of echoTemplates) t.fill(0);
    }
  }
}

/**
 * One adaptive invalidator slot for several handlers (main's semantics): every handler runs even when an earlier one
 * rejects, and the chain then rejects with the first rejection, so the adaptive service still sees the failure.
 */
export function chainVoiceInvalidators(...handlers: { invalidate(telegramId: number, space?: VoiceSpace): Promise<unknown> }[]):
  (input: { telegramId: number; space?: VoiceSpace; reason: string }) => Promise<void> {
  return async input => {
    const results = await Promise.allSettled(handlers.map(handler => Promise.resolve().then(() => handler.invalidate(input.telegramId, input.space))));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  };
}

/**
 * Runs `service.sweep()` now and then every `everyMs` (default daily) on an unref'd timer, so expired templates and
 * those of people who left are deleted without a restart. Never throws: a failed sweep reports only the fixed,
 * content-free code 'sweep_failed'. A tick that finds the previous sweep still running is skipped. Returns a stop
 * function.
 */
export function startVoiceprintSweep(
  service: Pick<VoiceprintService, 'sweep'>,
  options: { now?: boolean; everyMs?: number; onError?: (code: 'sweep_failed') => void } = {},
): () => void {
  const everyMs = options.everyMs ?? VOICEPRINT_SWEEP_EVERY_MS;
  let running = false;
  const report = () => { try { options.onError?.('sweep_failed'); } catch { /* a failing reporter never escapes */ } };
  const run = () => {
    if (running) return;
    running = true;
    void Promise.resolve().then(() => service.sweep()).then(() => undefined, report).finally(() => { running = false; });
  };
  if (options.now ?? true) run();
  const timer = setInterval(run, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
