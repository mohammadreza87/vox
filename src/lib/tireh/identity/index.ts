/**
 * Identity confidence service (S10L, docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.9).
 *
 * Library only: nothing outside src/lib/tireh/identity imports it until
 * Step 10 wires it, and it is never part of the privacy boundary. It produces
 * hints that can only LOWER what the agent reveals; it never grants access,
 * never identifies anyone and never reports to admins.
 *
 * Privacy:
 * - Style profiles exist only after an explicit enroll with the
 *   optional.personalization decision, are deleted on withdrawal, on a
 *   consent-epoch bump, by forget() and after PROFILE_RETENTION_MS idle.
 * - Session state is in memory only and keyed by ids, never persisted.
 * - Audio is never stored or copied; text never reaches this service (callers
 *   pass content-free StyleFeatures).
 * - Logging is one fixed code per call through options.log.warn; errors,
 *   messages and ids are never logged.
 */
import { styleFeaturesSchema, styleVector } from './style-features';
import { newProfile, observeProfile, personModel, profileReady, PROFILE_RETENTION_MS, UNKNOWN_MODEL, WEEK_MS,
  MAX_SELF_SCORES, type GaussianModel, type StyleProfile } from './profile';
import { evaluateFairness, INITIAL_SEQUENTIAL_STATE, MAX_SESSIONS, messageLlr, personThreshold, SESSION_IDLE_MS,
  stepSequential, type SequentialState } from './test';
import { fuseIdentity } from './fusion';
import type { StyleProfileStore } from './store';
import type { VoiceNoteInput, VoiceNoteVerifier, VoiceVerification } from './voice-band';
import type { IdentityAssessment, IdentityService, IdentitySignals, IdentitySpace, StyleFeatures, StyleHint } from './types';

export * from './types';
export * from './voice-band';
export * from './style-features';
export * from './profile';
export * from './test';
export * from './fusion';
export * from './store';

export interface IdentityServiceOptions {
  readonly store: StyleProfileStore;
  readonly voice?: VoiceNoteVerifier;   // S11L VoiceprintService at wiring time; absent => NO_OPINION 'disabled'
  readonly epochOf?: (personId: string, space: 'work' | 'personal') => number | undefined | Promise<number | undefined>; // optional.personalization consent epoch
  readonly unknown?: GaussianModel;     // default UNKNOWN_MODEL
  readonly log?: Pick<Console, 'warn'>; // fixed codes only: 'identity_style_store_unavailable' | 'identity_voice_unavailable'
}

type LogCode = 'identity_style_store_unavailable' | 'identity_voice_unavailable';

interface Session { seq: SequentialState; lastAt: number }

const VOICE_BANDS = new Set(['MATCH', 'UNCERTAIN', 'NO_MATCH']);

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function validSpace(value: unknown): value is IdentitySpace {
  return value === 'work' || value === 'personal';
}

function sessionKey(personaId: string, personId: string, space: IdentitySpace): string {
  return JSON.stringify([personaId, personId, space]);
}

function pushScore(scores: readonly number[], score: number | null): readonly number[] {
  if (score === null || !Number.isFinite(score)) return scores;
  return [...scores, Math.round(score * 1000) / 1000].slice(-MAX_SELF_SCORES);
}

function validVerification(value: unknown): value is VoiceVerification {
  if (typeof value !== 'object' || value === null) return false;
  const band = (value as { band?: unknown }).band;
  return band === 'NO_OPINION' || (typeof band === 'string' && VOICE_BANDS.has(band));
}

export class IdentityConfidenceService implements IdentityService {
  private readonly sessions = new Map<string, Session>();
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: IdentityServiceOptions) {}

  private warn(code: LogCode): void {
    try { this.options.log?.warn(code); } catch { /* logging never breaks identity */ }
  }

  /** Serialises read-modify-write per person and space inside this process. */
  private serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    void tail.then(() => { if (this.locks.get(key) === tail) this.locks.delete(key); });
    return run;
  }

  private touchSession(key: string, session: Session): void {
    this.sessions.delete(key);
    this.sessions.set(key, session);
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next();
      if (oldest.done) break;
      this.sessions.delete(oldest.value);
    }
  }

  private dropSessions(personId: string, space?: IdentitySpace): void {
    for (const key of [...this.sessions.keys()]) {
      const [, person, sessionSpace] = JSON.parse(key) as [string, string, IdentitySpace];
      if (person === personId && (space === undefined || sessionSpace === space)) this.sessions.delete(key);
    }
  }

  async verifyVoiceNote(input: VoiceNoteInput, signal?: AbortSignal): Promise<VoiceVerification> {
    try {
      if (input.chatKind !== 'private' || input.guestAudience !== false) return { band: 'NO_OPINION', reason: 'guest_or_group' };
      if (signal?.aborted) return { band: 'NO_OPINION', reason: 'timeout' };
      const voice = this.options.voice;
      if (!voice) return { band: 'NO_OPINION', reason: 'disabled' };
      const result: unknown = await voice.verifyVoiceNote(input, signal);
      if (validVerification(result)) return result;
    } catch {
      // the provider error is never read or logged
    }
    this.warn('identity_voice_unavailable');
    return { band: 'NO_OPINION', reason: 'provider_error' };
  }

  async observeStyle(input: { personaId: string; personId: string; space: 'work'|'personal'; features: StyleFeatures; at: number; personalizationAllowed: boolean }): Promise<{ stored: boolean; hint?: StyleHint }> {
    try {
      const { personaId, personId, space, features, at, personalizationAllowed } = input;
      if (!validId(personId) || !validSpace(space)) return { stored: false };
      return await this.serial(`${space}\u0000${personId}`, async () => {
        if (personalizationAllowed !== true) {
          // Withdrawal: the profile and every session for this person and space go.
          this.dropSessions(personId, space);
          await this.options.store.delete(personId, space);
          return { stored: false };
        }
        if (!validId(personaId) || !Number.isSafeInteger(at) || !styleFeaturesSchema.safeParse(features).success) return { stored: false };
        let profile = await this.options.store.get(personId, space);
        if (!profile) return { stored: false };
        if (this.options.epochOf) {
          let epoch: number | undefined;
          try { epoch = await this.options.epochOf(personId, space); } catch { return { stored: false }; }
          if (typeof epoch === 'number' && epoch !== profile.epoch) {
            this.dropSessions(personId, space);
            await this.options.store.delete(personId, space);
            return { stored: false };
          }
        }

        const key = sessionKey(personaId, personId, space);
        let session = this.sessions.get(key);
        if (session && at - session.lastAt > SESSION_IDLE_MS) {
          if (session.seq.flagged === null) profile = { ...profile, selfScores: pushScore(profile.selfScores, session.seq.minScore) };
          session = undefined;
        }
        if (!session) {
          session = { seq: INITIAL_SEQUENTIAL_STATE, lastAt: at };
          profile = { ...profile, sessions: profile.sessions + 1 };
        }

        const vector = styleVector(features);
        let hint: StyleHint | undefined;
        if (profileReady(profile)) {
          const llr = messageLlr(personModel(profile), this.options.unknown ?? UNKNOWN_MODEL, vector);
          const step = stepSequential(session.seq, llr, personThreshold(profile, at));
          session = { ...session, seq: step.state };
          if (step.decision !== null) hint = { source: 'style', consistency: step.decision, messages: step.state.messages };
        }
        session = { ...session, lastAt: Math.max(session.lastAt, at) };
        this.touchSession(key, session);
        // A flagged session never trains the owner's baseline (no poisoning by an impostor).
        if (session.seq.flagged === null) profile = observeProfile(profile, vector, at);
        await this.options.store.put(profile);
        return hint ? { stored: true, hint } : { stored: true };
      });
    } catch {
      this.warn('identity_style_store_unavailable');
      return { stored: false };
    }
  }

  async enroll(input: { personId: string; space: 'work'|'personal'; kind: 'style_baseline'; at: number; personalizationAllowed: boolean }): Promise<{ enrolled: boolean; reason?: string }> {
    let fields: { personId: unknown; space: unknown; kind: unknown; at: unknown; allowed: unknown };
    try {
      fields = { personId: input.personId, space: input.space, kind: input.kind, at: input.at, allowed: input.personalizationAllowed };
    } catch {
      return { enrolled: false, reason: 'invalid_input' };
    }
    const { personId, space, kind, at, allowed } = fields;
    if (allowed !== true) {
      if (validId(personId) && validSpace(space)) {
        try {
          await this.serial(`${space}\u0000${personId}`, async () => {
            this.dropSessions(personId, space);
            await this.options.store.delete(personId, space);
          });
        } catch {
          this.warn('identity_style_store_unavailable');
        }
      }
      return { enrolled: false, reason: 'personalization_not_allowed' };
    }
    if (!validId(personId) || !validSpace(space) || kind !== 'style_baseline' || typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) {
      return { enrolled: false, reason: 'invalid_input' };
    }
    let epoch: number | undefined;
    if (this.options.epochOf) {
      try { epoch = await this.options.epochOf(personId, space); } catch { return { enrolled: false, reason: 'epoch_unavailable' }; }
      if (epoch !== undefined && (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0)) {
        return { enrolled: false, reason: 'epoch_unavailable' };
      }
    }
    try {
      await this.serial(`${space}\u0000${personId}`, async () => {
        // Creates the profile, or resets it: an explicit re-baseline that also clears `disabled`.
        await this.options.store.put(newProfile(personId, space, epoch ?? 0, at));
        this.dropSessions(personId, space);
      });
      return { enrolled: true };
    } catch {
      this.warn('identity_style_store_unavailable');
      return { enrolled: false, reason: 'store_unavailable' };
    }
  }

  assess(signals: IdentitySignals): IdentityAssessment {
    return fuseIdentity(signals);
  }

  /**
   * The answer to the one neutral "still you?" question (Step 10 wiring).
   * 'confirmed_self' counts a false prompt and calibrates the threshold with
   * the session's score; 'other_person' pins the session to inconsistent and
   * never touches the profile.
   */
  async recordPromptOutcome(input: { personaId: string; personId: string; space: 'work'|'personal'; outcome: 'confirmed_self' | 'other_person'; at: number }): Promise<void> {
    try {
      const { personaId, personId, space, outcome, at } = input;
      if (!validId(personaId) || !validId(personId) || !validSpace(space) || !Number.isSafeInteger(at)) return;
      const key = sessionKey(personaId, personId, space);
      if (outcome === 'other_person') {
        const session = this.sessions.get(key) ?? { seq: INITIAL_SEQUENTIAL_STATE, lastAt: at };
        this.touchSession(key, { seq: { ...session.seq, flagged: 'inconsistent' }, lastAt: Math.max(session.lastAt, at) });
        return;
      }
      if (outcome !== 'confirmed_self') return;
      await this.serial(`${space}\u0000${personId}`, async () => {
        const profile = await this.options.store.get(personId, space);
        const session = this.sessions.get(key);
        if (session) this.touchSession(key, { seq: INITIAL_SEQUENTIAL_STATE, lastAt: Math.max(session.lastAt, at) });
        if (!profile) return;
        await this.options.store.put({
          ...profile,
          falsePrompts: profile.falsePrompts + 1,
          selfScores: pushScore(profile.selfScores, session?.seq.minScore ?? null),
        });
      });
    } catch {
      this.warn('identity_style_store_unavailable');
    }
  }

  /** Erasure: deletes the profile (one space or both) and every in-memory session. Rejects with a fixed error. */
  async forget(personId: string, space?: 'work'|'personal'): Promise<void> {
    if (!validId(personId) || (space !== undefined && !validSpace(space))) return;
    this.dropSessions(personId, space);
    try {
      if (space) await this.options.store.delete(personId, space);
      else await this.options.store.deleteAllFor(personId);
    } catch {
      this.warn('identity_style_store_unavailable');
      throw new Error('identity_forget_failed');
    } finally {
      this.dropSessions(personId, space);
    }
  }

  /** Disables members for whom the signal is systematically wrong; returns how many verdicts were applied. */
  async applyFairness(space: 'work'|'personal', at: number): Promise<number> {
    try {
      if (!validSpace(space) || !Number.isSafeInteger(at)) return 0;
      const profiles = await this.options.store.list(space);
      const byPerson = new Map<string, StyleProfile>(profiles.map(profile => [profile.personId, profile]));
      const verdicts = evaluateFairness(profiles.map(profile => ({
        key: profile.personId, falsePrompts: profile.falsePrompts, weeksObserved: (at - profile.createdAt) / WEEK_MS,
      })));
      let applied = 0;
      for (const verdict of verdicts) {
        const profile = byPerson.get(verdict.key);
        if (!profile) continue;
        const done = await this.serial(`${space}\u0000${profile.personId}`, async () => {
          const current = await this.options.store.get(profile.personId, space);
          if (!current) return false;
          await this.options.store.put({ ...current, disabled: true, disabledReason: verdict.reason });
          return true;
        });
        if (done) applied++;
      }
      return applied;
    } catch {
      this.warn('identity_style_store_unavailable');
      return 0;
    }
  }

  /** Retention: deletes profiles not updated for PROFILE_RETENTION_MS. */
  async sweep(at: number): Promise<number> {
    try {
      if (!Number.isSafeInteger(at)) return 0;
      return await this.options.store.sweep(at - PROFILE_RETENTION_MS);
    } catch {
      this.warn('identity_style_store_unavailable');
      return 0;
    }
  }
}
