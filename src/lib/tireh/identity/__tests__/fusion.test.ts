import { describe, expect, it } from 'vitest';
import type { IdentityHint } from '../../../adaptive/types';
import { fuseIdentity, LOG_ODDS_BOUND } from '../fusion';
import { IDENTITY_LEVEL_RANK, type IdentityLevel, type IdentitySignals, type SessionConsistency, type StyleHint } from '../types';
import type { VoiceVerification } from '../voice-band';

const FALLBACK = { level: 'unverified', session: 'uncertain', logOdds: 0, capped: true };
const matchHint: IdentityHint = { source: 'voice_match' };
const verification = (band: 'MATCH' | 'UNCERTAIN' | 'NO_MATCH'): VoiceVerification => ({ band, netSpeechMs: 6000, modelVersion: 'fake-1' });
const noOpinion: VoiceVerification = { band: 'NO_OPINION', reason: 'too_short' };

const VOICES: Record<string, IdentitySignals['voice'] | undefined> = {
  absent: undefined,
  MATCH: { hint: matchHint, verification: verification('MATCH') },
  UNCERTAIN: { hint: matchHint, verification: verification('UNCERTAIN') },
  NO_MATCH: { hint: matchHint, verification: verification('NO_MATCH') },
  NO_OPINION: { hint: matchHint, verification: noOpinion },
  MATCH_bob: { hint: { source: 'voice_match', claimedPersonId: 'bob', speakerLabel: 'bob' }, verification: verification('MATCH') },
  MATCH_model: { hint: { source: 'model_suggestion' }, verification: verification('MATCH') },
};

const style = (consistency: SessionConsistency, messages = 5): StyleHint => ({ source: 'style', consistency, messages });
const ceilingOf = (signals: IdentitySignals): IdentityLevel =>
  signals.accountPersonId.trim() === '' ? 'unverified' : signals.verifiedRecently ? 'verified' : 'account';

function table(): { name: string; signals: IdentitySignals }[] {
  const rows: { name: string; signals: IdentitySignals }[] = [];
  for (const verifiedRecently of [true, false]) {
    for (const accountPersonId of ['alice', '']) {
      for (const [voiceName, voice] of Object.entries(VOICES)) {
        const styles: (StyleHint | undefined)[] = [undefined];
        for (const c of ['consistent', 'uncertain', 'inconsistent'] as const) for (const m of [0, 4, 5, 10]) styles.push(style(c, m));
        for (const s of styles) {
          rows.push({
            name: `${verifiedRecently}/${accountPersonId || 'none'}/${voiceName}/${s ? `${s.consistency}:${s.messages}` : 'nostyle'}`,
            signals: { accountPersonId, verifiedRecently, ...(voice ? { voice } : {}), ...(s ? { style: s } : {}) },
          });
        }
      }
    }
  }
  return rows;
}

describe('identity fusion', () => {
  it('(a) never raises the level above the ceiling for any combination', () => {
    const rows = table();
    expect(rows.length).toBe(2 * 2 * 7 * 13);
    for (const { name, signals } of rows) {
      const result = fuseIdentity(signals);
      expect(IDENTITY_LEVEL_RANK[result.level], name).toBeLessThanOrEqual(IDENTITY_LEVEL_RANK[ceilingOf(signals)]);
      expect(Number.isFinite(result.logOdds), name).toBe(true);
      expect(Math.abs(result.logOdds), name).toBeLessThanOrEqual(LOG_ODDS_BOUND);
      expect(Object.keys(result).sort(), name).toEqual(['capped', 'level', 'logOdds', 'session']);
      expect(Object.isFrozen(result), name).toBe(true);
      expect(JSON.stringify(result), name).not.toContain('bob');
    }
  });

  it('(b) never yields an inconsistent session from style alone', () => {
    for (const { name, signals } of table()) {
      const voiceBand = signals.voice?.verification.band;
      if (voiceBand !== undefined && voiceBand !== 'NO_OPINION' && voiceBand !== 'MATCH') continue;
      expect(fuseIdentity(signals).session, name).not.toBe('inconsistent');
    }
  });

  it('(c) moves an account session from consistent to uncertain on an uncertain style', () => {
    expect(fuseIdentity({ accountPersonId: 'alice', verifiedRecently: false })).toMatchObject({ session: 'consistent', level: 'account' });
    expect(fuseIdentity({ accountPersonId: 'alice', verifiedRecently: false, style: style('uncertain', 5) }))
      .toMatchObject({ session: 'uncertain', level: 'unverified' });
  });

  it('(d) caps an inconsistent style at uncertain', () => {
    const result = fuseIdentity({ accountPersonId: 'alice', verifiedRecently: false, style: style('inconsistent', 10) });
    expect(result.session).toBe('uncertain');
    expect(result.level).toBe('unverified');
    const anonymous = fuseIdentity({ accountPersonId: '', verifiedRecently: false, style: style('inconsistent', 10) });
    expect(anonymous).toMatchObject({ session: 'uncertain', level: 'unverified', capped: true });
  });

  it('(e) cannot change a recently verified session through style alone', () => {
    for (const c of ['consistent', 'uncertain', 'inconsistent'] as const) {
      for (const voice of [VOICES.absent, VOICES.NO_OPINION]) {
        expect(fuseIdentity({ accountPersonId: 'alice', verifiedRecently: true, style: style(c, 10), ...(voice ? { voice } : {}) }))
          .toMatchObject({ session: 'consistent', level: 'verified' });
      }
    }
  });

  it('(f) treats style with fewer than 5 messages as absent', () => {
    for (const verifiedRecently of [true, false]) {
      for (const c of ['consistent', 'uncertain', 'inconsistent'] as const) {
        for (const m of [0, 4]) {
          expect(fuseIdentity({ accountPersonId: 'alice', verifiedRecently, style: style(c, m) }))
            .toEqual(fuseIdentity({ accountPersonId: 'alice', verifiedRecently }));
        }
      }
    }
  });

  it('(g) makes a voice NO_MATCH inconsistent and unverified', () => {
    expect(fuseIdentity({ accountPersonId: 'alice', verifiedRecently: false, voice: VOICES.NO_MATCH }))
      .toMatchObject({ session: 'inconsistent', level: 'unverified' });
  });

  it('(h) lets a voice MATCH confirm but never raise the account level', () => {
    expect(fuseIdentity({ accountPersonId: 'alice', verifiedRecently: false, voice: VOICES.MATCH }))
      .toMatchObject({ session: 'consistent', level: 'account', capped: true });
    for (const voice of [VOICES.MATCH_bob, VOICES.MATCH_model]) {
      const result = fuseIdentity({ accountPersonId: 'alice', verifiedRecently: false, voice });
      expect(result).toEqual(fuseIdentity({ accountPersonId: 'alice', verifiedRecently: false }));
    }
    expect(fuseIdentity({ accountPersonId: '', verifiedRecently: true, voice: VOICES.MATCH }).level).toBe('unverified');
  });

  it('(i) applies a NO_MATCH even when its hint is malformed', () => {
    const malformed = { hint: { source: 'model_suggestion', claimedPersonId: 'bob' } as IdentityHint, verification: verification('NO_MATCH') };
    expect(fuseIdentity({ accountPersonId: 'alice', verifiedRecently: false, voice: malformed }))
      .toMatchObject({ session: 'inconsistent', level: 'unverified' });
    const missing = { hint: null as unknown as IdentityHint, verification: verification('UNCERTAIN') };
    expect(fuseIdentity({ accountPersonId: 'alice', verifiedRecently: false, voice: missing }).level).toBe('unverified');
  });

  it('(j) returns the most conservative result for hostile input without throwing', () => {
    const throwing = Object.defineProperty({ verifiedRecently: false }, 'accountPersonId', { get() { throw new Error('boom'); } });
    const cases: unknown[] = [
      null, undefined, 42, 'alice', throwing,
      { accountPersonId: 'alice', verifiedRecently: false, style: { source: 'style', consistency: 'consistent', messages: Number.NaN } },
      { accountPersonId: 'alice', verifiedRecently: false, voice: { hint: matchHint, verification: { band: 'MAYBE' } } },
      { accountPersonId: 'alice', verifiedRecently: false, voice: null },
      { accountPersonId: 'alice', verifiedRecently: false, style: null },
      { accountPersonId: 'alice', verifiedRecently: false, style: { source: 'style', consistency: 'odd', messages: 5 } },
      { accountPersonId: 7, verifiedRecently: true },
    ];
    for (const input of cases) {
      expect(() => fuseIdentity(input as IdentitySignals)).not.toThrow();
      expect(fuseIdentity(input as IdentitySignals)).toEqual(FALLBACK);
    }
  });

  it('(k) never reads the speaker label', () => {
    const hint = Object.defineProperty({ source: 'voice_match' }, 'speakerLabel', { get() { throw new Error('read'); }, enumerable: true }) as IdentityHint;
    for (const band of ['MATCH', 'UNCERTAIN', 'NO_MATCH'] as const) {
      const result = fuseIdentity({ accountPersonId: 'alice', verifiedRecently: false, voice: { hint, verification: verification(band) } });
      expect(result).not.toEqual(FALLBACK);
    }
  });
});
