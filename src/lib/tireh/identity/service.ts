/**
 * StyleIdentityService: the IdentityService seam of
 * docs/AGENT_INTELLIGENCE_SOLUTION.md 4.9 (step S10L, NOT wired).
 *
 * - Stores nothing unless personalizationAllowed === true (optional.personalization).
 * - Voice verification runs only through an injected verifier, never for groups or guests.
 * - The per-key session state (a SequentialState and up to MIN_TEST_MESSAGES
 *   pending feature vectors) lives in a bounded in-process LRU, never in a store.
 * - Messages of a session that turns 'uncertain' are never learned.
 * - Logs carry only {type: 'identity', code}: no ids, levels, hints or text.
 */
import { z } from 'zod';
import { assessIdentity, DEFAULT_FUSION_WEIGHTS, validateWeights, type FusionWeights } from './fusion';
import {
  emptyProfile, foldFeatures, isScorable, needsDeletion, needsRebaseline, resetStatistics, STYLE_PROFILE_VERSION,
  type StyleProfile, type StyleProfileKey,
} from './profile';
import type { StyleProfileStore } from './store';
import { styleFeaturesSchema, type StyleFeatures } from './style-features';
import {
  ABSOLUTE_WINDOW_MS, applyPromptOutcome, autoDisable, hintAllowed, messageLlr, MIN_TEST_MESSAGES, relaxCalibration,
  sessionExpired, startSequential, stepSequential, UNKNOWN_CLASS_V1,
  type MemberErrorStat, type PromptOutcome, type SequentialState, type UnknownClass,
} from './test';
import type {
  EnrollRefusal, IdentityAssessment, IdentityLog, IdentityLogEvent, IdentityService, IdentitySignals, StyleHint,
} from './types';
import type { VoiceNoteInput, VoiceNoteVerifier, VoiceVerification } from './voice-band';

export interface StyleIdentityServiceOptions {
  readonly store: StyleProfileStore;
  readonly voice?: VoiceNoteVerifier;
  readonly epochOf?: (key: StyleProfileKey) => Promise<number>;
  readonly unknownClass?: UnknownClass;
  readonly weights?: FusionWeights;
  readonly log?: IdentityLog;
  readonly maxSessions?: number;
}

interface PendingMessage { readonly features: StyleFeatures; readonly at: number }
interface SessionEntry { readonly key: StyleProfileKey; readonly state: SequentialState; readonly pending: readonly PendingMessage[] }

const idSchema = z.string().min(1).max(200);
const spaceSchema = z.enum(['work', 'personal']);
const timeSchema = z.number().min(0).refine(Number.isFinite);
const observeSchema = z.object({
  personaId: idSchema, personId: idSchema, space: spaceSchema, features: styleFeaturesSchema, at: timeSchema,
  personalizationAllowed: z.boolean(),
}).strict();
const enrollSchema = z.object({
  personId: idSchema, space: spaceSchema, kind: z.literal('style_baseline'), at: timeSchema, personalizationAllowed: z.boolean(),
}).strict();
const outcomeSchema = z.object({
  personaId: idSchema, personId: idSchema, space: spaceSchema, outcome: z.enum(['confirmed_self', 'someone_else']),
  at: timeSchema, personalizationAllowed: z.boolean(),
}).strict();

const NO_LOG: IdentityLog = { warn: () => undefined };

function sessionKey(key: StyleProfileKey): string {
  return JSON.stringify([key.personaId, key.personId, key.space]);
}

function noOpinion(reason: 'guest_or_group' | 'disabled' | 'timeout' | 'provider_error'): VoiceVerification {
  return { band: 'NO_OPINION', reason };
}

/** Folds pending messages in arrival order. */
function foldAll(profile: StyleProfile, pending: readonly PendingMessage[]): StyleProfile {
  return pending.reduce((p, m) => foldFeatures(p, m.features, m.at), profile);
}

export class StyleIdentityService implements IdentityService {
  private readonly store: StyleProfileStore;
  private readonly voice?: VoiceNoteVerifier;
  private readonly epochOf: (key: StyleProfileKey) => Promise<number>;
  private readonly unknownClass: UnknownClass;
  private readonly weights: FusionWeights;
  private readonly log: IdentityLog;
  private readonly maxSessions: number;
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(options: StyleIdentityServiceOptions) {
    this.store = options.store;
    this.voice = options.voice;
    this.epochOf = options.epochOf ?? (async () => 0);
    this.unknownClass = options.unknownClass ?? UNKNOWN_CLASS_V1;
    this.weights = validateWeights(options.weights ?? DEFAULT_FUSION_WEIGHTS);
    this.log = options.log ?? NO_LOG;
    const max = options.maxSessions ?? 10_000;
    this.maxSessions = Number.isSafeInteger(max) && max > 0 ? max : 10_000;
  }

  /** Number of in-process sessions (a count only; for tests and capacity checks). */
  get activeSessions(): number {
    return this.sessions.size;
  }

  private warn(code: IdentityLogEvent['code']): void {
    try { this.log.warn({ type: 'identity', code }); } catch { /* logging never breaks identity */ }
  }

  private putSession(entry: SessionEntry): void {
    const id = sessionKey(entry.key);
    this.sessions.delete(id);
    this.sessions.set(id, entry);
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  private dropSessions(match: (key: StyleProfileKey) => boolean): void {
    for (const [id, entry] of [...this.sessions]) if (match(entry.key)) this.sessions.delete(id);
  }

  async verifyVoiceNote(input: VoiceNoteInput, signal?: AbortSignal): Promise<VoiceVerification> {
    try {
      if (!input || input.chatKind !== 'private' || input.guestAudience !== false) return noOpinion('guest_or_group');
      const verifier = this.voice;
      if (!verifier) return noOpinion('disabled');
      if (signal?.aborted) { this.warn('verifier_timeout'); return noOpinion('timeout'); }
      const aborted = Symbol('aborted');
      let onAbort: (() => void) | undefined;
      try {
        const abort = new Promise<typeof aborted>(resolve => {
          onAbort = () => resolve(aborted);
          signal?.addEventListener('abort', onAbort, { once: true });
        });
        const result = await Promise.race([Promise.resolve().then(() => verifier.verifyVoiceNote(input, signal)), abort]);
        if (result === aborted || signal?.aborted) { this.warn('verifier_timeout'); return noOpinion('timeout'); }
        return result;
      } finally {
        if (onAbort) signal?.removeEventListener('abort', onAbort);
      }
    } catch {
      if (signal?.aborted) { this.warn('verifier_timeout'); return noOpinion('timeout'); }
      this.warn('verifier_error');
      return noOpinion('provider_error');
    }
  }

  async observeStyle(input: {
    personaId: string; personId: string; space: 'work' | 'personal'; features: StyleFeatures; at: number; personalizationAllowed: boolean;
  }): Promise<{ stored: boolean; hint?: StyleHint }> {
    const parsed = observeSchema.safeParse(input);
    if (!parsed.success) { this.warn('invalid_input'); return { stored: false }; }
    const { personaId, personId, space, features, at, personalizationAllowed } = parsed.data;
    const key: StyleProfileKey = { personaId, personId, space };
    const id = sessionKey(key);
    try {
      if (personalizationAllowed !== true) {
        this.sessions.delete(id);
        await this.store.delete(key);
        return { stored: false };
      }
      const epoch = await this.epochOf(key);
      const prior = this.sessions.get(id);
      let outcome: { session: SessionEntry; hint?: StyleHint; wrote: boolean } | undefined;
      await this.store.update(key, current => {
        const step = this.observeStep(key, current, prior, epoch, features, at);
        outcome = { session: step.session, hint: step.hint, wrote: step.profile !== current };
        return step.profile;
      });
      if (!outcome) return { stored: false };
      this.putSession(outcome.session);
      return outcome.hint ? { stored: outcome.wrote, hint: outcome.hint } : { stored: outcome.wrote };
    } catch {
      this.warn('store_error');
      return { stored: false };
    }
  }

  /** Pure given its inputs (the store may retry the transaction function). */
  private observeStep(
    key: StyleProfileKey, current: StyleProfile | null, prior: SessionEntry | undefined, epoch: number,
    features: StyleFeatures, at: number,
  ): { profile: StyleProfile; session: SessionEntry; hint?: StyleHint } {
    let profile: StyleProfile;
    let session = prior;
    if (!current || current.version !== STYLE_PROFILE_VERSION || current.epoch !== epoch || needsDeletion(current, at)) {
      profile = emptyProfile(key, epoch, at);
      session = undefined;
    } else {
      profile = current;
      if (session && sessionExpired(session.state, at)) {
        // Close the previous session: learn it only if it ended consistent.
        if (session.state.decision === 'consistent') profile = foldAll(profile, session.pending);
        session = undefined;
      }
      if (needsRebaseline(profile, at, epoch)) {
        profile = resetStatistics(profile, at);
        session = undefined;
      }
    }

    if (!session) {
      session = { key, state: startSequential(at), pending: [] };
      if (isScorable(profile)) profile = { ...profile, calibration: { ...profile.calibration, sessions: profile.calibration.sessions + 1 } };
    }
    const relaxed = relaxCalibration(profile.calibration, at);
    if (relaxed !== profile.calibration) profile = { ...profile, calibration: relaxed };

    const scorable = isScorable(profile);
    const llr = scorable ? messageLlr(profile, features, this.unknownClass) : 0;
    const state = stepSequential(session.state, llr, profile.calibration.threshold, at);
    let pending = session.pending;
    if (!scorable) {
      profile = foldFeatures(profile, features, at);
    } else if (state.decision === 'consistent') {
      pending = [...pending, { features, at }];
      while (pending.length > MIN_TEST_MESSAGES) {
        profile = foldFeatures(profile, pending[0].features, pending[0].at);
        pending = pending.slice(1);
      }
    } else {
      pending = [];
    }
    const hint: StyleHint | undefined = hintAllowed(profile, at)
      ? { source: 'style', consistency: state.decision, messages: state.n }
      : undefined;
    return { profile, session: { key, state, pending }, hint };
  }

  async enroll(input: {
    personId: string; space: 'work' | 'personal'; kind: 'style_baseline'; at: number; personalizationAllowed: boolean;
  }): Promise<{ enrolled: boolean; reason?: string }> {
    const parsed = enrollSchema.safeParse(input);
    const refuse = (reason: EnrollRefusal) => ({ enrolled: false, reason });
    if (!parsed.success) { this.warn('invalid_input'); return refuse('invalid_input'); }
    const { personId, space, at, personalizationAllowed } = parsed.data;
    try {
      const rows = await this.store.listPerson(personId, space);
      this.dropSessions(key => key.personId === personId && key.space === space);
      if (personalizationAllowed !== true) {
        for (const row of rows) await this.store.delete(row);
        return refuse('personalization_not_allowed');
      }
      for (const row of rows) {
        const key: StyleProfileKey = { personaId: row.personaId, personId: row.personId, space: row.space };
        await this.store.update(key, current => (current ? resetStatistics(current, at) : null));
      }
      return { enrolled: true };
    } catch {
      this.warn('store_error');
      return refuse('store_unavailable');
    }
  }

  assess(signals: IdentitySignals): IdentityAssessment {
    return assessIdentity(signals, this.weights);
  }

  /**
   * The answer to the one neutral question. 'confirmed_self' (a false prompt)
   * raises the threshold, mutes hints for 7 days and resumes learning;
   * 'someone_else' keeps the session uncertain and learns nothing from it.
   */
  async recordPromptOutcome(input: StyleProfileKey & { outcome: PromptOutcome; at: number; personalizationAllowed: boolean }): Promise<{ recorded: boolean }> {
    const parsed = outcomeSchema.safeParse(input);
    if (!parsed.success) { this.warn('invalid_input'); return { recorded: false }; }
    const { personaId, personId, space, outcome, at, personalizationAllowed } = parsed.data;
    const key: StyleProfileKey = { personaId, personId, space };
    const id = sessionKey(key);
    try {
      if (personalizationAllowed !== true) {
        this.sessions.delete(id);
        await this.store.delete(key);
        return { recorded: false };
      }
      const epoch = await this.epochOf(key);
      const prior = this.sessions.get(id);
      let recorded = false;
      let session: SessionEntry | undefined;
      await this.store.update(key, current => {
        recorded = false;
        session = prior;
        if (!current || current.epoch !== epoch || current.version !== STYLE_PROFILE_VERSION) return current;
        let profile: StyleProfile = { ...current, calibration: applyPromptOutcome(current.calibration, outcome, at) };
        if (prior) {
          if (outcome === 'confirmed_self') {
            profile = foldAll(profile, prior.pending);
            session = { key, state: { ...prior.state, s: 0, decision: 'consistent' }, pending: [] };
          } else {
            session = { key, state: { ...prior.state, decision: 'uncertain' }, pending: [] };
          }
        }
        recorded = true;
        return profile;
      });
      if (session) this.putSession(session);
      return { recorded };
    } catch {
      this.warn('store_error');
      return { recorded: false };
    }
  }

  /** Gini-of-per-user-error auto-disable over one persona. Returns counts only, never ids. */
  async recalibrate(personaId: string, at: number): Promise<{ gini: number; disabled: number }> {
    if (!idSchema.safeParse(personaId).success || !timeSchema.safeParse(at).success) {
      this.warn('invalid_input');
      return { gini: 0, disabled: 0 };
    }
    try {
      const rows = await this.store.listPersona(personaId);
      const byPerson = new Map<string, { sessions: number; falsePrompts: number; recentFalsePrompts: number }>();
      for (const row of rows) {
        const stat = byPerson.get(row.personId) ?? { sessions: 0, falsePrompts: 0, recentFalsePrompts: 0 };
        stat.sessions += row.calibration.sessions;
        stat.falsePrompts += row.calibration.falsePrompts;
        stat.recentFalsePrompts += row.calibration.falsePromptAt.filter(t => at - t < ABSOLUTE_WINDOW_MS).length;
        byPerson.set(row.personId, stat);
      }
      const stats: MemberErrorStat[] = [...byPerson].map(([personId, s]) => ({ personId, ...s }));
      const { gini, disable } = autoDisable(stats);
      const targets = new Set(disable);
      for (const row of rows) {
        if (!targets.has(row.personId) || row.calibration.disabled) continue;
        await this.store.update(row, current => (current && !current.calibration.disabled
          ? { ...current, calibration: { ...current.calibration, disabled: true } }
          : current));
      }
      return { gini, disabled: targets.size };
    } catch {
      this.warn('store_error');
      throw new Error('style_profile_store_unavailable');
    }
  }

  /** optional.personalization withdrawal: every persona and space of the person. */
  async forgetPerson(personId: string): Promise<number> {
    this.dropSessions(key => key.personId === personId);
    try {
      return await this.store.deletePerson(personId);
    } catch {
      this.warn('store_error');
      throw new Error('style_profile_store_unavailable');
    }
  }

  /** Privacy epoch bump: every row and session of the persona. */
  async purgePersona(personaId: string): Promise<number> {
    this.dropSessions(key => key.personaId === personaId);
    try {
      return await this.store.deletePersona(personaId);
    } catch {
      this.warn('store_error');
      throw new Error('style_profile_store_unavailable');
    }
  }
}
