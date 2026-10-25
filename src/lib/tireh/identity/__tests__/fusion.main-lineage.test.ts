/**
 * Main-lineage fusion cases (S10L, earlier run 83848b7, fusion-caps.test.ts)
 * ported onto the chosen wave A implementation (aiq/identity-lib b34b7c0).
 * API rename: assessIdentity -> fuseIdentity (wave A has no weights argument).
 * Only assertions whose intent holds against wave A are kept; the rest are
 * listed by case name in
 * docs/implementation/agent-intelligence/WAVE_A_MAIN_INTEGRATION.md.
 */
import { describe, expect, it } from 'vitest';
import { fuseIdentity } from '../fusion';
import { IDENTITY_LEVEL_RANK, type IdentitySignals, type SessionConsistency, type StyleHint } from '../types';
import type { VoiceNoOpinionReason } from '../voice-band';

const SESSION_RANK: Readonly<Record<SessionConsistency, number>> = { inconsistent: 0, uncertain: 1, consistent: 2 };

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
/** Voices that never lower the level in wave A (absent, no opinion, a MATCH). */
const NON_NEGATIVE_VOICES = ['absent', 'match', 'matchShort', ...REASONS.map(r => `noOpinion_${r}`)];

function signals(verifiedRecently: boolean, v?: Voice, s?: StyleHint): IdentitySignals {
  return { accountPersonId: 'member-a', verifiedRecently, ...(v ? { voice: v } : {}), ...(s ? { style: s } : {}) };
}

const combos = [true, false].flatMap(verified =>
  Object.entries(VOICES).flatMap(([vName, v]) => Object.entries(STYLES).map(([sName, s]) => ({ verified, vName, v, sName, s }))));

describe('main-lineage: fusion caps (exhaustive)', () => {
  it('covers the whole product', () => {
    expect(combos).toHaveLength(2 * Object.keys(VOICES).length * Object.keys(STYLES).length);
  });

  it('never raises the level above the base', () => {
    for (const c of combos) {
      const a = fuseIdentity(signals(c.verified, c.v, c.s));
      const base = c.verified ? 'verified' : 'account';
      expect(IDENTITY_LEVEL_RANK[a.level]).toBeLessThanOrEqual(IDENTITY_LEVEL_RANK[base]);
    }
  });

  it('is monotonic: adding a signal other than a voice MATCH never raises level, session or log-odds', () => {
    for (const c of combos) {
      if (c.v?.verification.band === 'MATCH') continue;
      const full = fuseIdentity(signals(c.verified, c.v, c.s));
      for (const without of [signals(c.verified, undefined, c.s), signals(c.verified, c.v, undefined), signals(c.verified)]) {
        const less = fuseIdentity(without);
        expect(IDENTITY_LEVEL_RANK[full.level]).toBeLessThanOrEqual(IDENTITY_LEVEL_RANK[less.level]);
        expect(SESSION_RANK[full.session]).toBeLessThanOrEqual(SESSION_RANK[less.session]);
        expect(full.logOdds).toBeLessThanOrEqual(less.logOdds);
      }
    }
  });

  it('never lets style alone reach inconsistent', () => {
    for (const verified of [true, false]) {
      for (const [, s] of Object.entries(STYLES)) {
        expect(fuseIdentity(signals(verified, undefined, s)).session).not.toBe('inconsistent');
        for (const v of NON_NEGATIVE_VOICES.map(n => VOICES[n])) {
          expect(fuseIdentity(signals(verified, v, s)).session).not.toBe('inconsistent');
        }
      }
    }
  });

  it('ignores no-opinion and too-few-message evidence', () => {
    for (const verified of [true, false]) {
      const none = fuseIdentity(signals(verified));
      for (const reason of REASONS) expect(fuseIdentity(signals(verified, VOICES[`noOpinion_${reason}`]))).toEqual(none);
      expect(fuseIdentity(signals(verified, undefined, STYLES.uncertainFew))).toEqual(none);
      expect(fuseIdentity(signals(verified, undefined, STYLES.consistent))).toEqual(none);
      expect(fuseIdentity(signals(verified, undefined, { ...style('uncertain'), messages: 5.5 }))).toEqual(none);
    }
  });

  it('never reads speakerLabel, and claimedPersonId never changes a negative band', () => {
    for (const c of combos) {
      if (!c.v) continue;
      const baseline = fuseIdentity(signals(c.verified, c.v, c.s));
      const pollution = c.v.verification.band === 'MATCH'
        ? [{ speakerLabel: 'Speaker 2' }]
        : [{ claimedPersonId: 'someone-else' }, { claimedPersonId: 'member-a' }, { speakerLabel: 'Speaker 2' }, { claimedPersonId: 'x', speakerLabel: 'y' }];
      for (const hint of pollution) {
        const polluted: Voice = { ...c.v, hint: { ...c.v.hint, ...hint } };
        expect(fuseIdentity(signals(c.verified, polluted, c.s))).toEqual(baseline);
      }
    }
  });

  it('returns frozen objects with exactly four keys', () => {
    for (const c of combos) {
      const a = fuseIdentity(signals(c.verified, c.v, c.s));
      expect(Object.keys(a).sort()).toEqual(['capped', 'level', 'logOdds', 'session']);
      expect(Object.isFrozen(a)).toBe(true);
    }
  });

  it('gives unverified for an empty or invalid account person', () => {
    for (const accountPersonId of ['', '   ']) {
      expect(fuseIdentity({ accountPersonId, verifiedRecently: true }).level).toBe('unverified');
    }
    for (const accountPersonId of [undefined as unknown as string, 42 as unknown as string]) {
      expect(fuseIdentity({ accountPersonId, verifiedRecently: true })).toEqual({ level: 'unverified', session: 'uncertain', logOdds: 0, capped: true });
    }
    expect(fuseIdentity(null as unknown as IdentitySignals).level).toBe('unverified');
    expect(fuseIdentity({ accountPersonId: 'member-a', verifiedRecently: 'yes' as unknown as boolean }).level).toBe('account');
  });
});

describe('main-lineage: rank helpers', () => {
  it('keeps the level rank frozen and ordered', () => {
    expect(Object.isFrozen(IDENTITY_LEVEL_RANK)).toBe(true);
    expect(IDENTITY_LEVEL_RANK.unverified).toBeLessThan(IDENTITY_LEVEL_RANK.account);
    expect(IDENTITY_LEVEL_RANK.account).toBeLessThan(IDENTITY_LEVEL_RANK.verified);
  });
});
