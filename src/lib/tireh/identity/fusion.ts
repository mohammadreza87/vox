/**
 * Log-odds fusion of identity evidence (S10L, docs/AGENT_INTELLIGENCE_SOLUTION.md section 4.9).
 *
 * The authenticated account is the prior and the ceiling: no hint can raise
 * the level above `verifiedRecently ? 'verified' : 'account'`. A voice band is
 * weighted evidence; a negative band always applies (fail toward disclosing
 * less) and a MATCH only for a well-formed voice_match hint about the account
 * person (never without an account). Style is weak evidence: alone it can move a session from consistent
 * to uncertain, never to inconsistent. The speaker label of a hint is never
 * read. Never throws; hostile input yields the most conservative result.
 */
import { MIN_SEQUENTIAL_MESSAGES } from './test';
import type { IdentityAssessment, IdentityLevel, IdentitySignals, SessionConsistency } from './types';

export const PRIOR_LOG_ODDS: Readonly<Record<IdentityLevel, number>> = Object.freeze({ verified: 6, account: 3, unverified: 0 });
export const VOICE_LOG_LR: Readonly<Record<'MATCH' | 'UNCERTAIN' | 'NO_MATCH', number>> = Object.freeze({ MATCH: 1, UNCERTAIN: -2.5, NO_MATCH: -6 });
export const STYLE_LOG_LR: Readonly<Record<SessionConsistency, number>> = Object.freeze({ consistent: 0, uncertain: -2, inconsistent: -3 });
export const STYLE_MAX_DROP = 3;
export const SESSION_CONSISTENT_MIN = 1.5;
export const SESSION_INCONSISTENT_MAX = -1.5;
export const LOG_ODDS_BOUND = 12;

const FALLBACK: IdentityAssessment = Object.freeze({ level: 'unverified', session: 'uncertain', logOdds: 0, capped: true });
const BANDS = new Set(['MATCH', 'UNCERTAIN', 'NO_MATCH', 'NO_OPINION']);
const CONSISTENCIES = new Set(['consistent', 'uncertain', 'inconsistent']);

class Hostile extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function oneBelow(level: IdentityLevel): IdentityLevel {
  return level === 'verified' ? 'account' : 'unverified';
}

function fuse(signals: IdentitySignals): IdentityAssessment {
  if (!isObject(signals)) throw new Hostile();
  const account: unknown = signals.accountPersonId;
  if (typeof account !== 'string') throw new Hostile();
  const ceiling: IdentityLevel = account.trim().length === 0 ? 'unverified'
    : signals.verifiedRecently === true ? 'verified' : 'account';
  let logOdds = PRIOR_LOG_ODDS[ceiling];
  let capped = false;
  let negativeVoice = false;

  const voice: unknown = signals.voice;
  if (voice !== undefined) {
    if (!isObject(voice) || !isObject(voice.verification)) throw new Hostile();
    const band: unknown = voice.verification.band;
    if (typeof band !== 'string' || !BANDS.has(band)) throw new Hostile();
    if (band === 'UNCERTAIN' || band === 'NO_MATCH') {
      // Negative evidence applies even when the hint is malformed: fail toward disclosing less.
      logOdds += VOICE_LOG_LR[band];
      negativeVoice = true;
    } else if (band === 'MATCH' && ceiling !== 'unverified') {
      const hint: unknown = voice.hint;
      if (isObject(hint) && hint.source === 'voice_match') {
        const claimed: unknown = hint.claimedPersonId;
        if (claimed === undefined || claimed === account) {
          logOdds += VOICE_LOG_LR.MATCH;
        }
      }
    }
  }

  const style: unknown = signals.style;
  if (style !== undefined) {
    if (!isObject(style)) throw new Hostile();
    const consistency: unknown = style.consistency;
    const messages: unknown = style.messages;
    if (style.source !== 'style' || typeof consistency !== 'string' || !CONSISTENCIES.has(consistency) ||
        typeof messages !== 'number' || !Number.isFinite(messages)) throw new Hostile();
    if (Number.isInteger(messages) && messages >= MIN_SEQUENTIAL_MESSAGES) {
      const raw = STYLE_LOG_LR[consistency as SessionConsistency];
      if (raw < -STYLE_MAX_DROP) capped = true;
      logOdds += Math.max(-STYLE_MAX_DROP, raw);
    }
  }

  logOdds = Math.min(LOG_ODDS_BOUND, Math.max(-LOG_ODDS_BOUND, logOdds));
  let session: SessionConsistency = logOdds >= SESSION_CONSISTENT_MIN ? 'consistent'
    : logOdds <= SESSION_INCONSISTENT_MAX ? 'inconsistent' : 'uncertain';
  if (!negativeVoice && session === 'inconsistent') {
    // Only negative voice evidence can make a session inconsistent: style
    // alone (even next to a positive MATCH) stops at uncertain.
    session = 'uncertain';
    capped = true;
  }
  const level: IdentityLevel = session === 'consistent' ? ceiling
    : session === 'uncertain' ? oneBelow(ceiling) : 'unverified';
  if (logOdds > PRIOR_LOG_ODDS[ceiling]) capped = true;
  const rounded = Math.round(logOdds * 1000) / 1000;
  return Object.freeze({ level, session, logOdds: Number.isFinite(rounded) ? rounded : 0, capped });
}

/** Fuses identity evidence; hints only ever lower the level. Never throws. */
export function fuseIdentity(signals: IdentitySignals): IdentityAssessment {
  try {
    return fuse(signals);
  } catch {
    return FALLBACK;
  }
}
