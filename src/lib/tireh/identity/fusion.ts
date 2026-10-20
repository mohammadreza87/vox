/**
 * Log-odds fusion of identity evidence (docs/AGENT_INTELLIGENCE_SOLUTION.md 4.9).
 *
 * The transport-authenticated account is the prior. Voice and style are
 * evidence that can only LOWER it: every evidence weight is <= 0 and the
 * result is min(prior, prior + evidence). Structural caps:
 *   - a voice MATCH contributes 0 (it never raises anything);
 *   - style alone can move a session from consistent to uncertain, never to inconsistent;
 *   - hint.claimedPersonId and hint.speakerLabel are never read.
 */
import type { IdentityAssessment, IdentityLevel, IdentitySignals, SessionConsistency } from './types';
import { MIN_NET_SPEECH_MS } from './voice-band';
import { MIN_TEST_MESSAGES } from './test';

export interface FusionWeights {
  readonly priorAccount: number;
  readonly priorVerified: number;
  readonly voiceMatch: number;
  readonly voiceUncertain: number;
  readonly voiceNoMatch: number;
  readonly styleUncertain: number;
}

/** Uninformed defaults; tune only from a benchmark on consenting members. */
export const DEFAULT_FUSION_WEIGHTS: FusionWeights = Object.freeze({
  priorAccount: 4, priorVerified: 5, voiceMatch: 0, voiceUncertain: -2, voiceNoMatch: -4.5, styleUncertain: -3.5,
});

export const CONSISTENT_MIN_LOGODDS = 2;
export const INCONSISTENT_BELOW_LOGODDS = 0;

/** Throws RangeError unless every evidence weight is finite and <= 0 and both priors are finite and > CONSISTENT_MIN_LOGODDS. */
export function validateWeights(weights: FusionWeights): FusionWeights {
  if (!weights || typeof weights !== 'object') throw new RangeError('fusion_weights_invalid');
  for (const key of ['voiceMatch', 'voiceUncertain', 'voiceNoMatch', 'styleUncertain'] as const) {
    const w = weights[key];
    if (typeof w !== 'number' || !Number.isFinite(w) || w > 0) throw new RangeError(`fusion_weight_invalid:${key}`);
  }
  for (const key of ['priorAccount', 'priorVerified'] as const) {
    const w = weights[key];
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= CONSISTENT_MIN_LOGODDS) throw new RangeError(`fusion_weight_invalid:${key}`);
  }
  return Object.freeze({
    priorAccount: weights.priorAccount, priorVerified: weights.priorVerified, voiceMatch: weights.voiceMatch,
    voiceUncertain: weights.voiceUncertain, voiceNoMatch: weights.voiceNoMatch, styleUncertain: weights.styleUncertain,
  });
}

function assessment(level: IdentityLevel, session: SessionConsistency, logOdds: number, capped: boolean): IdentityAssessment {
  return Object.freeze({ level, session, logOdds, capped });
}

const INVALID = assessment('unverified', 'uncertain', 0, true);

function validAccountId(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function voiceEvidence(signals: IdentitySignals, weights: FusionWeights): number | undefined {
  const voice = signals.voice;
  if (!voice || typeof voice !== 'object') return;
  const hint = voice.hint, verification = voice.verification;
  if (!hint || hint.source !== 'voice_match' || !verification || typeof verification !== 'object') return;
  if (verification.band === 'NO_OPINION') return;
  const net = verification.netSpeechMs;
  if (typeof net !== 'number' || !Number.isFinite(net) || net < MIN_NET_SPEECH_MS) return;
  switch (verification.band) {
    case 'MATCH': return weights.voiceMatch;
    case 'UNCERTAIN': return weights.voiceUncertain;
    case 'NO_MATCH': return weights.voiceNoMatch;
    default: return;
  }
}

function styleEvidence(signals: IdentitySignals, weights: FusionWeights): number | undefined {
  const style = signals.style;
  if (!style || typeof style !== 'object' || style.source !== 'style') return;
  if (!Number.isInteger(style.messages) || style.messages < MIN_TEST_MESSAGES) return;
  // 'inconsistent' from style is treated exactly like 'uncertain'.
  if (style.consistency !== 'uncertain' && style.consistency !== 'inconsistent') return;
  return weights.styleUncertain;
}

/** Hints only ever lower: level <= (verifiedRecently ? 'verified' : 'account'). */
export function assessIdentity(signals: IdentitySignals, weights: FusionWeights = DEFAULT_FUSION_WEIGHTS): IdentityAssessment {
  const w = weights === DEFAULT_FUSION_WEIGHTS ? weights : validateWeights(weights);
  if (!signals || typeof signals !== 'object' || !validAccountId(signals.accountPersonId)) return INVALID;
  const base: IdentityLevel = signals.verifiedRecently === true ? 'verified' : 'account';
  const prior = base === 'verified' ? w.priorVerified : w.priorAccount;
  const voice = voiceEvidence(signals, w);
  const style = styleEvidence(signals, w);
  const evidence = (voice ?? 0) + (style ?? 0);
  let logOdds = Math.min(prior, prior + evidence);
  let session: SessionConsistency = logOdds >= CONSISTENT_MIN_LOGODDS ? 'consistent'
    : logOdds >= INCONSISTENT_BELOW_LOGODDS ? 'uncertain' : 'inconsistent';
  let capped = false;
  const voiceLowers = voice !== undefined && voice < 0;
  if (style !== undefined && !voiceLowers && session === 'inconsistent') {
    session = 'uncertain';
    logOdds = INCONSISTENT_BELOW_LOGODDS;
    capped = true;
  }
  const level: IdentityLevel = session === 'consistent' ? base : 'unverified';
  return assessment(level, session, logOdds, capped);
}
