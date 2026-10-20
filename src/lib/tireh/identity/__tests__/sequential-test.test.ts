import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../profile';
import { StyleIdentityService } from '../service';
import { InMemoryStyleProfileStore } from '../store';
import {
  ABSOLUTE_DISABLE_FALSE_PROMPTS, applyPromptOutcome, autoDisable, CUSUM_DRIFT, DEFAULT_THRESHOLD, defaultCalibration,
  FALSE_PROMPT_MUTE_MS, giniCoefficient, hintAllowed, MAX_MESSAGE_LLR, MAX_THRESHOLD, messageLlr, MIN_TEST_MESSAGES,
  RELAX_AFTER_MS, relaxCalibration, SESSION_GAP_MS, sessionExpired, startSequential, stepSequential, THRESHOLD_STEP,
  type MemberErrorStat, type SequentialState,
} from '../test';
import type { StyleProfile } from '../profile';
import type { StyleFeatures } from '../style-features';
import { FIXTURE_KEY, FIXTURE_T0, personA, personB, trainProfile, type TimedFeatures } from './style-fixtures';

const PROFILE_A = trainProfile(personA(1, 200));

/** Scores sessions of `size` messages; returns the decision trace of every session. */
function runSessions(profile: StyleProfile, stream: readonly TimedFeatures[], size: number) {
  const sessions: { decisions: SequentialState['decision'][]; firstUncertainAt?: number; llrs: number[] }[] = [];
  for (let i = 0; i < stream.length; i += size) {
    let state = startSequential(stream[i].at);
    const trace: (typeof sessions)[number] = { decisions: [], llrs: [] };
    stream.slice(i, i + size).forEach((m, j) => {
      const llr = messageLlr(profile, m.features);
      state = stepSequential(state, llr, profile.calibration.threshold, m.at);
      trace.llrs.push(llr);
      trace.decisions.push(state.decision);
      if (state.decision === 'uncertain' && trace.firstUncertainAt === undefined) trace.firstUncertainAt = j + 1;
    });
    sessions.push(trace);
  }
  return sessions;
}

function scenario() {
  return {
    impostor: runSessions(PROFILE_A, personB(2, 200), 10),
    heldOut: runSessions(PROFILE_A, personA(3, 500), 10),
  };
}

describe('sequential test', () => {
  it('never decides on one message', () => {
    let state = startSequential(0);
    for (let i = 1; i < MIN_TEST_MESSAGES; i++) {
      state = stepSequential(state, 1e9, DEFAULT_THRESHOLD, i);
      expect(state.decision).toBe('consistent');
    }
    expect(state.s).toBeCloseTo((MIN_TEST_MESSAGES - 1) * (MAX_MESSAGE_LLR - CUSUM_DRIFT), 9);
    for (const m of personB(4, 50)) {
      const llr = messageLlr(PROFILE_A, m.features);
      expect(Math.abs(llr)).toBeLessThanOrEqual(MAX_MESSAGE_LLR);
    }
  });

  it('flags every impostor session within 5 to 10 messages', () => {
    const { impostor } = scenario();
    expect(impostor).toHaveLength(20);
    for (const session of impostor) {
      expect(session.firstUncertainAt).toBeDefined();
      expect(session.firstUncertainAt!).toBeGreaterThanOrEqual(MIN_TEST_MESSAGES);
      expect(session.firstUncertainAt!).toBeLessThanOrEqual(10);
    }
  });

  it('never flags the person on 500 held-out messages', () => {
    const { heldOut } = scenario();
    expect(heldOut).toHaveLength(50);
    expect(heldOut.flatMap(s => s.decisions).filter(d => d === 'uncertain')).toHaveLength(0);
  });

  it('gives no evidence from an unscorable profile', () => {
    const young = trainProfile(personA(1, 49));
    const sessions = runSessions(young, personB(2, 100), 10);
    for (const s of sessions) {
      expect(s.llrs.every(l => l === 0)).toBe(true);
      expect(s.decisions.every(d => d === 'consistent')).toBe(true);
    }
  });

  it('keeps uncertain sticky within a session and resets after the gap', () => {
    let state = startSequential(0);
    for (let i = 1; i <= 6; i++) state = stepSequential(state, MAX_MESSAGE_LLR, DEFAULT_THRESHOLD, i * 1000);
    expect(state.decision).toBe('uncertain');
    for (let i = 7; i <= 30; i++) state = stepSequential(state, -MAX_MESSAGE_LLR, DEFAULT_THRESHOLD, i * 1000);
    expect(state.decision).toBe('uncertain');
    expect(state.s).toBe(0);
    expect(sessionExpired(state, state.lastAt + SESSION_GAP_MS - 1)).toBe(false);
    expect(sessionExpired(state, state.lastAt + SESSION_GAP_MS)).toBe(true);
    expect(startSequential(state.lastAt + SESSION_GAP_MS).decision).toBe('consistent');
  });

  it('never returns inconsistent and ignores non-finite evidence', () => {
    let state = startSequential(0);
    for (let i = 0; i < 20; i++) {
      state = stepSequential(state, i % 2 ? Number.NaN : Number.POSITIVE_INFINITY, DEFAULT_THRESHOLD, i);
      expect(['consistent', 'uncertain']).toContain(state.decision);
    }
  });

  it('is deterministic', () => {
    expect(scenario()).toEqual(scenario());
    expect(trainProfile(personA(1, 200))).toEqual(PROFILE_A);
  });
});

describe('false-prompt budget', () => {
  it('allows at most one false prompt per 7 days and disables after 3 in 28 days', async () => {
    const store = new InMemoryStyleProfileStore();
    const service = new StyleIdentityService({ store });
    const key = FIXTURE_KEY;
    const observe = (features: StyleFeatures, at: number) =>
      service.observeStyle({ ...key, features, at, personalizationAllowed: true });

    const training = personA(1, 200);
    for (const m of training) await observe(m.features, m.at);
    const start = training[training.length - 1].at + DAY_MS;

    const prompts: number[] = [];
    const thresholds: number[] = [];
    for (let day = 0; day < 56; day++) {
      const morning = start + day * DAY_MS;
      for (const [j, m] of personA(100 + day, 8).entries()) {
        const result = await observe(m.features, morning + j * 60_000);
        expect(result.hint?.consistency ?? 'consistent').toBe('consistent');
      }
      // A noisy session: the member writes very unlike themselves (here: Finglish, mornings).
      const noisyAt = morning + 2 * 3600_000;
      let prompted = false;
      for (const [j, m] of personB(500 + day, 8).entries()) {
        const at = noisyAt + j * 60_000;
        const result = await observe(m.features, at);
        if (result.hint?.consistency === 'uncertain' && !prompted) {
          prompted = true;
          prompts.push(at);
          expect(result.hint.messages).toBeGreaterThanOrEqual(MIN_TEST_MESSAGES);
          await service.recordPromptOutcome({ ...key, outcome: 'confirmed_self', at, personalizationAllowed: true });
          thresholds.push((await store.get(key))!.calibration.threshold);
        }
      }
    }

    expect(prompts.length).toBe(ABSOLUTE_DISABLE_FALSE_PROMPTS);
    for (let i = 1; i < prompts.length; i++) expect(prompts[i] - prompts[i - 1]).toBeGreaterThanOrEqual(FALSE_PROMPT_MUTE_MS);
    for (const t of prompts) expect(prompts.filter(p => p >= t && p < t + 7 * DAY_MS)).toHaveLength(1);
    expect(thresholds).toEqual([1, 2, 3].map(k => Math.min(MAX_THRESHOLD, DEFAULT_THRESHOLD + k * THRESHOLD_STEP)));
    const final = (await store.get(key))!;
    expect(final.calibration.disabled).toBe(true);
    expect(prompts[2] - prompts[0]).toBeLessThan(28 * DAY_MS);
    expect(hintAllowed(final, final.lastAt + 365 * DAY_MS)).toBe(false);
  });

  it('applies prompt outcomes', () => {
    const cal = defaultCalibration(0);
    const once = applyPromptOutcome(cal, 'confirmed_self', 10 * DAY_MS);
    expect(once).toMatchObject({ falsePrompts: 1, threshold: DEFAULT_THRESHOLD + THRESHOLD_STEP, mutedUntil: 17 * DAY_MS, disabled: false, falsePromptAt: [10 * DAY_MS] });
    expect(applyPromptOutcome(cal, 'someone_else', 5)).toEqual({ ...cal, truePrompts: 1 });
    let capped = cal;
    for (let i = 0; i < 20; i++) capped = applyPromptOutcome(capped, 'confirmed_self', i * 40 * DAY_MS);
    expect(capped.threshold).toBe(MAX_THRESHOLD);
    expect(capped.disabled).toBe(false);
    expect(capped.falsePromptAt.length).toBeLessThanOrEqual(8);
    let burst = cal;
    for (const d of [0, 10, 20]) burst = applyPromptOutcome(burst, 'confirmed_self', d * DAY_MS);
    expect(burst.disabled).toBe(true);
  });

  it('relaxes only after 28 quiet days and never below the default', () => {
    const raised = applyPromptOutcome(applyPromptOutcome(defaultCalibration(0), 'confirmed_self', DAY_MS), 'confirmed_self', 40 * DAY_MS);
    expect(raised.threshold).toBe(DEFAULT_THRESHOLD + 2 * THRESHOLD_STEP);
    expect(relaxCalibration(raised, 40 * DAY_MS + RELAX_AFTER_MS - 1)).toBe(raised);
    const relaxed = relaxCalibration(raised, 40 * DAY_MS + RELAX_AFTER_MS);
    expect(relaxed.threshold).toBe(raised.threshold - 0.5);
    expect(relaxCalibration(relaxed, 40 * DAY_MS + RELAX_AFTER_MS + DAY_MS)).toBe(relaxed);
    let cal = relaxed;
    for (let k = 2; k < 20; k++) cal = relaxCalibration(cal, 40 * DAY_MS + k * RELAX_AFTER_MS);
    expect(cal.threshold).toBe(DEFAULT_THRESHOLD);
    expect(relaxCalibration(defaultCalibration(0), 1000 * DAY_MS).threshold).toBe(DEFAULT_THRESHOLD);
  });
});

describe('Gini auto-disable', () => {
  it('computes the Gini coefficient', () => {
    expect(giniCoefficient([])).toBe(0);
    expect(giniCoefficient([2, 2, 2, 2])).toBe(0);
    expect(giniCoefficient([0, 0, 0, 1])).toBe(0.75);
    expect(giniCoefficient([0, 0])).toBe(0);
    expect(() => giniCoefficient([1, -1])).toThrow(RangeError);
    expect(() => giniCoefficient([1, Number.NaN])).toThrow(RangeError);
  });

  const member = (personId: string, sessions: number, falsePrompts: number, recentFalsePrompts = 0): MemberErrorStat =>
    ({ personId, sessions, falsePrompts, recentFalsePrompts });

  it('disables exactly the outlier among enough eligible members', () => {
    const stats = [member('m-out', 20, 10), ...['m1', 'm2', 'm3', 'm4', 'm5'].map(id => member(id, 50, 1))];
    const result = autoDisable(stats);
    expect(result.gini).toBeGreaterThanOrEqual(0.4);
    expect(result.disable).toEqual(['m-out']);
    expect(Object.keys(result).sort()).toEqual(['disable', 'gini']);
  });

  it('disables nobody on a small or young population unless 3 recent false prompts', () => {
    const four = [member('m-out', 20, 10), ...['m1', 'm2', 'm3'].map(id => member(id, 50, 1))];
    expect(autoDisable(four).disable).toEqual([]);
    const young = [member('m-out', 9, 9), ...['m1', 'm2', 'm3', 'm4', 'm5'].map(id => member(id, 9, 0))];
    expect(autoDisable(young).disable).toEqual([]);
    const absolute = [...four, member('z-burst', 2, 3, 3), member('a-burst', 1, 3, 3)];
    expect(autoDisable(absolute).disable).toEqual(['a-burst', 'z-burst']);
  });
});
