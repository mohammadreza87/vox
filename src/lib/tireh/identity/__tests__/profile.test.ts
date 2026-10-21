import { describe, expect, it } from 'vitest';
import {
  ABSENCE_REBASELINE_MS, bernoulliP, CALIBRATION_RETENTION_MS, categoricalP, DAY_MS, decayFactor, emptyProfile, foldFeatures,
  gaussianParams, HALF_LIFE_MS, isScorable, MIN_PROFILE_MESSAGES, needsDeletion, needsRebaseline, resetStatistics,
  STYLE_PROFILE_TTL_MS, styleProfileSchema, VARIANCE_FLOOR, type StyleProfile,
} from '../profile';
import { defaultCalibration } from '../test';
import { FIXTURE_KEY, FIXTURE_T0, makeFeatures, personA, trainProfile } from './style-fixtures';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const T0 = FIXTURE_T0;
const empty = () => emptyProfile(FIXTURE_KEY, 0, T0);

describe('decay and half-life', () => {
  it('halves weight every 90 days', () => {
    expect(Math.abs(decayFactor(HALF_LIFE_MS) - 0.5)).toBeLessThan(1e-12);
    expect(HALF_LIFE_MS).toBe(90 * DAY_MS);
    expect(decayFactor(0)).toBe(1);
    expect(decayFactor(-5 * DAY_MS)).toBe(1);
    expect(decayFactor(Number.NaN)).toBe(1);
  });

  it('weights an observation 90 days old at one half', () => {
    let p = foldFeatures(empty(), makeFeatures({ text: { zwnjRate: 1 } }), T0);
    p = foldFeatures(p, makeFeatures({ text: { zwnjRate: 0 } }), T0 + HALF_LIFE_MS);
    expect(p.gaussian.zwnjRate.w).toBeCloseTo(1.5, 12);
    expect(Math.abs(p.gaussian.zwnjRate.mean - 1 / 3)).toBeLessThan(1e-9);
    // Weighted variance: 0.5 * (1 - 1/3)^2 + 1 * (0 - 1/3)^2, over w = 1.5.
    expect(p.gaussian.zwnjRate.m2 / p.gaussian.zwnjRate.w).toBeCloseTo((0.5 * (4 / 9) + 1 / 9) / 1.5, 9);
  });

  it('keeps categorical counts summing to the weight', () => {
    const p = trainProfile(personA(5, 120));
    for (const stat of Object.values(p.categorical)) {
      expect(stat.counts.reduce((a, b) => a + b, 0)).toBeCloseTo(stat.w, 9);
    }
  });
});

describe('warm-up', () => {
  it('scores only from 50 messages', () => {
    const stream = personA(7, MIN_PROFILE_MESSAGES);
    expect(isScorable(trainProfile(stream.slice(0, 49)))).toBe(false);
    expect(isScorable(trainProfile(stream))).toBe(true);
    expect(MIN_PROFILE_MESSAGES).toBe(50);
  });
});

describe('modality-specific keys', () => {
  it('does not move text-only keys on voice messages or voice duration on text', () => {
    const base = trainProfile(personA(9, 30));
    const at = base.lastAt;
    const afterVoice = foldFeatures(base, makeFeatures({ modality: 'voice', voiceDurationBucket: 2 }), at);
    expect(afterVoice.gaussian).toEqual(base.gaussian);
    expect(afterVoice.categorical.lengthBucket).toEqual(base.categorical.lengthBucket);
    expect(afterVoice.categorical.digitScript).toEqual(base.categorical.digitScript);
    expect(afterVoice.bernoulli.terminalPunctuation).toEqual(base.bernoulli.terminalPunctuation);
    expect(afterVoice.categorical.voiceDurationBucket).not.toEqual(base.categorical.voiceDurationBucket);

    const afterText = foldFeatures(base, makeFeatures({ text: { zwnjRate: 0.5 } }), at);
    expect(afterText.categorical.voiceDurationBucket).toEqual(base.categorical.voiceDurationBucket);
    expect(afterText.gaussian.zwnjRate).not.toEqual(base.gaussian.zwnjRate);

    // Later in time untouched keys only decay: their means and distributions stay put.
    const later = foldFeatures(base, makeFeatures({ modality: 'voice' }), at + 10 * DAY_MS);
    expect(later.gaussian.zwnjRate.mean).toBe(base.gaussian.zwnjRate.mean);
    expect(gaussianParams(later.gaussian.zwnjRate).variance).toBeCloseTo(gaussianParams(base.gaussian.zwnjRate).variance, 12);
    expect(later.bernoulli.terminalPunctuation.p).toBe(base.bernoulli.terminalPunctuation.p);
  });
});

describe('re-baseline and retention', () => {
  it('needs a re-baseline on epoch, version or 7 days of absence', () => {
    const p = trainProfile(personA(11, 60));
    expect(needsRebaseline(p, p.lastAt + DAY_MS, 0)).toBe(false);
    expect(needsRebaseline(p, p.lastAt + DAY_MS, 1)).toBe(true);
    expect(needsRebaseline({ ...p, version: 2 } as unknown as StyleProfile, p.lastAt, 0)).toBe(true);
    expect(needsRebaseline(p, p.lastAt + ABSENCE_REBASELINE_MS - 1, 0)).toBe(false);
    expect(needsRebaseline(p, p.lastAt + ABSENCE_REBASELINE_MS, 0)).toBe(true);
    expect(ABSENCE_REBASELINE_MS).toBe(7 * DAY_MS);
    expect(p.expiresAt).toBe(p.lastAt + STYLE_PROFILE_TTL_MS);
  });

  it('resets statistics but keeps the calibration', () => {
    const p = trainProfile(personA(13, 60));
    const calibrated = { ...p, calibration: { ...p.calibration, threshold: 8, falsePrompts: 2 } };
    const reset = resetStatistics(calibrated, p.lastAt + 8 * DAY_MS);
    expect(reset.messages).toBe(0);
    expect(reset.calibration).toEqual(calibrated.calibration);
    expect(reset.baselineAt).toBe(p.lastAt + 8 * DAY_MS);
    expect(reset.gaussian).toEqual(empty().gaussian);
    expect(reset.categorical).toEqual(empty().categorical);
    expect(reset.lastAt).toBe(p.lastAt);
    // With no statistics left, the next sweeper action is deletion.
    expect(reset.expiresAt).toBe(p.lastAt + CALIBRATION_RETENTION_MS);
  });

  it('deletes rows 90 days after the last activity', () => {
    const p = trainProfile(personA(15, 10));
    expect(needsDeletion(p, p.lastAt + CALIBRATION_RETENTION_MS - 1)).toBe(false);
    expect(needsDeletion(p, p.lastAt + CALIBRATION_RETENTION_MS)).toBe(true);
  });

  it('starts empty profiles with the default calibration', () => {
    expect(empty().calibration).toEqual(defaultCalibration(T0));
    expect(empty().purpose).toBe('optional.personalization');
    expect(empty().version).toBe(1);
  });
});

describe('probabilities', () => {
  it('floors the Gaussian variance', () => {
    let p = empty();
    for (let i = 0; i < 100; i++) p = foldFeatures(p, makeFeatures({ text: { zwnjRate: 0.3 } }), T0 + i);
    expect(gaussianParams(p.gaussian.zwnjRate).variance).toBe(VARIANCE_FLOOR);
    expect(gaussianParams(empty().gaussian.zwnjRate).variance).toBe(VARIANCE_FLOOR);
  });

  it('smooths Bernoulli and categorical estimates', () => {
    expect(bernoulliP({ w: 0, p: 0 })).toBe(0.5);
    expect(bernoulliP({ w: 1000, p: 1 })).toBe(0.98);
    expect(bernoulliP({ w: 1000, p: 0 })).toBe(0.02);
    expect(categoricalP({ w: 0, counts: [0, 0, 0, 0] }, 2)).toBe(0.25);
    expect(categoricalP({ w: 2, counts: [2, 0, 0, 0] }, 0)).toBe(0.5);
  });
});

describe('styleProfileSchema', () => {
  const valid = trainProfile(personA(17, 20));

  it('accepts trained profiles', () => {
    expect(styleProfileSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects extra keys at every level and non-finite numbers', () => {
    const cases: unknown[] = [
      { ...valid, text: 'secret' },
      { ...valid, gaussian: { ...valid.gaussian, zwnjRate: { ...valid.gaussian.zwnjRate, sample: 'secret' } } },
      { ...valid, bernoulli: { ...valid.bernoulli, extra: { w: 1, p: 0.5 } } },
      { ...valid, calibration: { ...valid.calibration, note: 'secret' } },
      { ...valid, messages: Number.NaN },
      { ...valid, lastAt: Number.POSITIVE_INFINITY },
      { ...valid, gaussian: { ...valid.gaussian, zwnjRate: { ...valid.gaussian.zwnjRate, mean: Number.NaN } } },
      { ...valid, categorical: { ...valid.categorical, hourBucket: { w: 1, counts: [1, 0] } } },
      { ...valid, personId: '' },
      { ...valid, personId: 'x'.repeat(201) },
      { ...valid, purpose: 'core.conversation' },
    ];
    for (const value of cases) expect(styleProfileSchema.safeParse(value).success).toBe(false);
  });
});

describe('purity', () => {
  it('never mutates its input', () => {
    const frozen = deepFreeze(trainProfile(personA(19, 20)));
    const snapshot = JSON.stringify(frozen);
    expect(() => foldFeatures(frozen, makeFeatures({ text: { zwnjRate: 0.5 } }), frozen.lastAt + DAY_MS)).not.toThrow();
    expect(() => foldFeatures(frozen, makeFeatures({ modality: 'voice' }), frozen.lastAt + DAY_MS)).not.toThrow();
    expect(() => resetStatistics(frozen, frozen.lastAt)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });
});
