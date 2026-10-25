import { describe, expect, it } from 'vitest';
import { IdentityConfidenceService } from '../index';
import { DAY_MS, newProfile, observeProfile, UNKNOWN_MODEL, WEEK_MS, type GaussianModel } from '../profile';
import { STYLE_VECTOR_DIM, styleVector } from '../style-features';
import { InMemoryStyleProfileStore } from '../store';
import {
  DEFAULT_LOWER_THRESHOLD, evaluateFairness, gini, INITIAL_SEQUENTIAL_STATE, MAX_DIM_LLR, MAX_MESSAGE_LLR, messageLlr,
  MIN_SEQUENTIAL_MESSAGES, personThreshold, quantile, stepSequential, type SequentialState,
} from '../test';
import { impostorFeatures, mulberry32, ownerFeatures, simulateWeeks } from './style-fixtures';

const T0 = Date.UTC(2026, 0, 5, 18, 0);
const fill = (value: number): number[] => Array.from({ length: STYLE_VECTOR_DIM }, () => value);
const sharp = (mean: number, weight = 100): GaussianModel => ({ mean: fill(mean), variance: fill(0.0025), weight: fill(weight) });

function run(llrs: readonly number[], lower = -10): { state: SequentialState; decisions: (string | null)[] } {
  let state = INITIAL_SEQUENTIAL_STATE;
  const decisions: (string | null)[] = [];
  for (const llr of llrs) {
    const step = stepSequential(state, llr, { lower });
    state = step.state;
    decisions.push(step.decision);
  }
  return { state, decisions };
}

describe('sequential test', () => {
  it('(a) never decides before 5 messages', () => {
    for (const llr of [-100, -4, 0, 4, 100]) {
      const { decisions } = run([llr, llr, llr, llr]);
      expect(decisions).toEqual([null, null, null, null]);
    }
    expect(run([-4, -4, -4, -4, -4]).decisions[4]).not.toBeNull();
    expect(MIN_SEQUENTIAL_MESSAGES).toBe(5);
  });

  it('(b) clamps each dim to ±2 and each message to ±4, skipping unlearned dims', () => {
    const far = fill(1);
    expect(messageLlr(sharp(0), UNKNOWN_MODEL, far)).toBe(-MAX_MESSAGE_LLR);
    expect(messageLlr(sharp(0.5), UNKNOWN_MODEL, fill(0.5))).toBe(MAX_MESSAGE_LLR);
    const single = Array.from({ length: STYLE_VECTOR_DIM }, (_, d) => (d === 1 ? 1 : null));
    expect(messageLlr(sharp(0), UNKNOWN_MODEL, single)).toBe(-MAX_DIM_LLR);
    expect(messageLlr(sharp(0, 4.9), UNKNOWN_MODEL, far)).toBe(0);
    const mixed = { ...sharp(0), weight: fill(0).map((_, d) => (d === 1 ? 100 : 0)) };
    expect(messageLlr(mixed, UNKNOWN_MODEL, far)).toBe(-MAX_DIM_LLR);
    expect(messageLlr(sharp(0), UNKNOWN_MODEL, fill(Number.NaN))).toBe(0);
  });

  it('(c) scores an uninformed sender against an explicit unknown class', () => {
    expect(messageLlr(sharp(0.1), UNKNOWN_MODEL, UNKNOWN_MODEL.mean)).toBeLessThan(0);
    expect(messageLlr(sharp(0.1), UNKNOWN_MODEL, fill(0.1))).toBeGreaterThan(0);
  });

  it('(d) keeps a downgrade for the rest of the session', () => {
    const { state, decisions } = run([-4, -4, -4, -4, -4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
    expect(decisions[4]).toBe('inconsistent');
    expect(decisions.slice(5).every(d => d === 'inconsistent')).toBe(true);
    expect(state.flagged).toBe('inconsistent');
    const mild = run([-2.5, -2.5, -2.5, -2.5, -2.5, 4, 4, 4, 4]);
    expect(mild.decisions[4]).toBe('uncertain');
    expect(mild.decisions.slice(5).every(d => d === 'uncertain')).toBe(true);
    expect(run([4, 4, 4, 4, 4]).decisions[4]).toBe('consistent');
    expect(mild.state.minScore).toBe(-12.5);
    expect(mild.state.window.length).toBeLessThanOrEqual(12);
  });

  it('(e) sets a per-person threshold from the person\'s own session scores', () => {
    const base = newProfile('alice', 'work', 1, T0);
    expect(personThreshold({ ...base, selfScores: [1, 2, 3] }, T0).lower).toBe(DEFAULT_LOWER_THRESHOLD);
    const rng = mulberry32(3);
    const selfScores = Array.from({ length: 64 }, () => Math.round((rng() * 40 - 25) * 1000) / 1000);
    const at = T0 + 8 * WEEK_MS;
    const profile = { ...base, selfScores, sessions: 80 };
    const sessionsPerWeek = Math.max(1, 80 / 8);
    const p = Math.min(0.1, Math.max(0.002, 0.5 / sessionsPerWeek));
    const sorted = [...selfScores].sort((a, b) => a - b);
    const expected = Math.min(-4, Math.max(-40, sorted[Math.floor(p * 63)] - 1));
    expect(quantile(selfScores, p)).toBe(sorted[Math.floor(p * 63)]);
    expect(personThreshold(profile, at).lower).toBe(expected);
    expect(personThreshold({ ...base, selfScores: fill(30).concat(fill(30)), sessions: 80 }, at).lower).toBe(-4);
    expect(personThreshold({ ...base, selfScores: fill(-90).concat(fill(-90)), sessions: 80 }, at).lower).toBe(-40);
  });

  it('(f) is deterministic for a seed', async () => {
    const options = { weeks: 3, sessionsPerWeek: 10, messagesPerSession: 8, seed: 42, impostorSessionShare: 0.2 };
    const a = await simulateWeeks(new IdentityConfidenceService({ store: new InMemoryStyleProfileStore() }), options);
    const b = await simulateWeeks(new IdentityConfidenceService({ store: new InMemoryStyleProfileStore() }), options);
    expect(a).toEqual(b);
    expect(a.some(outcome => outcome.hints > 0)).toBe(true);
  });

  it('(g) meets the false-prompt budget for the owner after calibration', async () => {
    const outcomes = await simulateWeeks(new IdentityConfidenceService({ store: new InMemoryStyleProfileStore() }),
      { weeks: 12, sessionsPerWeek: 20, messagesPerSession: 8, seed: 42, impostorSessionShare: 0 });
    const perWeek = Array.from({ length: 12 }, (_, week) => outcomes.filter(o =>
      o.week === week && o.worst !== null && o.worst !== 'consistent').length);
    const calibrated = perWeek.slice(3);
    const average = calibrated.reduce((a, b) => a + b, 0) / calibrated.length;
    expect(average).toBeLessThan(1);
    expect(Math.max(...calibrated)).toBeLessThanOrEqual(2);
    expect(outcomes.filter(o => o.week >= 3 && o.hints > 0).length).toBeGreaterThan(100);
  });

  it('(h) detects an impostor session after an owner baseline', async () => {
    let detected = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const rng = mulberry32(seed);
      const service = new IdentityConfidenceService({ store: new InMemoryStyleProfileStore() });
      await service.enroll({ personId: 'owner', space: 'work', kind: 'style_baseline', at: T0, personalizationAllowed: true });
      let at = T0;
      for (let i = 0; i < 60; i++) {
        at = T0 + Math.floor(i / 6) * DAY_MS + (i % 6) * 60_000;
        await service.observeStyle({ personaId: 'p', personId: 'owner', space: 'work', features: ownerFeatures(rng, at), at, personalizationAllowed: true });
      }
      let last: string | undefined;
      const start = at + DAY_MS;
      for (let m = 0; m < 8; m++) {
        const t = start + m * 60_000;
        const result = await service.observeStyle({ personaId: 'p', personId: 'owner', space: 'work', features: impostorFeatures(rng, t), at: t, personalizationAllowed: true });
        last = result.hint?.consistency;
      }
      if (last === 'uncertain' || last === 'inconsistent') detected++;
    }
    expect(detected / 50).toBeGreaterThanOrEqual(0.7);
  });

  it('(i) computes the Gini coefficient', () => {
    expect(gini([1, 1, 1, 1])).toBe(0);
    expect(gini([0, 0, 0, 4])).toBe(0.75);
    expect(gini([])).toBe(0);
    expect(gini([0, 0])).toBe(0);
  });

  it('(j) disables members over budget or with concentrated error, sorted by key', () => {
    expect(evaluateFairness([{ key: 'm1', falsePrompts: 5, weeksObserved: 2 }])).toEqual([{ key: 'm1', reason: 'budget' }]);
    expect(evaluateFairness([{ key: 'm1', falsePrompts: 3, weeksObserved: 1.5 }])).toEqual([]);
    const five = ['e', 'd', 'c', 'b', 'a'].map((key, i) => ({ key, falsePrompts: i === 4 ? 12 : 0, weeksObserved: 4 }));
    const verdicts = evaluateFairness(five);
    expect(verdicts.map(v => v.key)).toEqual(['a']);
    expect(['gini', 'budget']).toContain(verdicts[0].reason);
    const giniOnly = ['e', 'd', 'c', 'b', 'a'].map((key, i) => ({ key, falsePrompts: i === 0 ? 0.8 : 0, weeksObserved: 1 }));
    expect(evaluateFairness(giniOnly)).toEqual([{ key: 'e', reason: 'gini' }]);
    expect(evaluateFairness(['a', 'b', 'c', 'd'].map(key => ({ key, falsePrompts: 0.8, weeksObserved: 1 })))).toEqual([]);
    expect(evaluateFairness(['a', 'b', 'c', 'd', 'e'].map(key => ({ key, falsePrompts: 1, weeksObserved: 4 })))).toEqual([]);
    const both = evaluateFairness([{ key: 'z', falsePrompts: 9, weeksObserved: 3 }, { key: 'b', falsePrompts: 9, weeksObserved: 3 }]);
    expect(both.map(v => v.key)).toEqual(['b', 'z']);
  });

  it('scores owner messages above impostor messages on a trained profile', () => {
    const rng = mulberry32(11);
    let profile = newProfile('owner', 'work', 1, T0);
    for (let i = 0; i < 200; i++) profile = observeProfile(profile, styleVector(ownerFeatures(rng, T0)), T0 + i * 60_000);
    const model = { mean: profile.mean, variance: profile.variance, weight: profile.weight };
    const owner = Array.from({ length: 50 }, () => messageLlr(model, UNKNOWN_MODEL, styleVector(ownerFeatures(rng, T0))));
    const impostor = Array.from({ length: 50 }, () => messageLlr(model, UNKNOWN_MODEL, styleVector(impostorFeatures(rng, T0))));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(owner)).toBeGreaterThan(mean(impostor));
  });
});
