/**
 * Main-lineage profile cases (S10L, earlier run 83848b7, profile.test.ts)
 * ported onto the chosen wave A implementation (aiq/identity-lib b34b7c0).
 * API renames: emptyProfile(key, epoch, at) -> newProfile(personId, space,
 * epoch, at), foldFeatures(profile, features, at) -> observeProfile(profile,
 * styleVector(features), at), isScorable -> profileReady. Main's categorical,
 * Bernoulli and calibration statistics do not exist in wave A; those cases are
 * listed in docs/implementation/agent-intelligence/WAVE_A_MAIN_INTEGRATION.md.
 */
import { describe, expect, it } from 'vitest';
import {
  DAY_MS, decayFactor, HALF_LIFE_MS, MIN_PROFILE_MESSAGES, newProfile, observeProfile, profileReady, styleProfileSchema,
  type StyleProfile,
} from '../profile';
import { extractStyleFeatures, styleVector } from '../style-features';

const T0 = Date.UTC(2026, 9, 1, 18, 0);
const vectorAt = (at: number, text = 'salam, chetori? :)') => styleVector(extractStyleFeatures({ kind: 'text', text, edited: false, at }));

function trained(messages: number): StyleProfile {
  let p = newProfile('member-a', 'work', 0, T0);
  for (let i = 0; i < messages; i++) p = observeProfile(p, vectorAt(T0 + i * 60_000, i % 2 ? 'Hello there!' : 'سلام، خوبی؟'), T0 + i * 60_000);
  return p;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('main-lineage: decay and half-life', () => {
  it('halves weight every 90 days', () => {
    expect(Math.abs(decayFactor(HALF_LIFE_MS) - 0.5)).toBeLessThan(1e-12);
    expect(HALF_LIFE_MS).toBe(90 * DAY_MS);
    expect(decayFactor(0)).toBe(1);
    expect(decayFactor(-5 * DAY_MS)).toBe(1);
    expect(decayFactor(Number.NaN)).toBe(1);
  });
});

describe('main-lineage: warm-up', () => {
  it('scores only from 50 messages', () => {
    expect(profileReady(trained(MIN_PROFILE_MESSAGES - 1))).toBe(false);
    expect(profileReady(trained(MIN_PROFILE_MESSAGES))).toBe(true);
    expect(MIN_PROFILE_MESSAGES).toBe(50);
  });
});

describe('main-lineage: styleProfileSchema', () => {
  const valid = trained(20);

  it('accepts trained profiles', () => {
    expect(styleProfileSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects extra keys and non-finite numbers', () => {
    const cases: unknown[] = [
      { ...valid, text: 'secret' },
      { ...valid, messages: Number.NaN },
      { ...valid, lastObservedAt: Number.POSITIVE_INFINITY },
      { ...valid, mean: valid.mean.map((x, i) => (i === 0 ? Number.NaN : x)) },
      { ...valid, personId: '' },
      { ...valid, personId: 'x'.repeat(201) },
      { ...valid, purpose: 'core.conversation' },
    ];
    for (const value of cases) expect(styleProfileSchema.safeParse(value).success).toBe(false);
  });
});

describe('main-lineage: purity', () => {
  it('never mutates its input', () => {
    const frozen = deepFreeze(trained(20));
    const snapshot = JSON.stringify(frozen);
    const later = frozen.lastObservedAt! + DAY_MS;
    expect(() => observeProfile(frozen, vectorAt(later), later)).not.toThrow();
    expect(() => observeProfile(frozen, styleVector(extractStyleFeatures({ kind: 'voice', edited: false, at: later, durationSec: 9 })), later)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});
