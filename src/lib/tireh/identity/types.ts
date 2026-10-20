/**
 * Identity confidence contract (docs/AGENT_INTELLIGENCE_SOLUTION.md 4.9, step S10L).
 *
 * Identity confidence is evidence that can only LOWER what the agent reveals.
 * Nothing here grants access, establishes identity or reaches the adaptive
 * policy: IdentityHint, StyleHint and IdentitySignals are deliberately kept out
 * of IdentityContext and AccessRequest (checked at compile time below).
 */
import type { AccessRequest, IdentityContext, IdentityHint } from '../../adaptive/types';
import type { VoiceNoteInput, VoiceVerification } from './voice-band';
import type { StyleFeatures } from './style-features';

export type { IdentityHint } from '../../adaptive/types';
export type { StyleFeatures } from './style-features';

export type IdentityLevel = 'verified' | 'account' | 'unverified';
export type SessionConsistency = 'consistent' | 'uncertain' | 'inconsistent';

/** Style alone can move a session from consistent to uncertain only. */
export interface StyleHint {
  readonly source: 'style';
  readonly consistency: SessionConsistency;
  readonly messages: number;
}

export interface IdentitySignals {
  readonly accountPersonId: string;
  readonly verifiedRecently: boolean;
  readonly voice?: {
    /** source 'voice_match'; claimedPersonId and speakerLabel are never read. */
    readonly hint: IdentityHint;
    readonly verification: VoiceVerification;
  };
  readonly style?: StyleHint;
}

export interface IdentityAssessment {
  readonly level: IdentityLevel;
  readonly session: SessionConsistency;
  readonly logOdds: number;
  readonly capped: boolean;
}

export interface IdentityService {
  verifyVoiceNote(input: VoiceNoteInput, signal?: AbortSignal): Promise<VoiceVerification>;
  observeStyle(input: {
    personaId: string; personId: string; space: 'work' | 'personal'; features: StyleFeatures; at: number;
    personalizationAllowed: boolean;
  }): Promise<{ stored: boolean; hint?: StyleHint }>;
  enroll(input: {
    personId: string; space: 'work' | 'personal'; kind: 'style_baseline'; at: number; personalizationAllowed: boolean;
  }): Promise<{ enrolled: boolean; reason?: string }>;
  /** Hints only lower: level <= (verifiedRecently ? 'verified' : 'account'). */
  assess(signals: IdentitySignals): IdentityAssessment;
}

export const IDENTITY_LEVEL_RANK: Readonly<Record<IdentityLevel, number>> = Object.freeze({
  unverified: 0, account: 1, verified: 2,
});

export const SESSION_RANK: Readonly<Record<SessionConsistency, number>> = Object.freeze({
  inconsistent: 0, uncertain: 1, consistent: 2,
});

/** The lower (less trusted) of two levels. */
export function lowerLevel(a: IdentityLevel, b: IdentityLevel): IdentityLevel {
  return IDENTITY_LEVEL_RANK[a] <= IDENTITY_LEVEL_RANK[b] ? a : b;
}

/** The lower (less consistent) of two session states. */
export function lowerSession(a: SessionConsistency, b: SessionConsistency): SessionConsistency {
  return SESSION_RANK[a] <= SESSION_RANK[b] ? a : b;
}

/** Values of enroll().reason. */
export type EnrollRefusal = 'personalization_not_allowed' | 'invalid_input' | 'store_unavailable';

/** Content-free and id-free: a code only. */
export interface IdentityLogEvent {
  readonly type: 'identity';
  readonly code: 'invalid_input' | 'store_error' | 'verifier_error' | 'verifier_timeout';
}

export interface IdentityLog {
  warn(event: IdentityLogEvent): void;
}

type Assert<T extends true> = T;
type Disjoint<A, B> = [Extract<keyof A, keyof B>] extends [never] ? true : false;

/**
 * Compile-time hint isolation: lib tsc fails if IdentityContext or AccessRequest
 * ever gains a key of IdentityHint, StyleHint or IdentitySignals.
 */
export type HintIsolationCheck = [
  Assert<Disjoint<IdentityContext, IdentityHint>>, Assert<Disjoint<AccessRequest, IdentityHint>>,
  Assert<Disjoint<IdentityContext, StyleHint>>, Assert<Disjoint<AccessRequest, IdentitySignals>>,
];
