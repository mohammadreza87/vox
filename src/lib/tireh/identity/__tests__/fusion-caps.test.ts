import { describe, expect, it } from 'vitest';
import { assessIdentity, DEFAULT_FUSION_WEIGHTS, validateWeights, type FusionWeights } from '../fusion';
import { IDENTITY_LEVEL_RANK, lowerLevel, lowerSession, SESSION_RANK, type IdentitySignals, type StyleHint } from '../types';
import type { VoiceNoOpinionReason } from '../voice-band';

type Voice = NonNullable<IdentitySignals['voice']>;
const voice = (verification: Voice['verification'], source: Voice['hint']['source'] = 'voice_match'): Voice =>
  ({ hint: { source }, verification });
const band = (b: 'MATCH' | 'UNCERTAIN' | 'NO_MATCH', netSpeechMs = 5_000): Voice['verification'] => ({ band: b, netSpeechMs, modelVersion: 'fake-1' });
const REASONS: VoiceNoOpinionReason[] = ['disabled', 'not_enrolled', 'consent_missing', 'guest_or_group', 'too_short', 'self_echo', 'provider_error', 'timeout'];

const VOICES: Record<string, Voice | undefined> = {
  absent: undefined,
  match: voice(band('MATCH')),
  uncertain: voice(band('UNCERTAIN')),
  noMatch: voice(band('NO_MATCH')),
  ...Object.fromEntries(REASONS.map(r => [`noOpinion_${r}`, voice({ band: 'NO_OPINION', reason: r, netSpeechMs: 9_000 })])),
  matchShort: voice(band('MATCH', 2_999)),
  noMatchShort: voice(band('NO_MATCH', 2_999)),
  uncertainShort: voice(band('UNCERTAIN', 2_999)),
  noMatchSpeakerLabel: voice(band('NO_MATCH'), 'speaker_label'),
  noMatchModelSuggestion: voice(band('NO_MATCH'), 'model_suggestion'),
};
const style = (consistency: StyleHint['consistency'], messages = 10): StyleHint => ({ source: 'style', consistency, messages });
const STYLES: Record<string, StyleHint | undefined> = {
  absent: undefined,
  consistent: style('consistent'),
  uncertain: style('uncertain'),
  inconsistent: style('inconsistent'),
  uncertainFew: style('uncertain', 4),
};
const NO_EFFECT_VOICES = ['absent', 'match', ...REASONS.map(r => `noOpinion_${r}`), 'matchShort', 'noMatchShort', 'uncertainShort', 'noMatchSpeakerLabel', 'noMatchModelSuggestion'];

function signals(verifiedRecently: boolean, v?: Voice, s?: StyleHint): IdentitySignals {
  return { accountPersonId: 'member-a', verifiedRecently, ...(v ? { voice: v } : {}), ...(s ? { style: s } : {}) };
}

const combos = [true, false].flatMap(verified =>
  Object.entries(VOICES).flatMap(([vName, v]) => Object.entries(STYLES).map(([sName, s]) => ({ verified, vName, v, sName, s }))));

describe('fusion caps (exhaustive)', () => {
  it('covers the whole product', () => {
    expect(combos).toHaveLength(2 * Object.keys(VOICES).length * Object.keys(STYLES).length);
  });

  it('never raises the level above the base and never raises log-odds above the prior', () => {
    for (const c of combos) {
      const a = assessIdentity(signals(c.verified, c.v, c.s));
      const base = c.verified ? 'verified' : 'account';
      expect(IDENTITY_LEVEL_RANK[a.level]).toBeLessThanOrEqual(IDENTITY_LEVEL_RANK[base]);
      expect(a.logOdds).toBeLessThanOrEqual(c.verified ? DEFAULT_FUSION_WEIGHTS.priorVerified : DEFAULT_FUSION_WEIGHTS.priorAccount);
    }
  });

  it('is monotonic: adding a signal never raises level, session or log-odds', () => {
    for (const c of combos) {
      const full = assessIdentity(signals(c.verified, c.v, c.s));
      for (const without of [signals(c.verified, undefined, c.s), signals(c.verified, c.v, undefined), signals(c.verified)]) {
        const less = assessIdentity(without);
        expect(IDENTITY_LEVEL_RANK[full.level]).toBeLessThanOrEqual(IDENTITY_LEVEL_RANK[less.level]);
        expect(SESSION_RANK[full.session]).toBeLessThanOrEqual(SESSION_RANK[less.session]);
        expect(full.logOdds).toBeLessThanOrEqual(less.logOdds);
      }
    }
  });

  it('never lets style alone reach inconsistent, and treats inconsistent style like uncertain', () => {
    for (const verified of [true, false]) {
      for (const [, s] of Object.entries(STYLES)) {
        expect(assessIdentity(signals(verified, undefined, s)).session).not.toBe('inconsistent');
        for (const v of NO_EFFECT_VOICES.map(n => VOICES[n])) {
          expect(assessIdentity(signals(verified, v, s)).session).not.toBe('inconsistent');
        }
      }
      for (const [, v] of Object.entries(VOICES)) {
        expect(assessIdentity(signals(verified, v, style('inconsistent')))).toEqual(assessIdentity(signals(verified, v, style('uncertain'))));
      }
    }
  });

  it('ignores short, non-voice-match, no-opinion and too-few-message evidence', () => {
    for (const verified of [true, false]) {
      const none = assessIdentity(signals(verified));
      for (const name of NO_EFFECT_VOICES) expect(assessIdentity(signals(verified, VOICES[name]))).toEqual(none);
      expect(assessIdentity(signals(verified, undefined, STYLES.uncertainFew))).toEqual(none);
      expect(assessIdentity(signals(verified, undefined, STYLES.consistent))).toEqual(none);
      expect(assessIdentity(signals(verified, undefined, { ...style('uncertain'), messages: 5.5 }))).toEqual(none);
    }
  });

  it('never reads claimedPersonId or speakerLabel', () => {
    for (const c of combos) {
      if (!c.v) continue;
      const baseline = assessIdentity(signals(c.verified, c.v, c.s));
      for (const hint of [{ claimedPersonId: 'someone-else' }, { claimedPersonId: 'member-a' }, { speakerLabel: 'Speaker 2' }, { claimedPersonId: 'x', speakerLabel: 'y' }]) {
        const polluted: Voice = { ...c.v, hint: { ...c.v.hint, ...hint } };
        expect(assessIdentity(signals(c.verified, polluted, c.s))).toEqual(baseline);
      }
    }
  });

  it('gives the documented defaults', () => {
    expect(assessIdentity(signals(false, undefined, style('uncertain')))).toEqual({ level: 'unverified', session: 'uncertain', logOdds: 0.5, capped: false });
    expect(assessIdentity(signals(true, undefined, style('uncertain')))).toEqual({ level: 'unverified', session: 'uncertain', logOdds: 1.5, capped: false });
    expect(assessIdentity(signals(false, VOICES.noMatch))).toMatchObject({ level: 'unverified', session: 'inconsistent', logOdds: -0.5 });
    expect(assessIdentity(signals(false, VOICES.uncertain))).toMatchObject({ level: 'account', session: 'consistent', logOdds: 2 });
    expect(assessIdentity(signals(false))).toEqual({ level: 'account', session: 'consistent', logOdds: 4, capped: false });
    expect(assessIdentity(signals(true))).toEqual({ level: 'verified', session: 'consistent', logOdds: 5, capped: false });
    expect(assessIdentity(signals(false, VOICES.match))).toEqual(assessIdentity(signals(false)));
  });

  it('caps style-only evidence even with extreme weights', () => {
    const weights: FusionWeights = { ...DEFAULT_FUSION_WEIGHTS, styleUncertain: -100 };
    for (const verified of [true, false]) {
      const a = assessIdentity(signals(verified, undefined, style('uncertain')), weights);
      expect(a.session).toBe('uncertain');
      expect(a.level).toBe('unverified');
      expect(a.capped).toBe(true);
      expect(assessIdentity(signals(verified, VOICES.match, style('uncertain')), weights).session).toBe('uncertain');
      expect(assessIdentity(signals(verified, VOICES.uncertain, style('uncertain')), weights).session).toBe('inconsistent');
    }
  });

  it('validates weights', () => {
    for (const bad of [
      { voiceMatch: 0.1 }, { styleUncertain: 1 }, { voiceNoMatch: Number.NaN }, { voiceUncertain: Number.NEGATIVE_INFINITY },
      { priorAccount: 2 }, { priorAccount: 1 }, { priorVerified: Number.NaN },
    ]) {
      expect(() => validateWeights({ ...DEFAULT_FUSION_WEIGHTS, ...bad })).toThrow(RangeError);
      expect(() => assessIdentity(signals(false), { ...DEFAULT_FUSION_WEIGHTS, ...bad })).toThrow(RangeError);
    }
    expect(validateWeights(DEFAULT_FUSION_WEIGHTS)).toEqual(DEFAULT_FUSION_WEIGHTS);
  });

  it('returns frozen objects with exactly four keys', () => {
    for (const c of combos) {
      const a = assessIdentity(signals(c.verified, c.v, c.s));
      expect(Object.keys(a).sort()).toEqual(['capped', 'level', 'logOdds', 'session']);
      expect(Object.isFrozen(a)).toBe(true);
    }
  });

  it('gives unverified for an empty or invalid account person', () => {
    for (const accountPersonId of ['', '   ', 'x'.repeat(201), undefined as unknown as string, 42 as unknown as string]) {
      expect(assessIdentity({ accountPersonId, verifiedRecently: true })).toEqual({ level: 'unverified', session: 'uncertain', logOdds: 0, capped: true });
    }
    expect(assessIdentity(null as unknown as IdentitySignals).level).toBe('unverified');
    expect(assessIdentity({ accountPersonId: 'member-a', verifiedRecently: 'yes' as unknown as boolean }).level).toBe('account');
  });
});

describe('rank helpers', () => {
  it('returns the lower of two', () => {
    expect(lowerLevel('verified', 'account')).toBe('account');
    expect(lowerLevel('unverified', 'verified')).toBe('unverified');
    expect(lowerSession('consistent', 'uncertain')).toBe('uncertain');
    expect(lowerSession('inconsistent', 'uncertain')).toBe('inconsistent');
    expect(Object.isFrozen(IDENTITY_LEVEL_RANK) && Object.isFrozen(SESSION_RANK)).toBe(true);
  });
});
