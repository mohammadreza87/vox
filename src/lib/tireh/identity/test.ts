/**
 * SEQUENTIAL-TEST MODULE, NOT A TEST FILE. The name was fixed by the S10L
 * contract; vitest collects only *.test.ts and tsconfig type-checks this file.
 *
 * A CUSUM-style sequential test of "same author as the person's own rolling
 * profile" against an explicit unknown class (docs/AGENT_INTELLIGENCE_SOLUTION.md
 * 4.9 phase 1), plus per-person calibration with a false-prompt budget and a
 * Gini-of-per-user-error auto-disable. Pure functions only.
 *
 * The test never decides on one message, never returns 'inconsistent' and
 * never confirms identity: its only output is consistent -> uncertain.
 */
import {
  BERNOULLI_KEYS, CATEGORICAL_SIZES, DAY_MS, GAUSSIAN_KEYS, bernoulliP, categoricalP, gaussianParams, isScorable,
  type BernoulliKey, type CategoricalKey, type GaussianKey, type StyleCalibration, type StyleProfile,
} from './profile';
import type { StyleFeatures } from './style-features';

export const MIN_TEST_MESSAGES = 5;
export const SESSION_GAP_MS = 30 * 60_000;
export const MAX_MESSAGE_LLR = 1.5;
export const CUSUM_DRIFT = 0.25;
export const DEFAULT_THRESHOLD = 5;
export const MAX_THRESHOLD = 12;
export const THRESHOLD_STEP = 1.5;
export const RELAX_STEP = 0.5;
export const RELAX_AFTER_MS = 28 * DAY_MS;
export const FALSE_PROMPT_MUTE_MS = 7 * DAY_MS;
export const ABSOLUTE_WINDOW_MS = 28 * DAY_MS;
export const ABSOLUTE_DISABLE_FALSE_PROMPTS = 3;
export const GINI_DISABLE_THRESHOLD = 0.4;
export const GINI_MIN_MEMBERS = 5;
export const GINI_MIN_SESSIONS = 10;
export const OUTLIER_FACTOR = 2;
export const MIN_OUTLIER_ERROR = 0.05;
/** A dimension the person has (almost) never produced carries no evidence either way. */
const MIN_DIMENSION_WEIGHT = 1;
const MAX_FALSE_PROMPT_HISTORY = 8;

export interface UnknownClass {
  readonly bernoulli: Readonly<Record<BernoulliKey, number>>;
  readonly categorical: Readonly<Record<CategoricalKey, readonly number[]>>;
  readonly gaussian: Readonly<Record<GaussianKey, { mean: number; variance: number }>>;
}

const uniform = (n: number): readonly number[] => Object.freeze(new Array<number>(n).fill(1 / n));

/**
 * Explicit background ("someone else") class. UNINFORMED: Bernoulli 0.5,
 * uniform categoricals, Gaussian mean 0.5 / variance 0.09 for every ratio.
 * Replace only with a class benchmarked on consenting members; never tune it
 * to fixtures.
 */
export const UNKNOWN_CLASS_V1: UnknownClass = Object.freeze({
  bernoulli: Object.freeze(Object.fromEntries(BERNOULLI_KEYS.map(k => [k, 0.5])) as Record<BernoulliKey, number>),
  categorical: Object.freeze({
    hourBucket: uniform(CATEGORICAL_SIZES.hourBucket),
    lengthBucket: uniform(CATEGORICAL_SIZES.lengthBucket),
    digitScript: uniform(CATEGORICAL_SIZES.digitScript),
    voiceDurationBucket: uniform(CATEGORICAL_SIZES.voiceDurationBucket),
  }),
  gaussian: Object.freeze(Object.fromEntries(GAUSSIAN_KEYS.map(k => [k, Object.freeze({ mean: 0.5, variance: 0.09 })])) as Record<GaussianKey, { mean: number; variance: number }>),
});

function logNormal(x: number, mean: number, variance: number): number {
  return -0.5 * Math.log(2 * Math.PI * variance) - ((x - mean) ** 2) / (2 * variance);
}

function safeLog(p: number): number {
  return Math.log(Math.min(1, Math.max(1e-6, Number.isFinite(p) ? p : 1e-6)));
}

/**
 * Log-likelihood ratio log p_unknown(x) - log p_person(x) summed over the
 * dimensions present in this message, clamped to +-MAX_MESSAGE_LLR so that a
 * single message can never decide. 0 while the profile is not scorable.
 */
export function messageLlr(profile: StyleProfile, features: StyleFeatures, unknown: UnknownClass = UNKNOWN_CLASS_V1): number {
  if (!isScorable(profile)) return 0;
  let llr = 0;
  const bernoulli = (key: BernoulliKey, x: boolean) => {
    const stat = profile.bernoulli[key];
    if (stat.w < MIN_DIMENSION_WEIGHT) return;
    const pp = bernoulliP(stat);
    const pu = unknown.bernoulli[key];
    llr += safeLog(x ? pu : 1 - pu) - safeLog(x ? pp : 1 - pp);
  };
  const categorical = (key: CategoricalKey, index: number) => {
    const stat = profile.categorical[key];
    if (stat.w < MIN_DIMENSION_WEIGHT) return;
    llr += safeLog(unknown.categorical[key][index] ?? 0) - safeLog(categoricalP(stat, index));
  };
  bernoulli('voice', features.modality === 'voice');
  bernoulli('followOn', features.followOn);
  bernoulli('edited', features.edited);
  categorical('hourBucket', features.hourBucket);
  if (features.modality === 'text' && features.text) {
    const text = features.text;
    bernoulli('terminalPunctuation', text.terminalPunctuation);
    categorical('lengthBucket', text.lengthBucket);
    categorical('digitScript', text.digitScript);
    for (const key of GAUSSIAN_KEYS) {
      const stat = profile.gaussian[key];
      if (stat.w < MIN_DIMENSION_WEIGHT) continue;
      const person = gaussianParams(stat);
      const background = unknown.gaussian[key];
      llr += logNormal(text[key], background.mean, background.variance) - logNormal(text[key], person.mean, person.variance);
    }
  } else if (features.modality === 'voice' && features.voiceDurationBucket !== undefined) {
    categorical('voiceDurationBucket', features.voiceDurationBucket);
  }
  if (!Number.isFinite(llr)) return llr > 0 ? MAX_MESSAGE_LLR : llr < 0 ? -MAX_MESSAGE_LLR : 0;
  return Math.min(MAX_MESSAGE_LLR, Math.max(-MAX_MESSAGE_LLR, llr));
}

export interface SequentialState {
  readonly n: number;
  readonly s: number;
  readonly decision: 'consistent' | 'uncertain';
  readonly startedAt: number;
  readonly lastAt: number;
}

export function startSequential(at: number): SequentialState {
  return { n: 0, s: 0, decision: 'consistent', startedAt: at, lastAt: at };
}

/** One CUSUM step. 'uncertain' is sticky for the session; never before MIN_TEST_MESSAGES; never 'inconsistent'. */
export function stepSequential(state: SequentialState, llr: number, threshold: number, at: number): SequentialState {
  const n = state.n + 1;
  const evidence = Number.isFinite(llr) ? Math.min(MAX_MESSAGE_LLR, Math.max(-MAX_MESSAGE_LLR, llr)) : 0;
  const s = Math.max(0, state.s + evidence - CUSUM_DRIFT);
  const limit = Number.isFinite(threshold) ? threshold : MAX_THRESHOLD;
  const decision = state.decision === 'uncertain' || (n >= MIN_TEST_MESSAGES && s >= limit) ? 'uncertain' : 'consistent';
  return { n, s, decision, startedAt: state.startedAt, lastAt: Math.max(state.lastAt, at) };
}

export function sessionExpired(state: SequentialState, at: number): boolean {
  return at - state.lastAt >= SESSION_GAP_MS;
}

export type PromptOutcome = 'confirmed_self' | 'someone_else';

export function defaultCalibration(at: number): StyleCalibration {
  return { threshold: DEFAULT_THRESHOLD, sessions: 0, falsePrompts: 0, truePrompts: 0, falsePromptAt: [], lastRelaxAt: at, mutedUntil: 0, disabled: false };
}

/**
 * 'confirmed_self' is a FALSE prompt: raise this person's threshold, mute
 * hints for 7 days (so at most one false prompt per member per week) and
 * disable after 3 false prompts within 28 days. 'someone_else' only counts.
 */
export function applyPromptOutcome(cal: StyleCalibration, outcome: PromptOutcome, at: number): StyleCalibration {
  if (outcome === 'someone_else') return { ...cal, truePrompts: cal.truePrompts + 1 };
  const falsePromptAt = [...cal.falsePromptAt, at]
    .filter(t => at - t < ABSOLUTE_WINDOW_MS)
    .slice(-MAX_FALSE_PROMPT_HISTORY);
  const recent = falsePromptAt.filter(t => at - t < ABSOLUTE_WINDOW_MS).length;
  return {
    ...cal,
    falsePrompts: cal.falsePrompts + 1,
    falsePromptAt,
    threshold: Math.min(MAX_THRESHOLD, cal.threshold + THRESHOLD_STEP),
    mutedUntil: Math.max(cal.mutedUntil, at + FALSE_PROMPT_MUTE_MS),
    disabled: cal.disabled || recent >= ABSOLUTE_DISABLE_FALSE_PROMPTS,
  };
}

/** After 28 quiet days, lower the threshold by RELAX_STEP, never below DEFAULT_THRESHOLD. Returns `cal` itself when unchanged. */
export function relaxCalibration(cal: StyleCalibration, at: number): StyleCalibration {
  const lastFalse = cal.falsePromptAt.length ? Math.max(...cal.falsePromptAt) : -Infinity;
  const since = Math.max(lastFalse, cal.lastRelaxAt);
  if (at - since < RELAX_AFTER_MS || cal.threshold <= DEFAULT_THRESHOLD) return cal;
  return { ...cal, threshold: Math.max(DEFAULT_THRESHOLD, cal.threshold - RELAX_STEP), lastRelaxAt: at };
}

export function hintAllowed(profile: StyleProfile, at: number): boolean {
  return isScorable(profile) && !profile.calibration.disabled && at >= profile.calibration.mutedUntil;
}

/** Mean absolute difference over all pairs / (2 * mean). 0 for empty input or a zero mean. */
export function giniCoefficient(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  for (const v of values) if (!Number.isFinite(v) || v < 0) throw new RangeError('gini_invalid_value');
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  let sum = 0;
  for (const a of values) for (const b of values) sum += Math.abs(a - b);
  return sum / (2 * n * n * mean);
}

export interface MemberErrorStat {
  readonly personId: string;
  readonly sessions: number;
  readonly falsePrompts: number;
  readonly recentFalsePrompts: number;
}

/**
 * Disables the members for whom the signal is systematically wrong: outliers in
 * per-user error when the error is unevenly spread (Gini), and anyone with 3
 * recent false prompts regardless of population size.
 */
export function autoDisable(stats: readonly MemberErrorStat[]): { gini: number; disable: string[] } {
  const valid = stats.filter(s => typeof s.personId === 'string' && s.personId.length > 0 &&
    Number.isFinite(s.sessions) && s.sessions >= 0 && Number.isFinite(s.falsePrompts) && s.falsePrompts >= 0);
  const eligible = valid.filter(s => s.sessions >= GINI_MIN_SESSIONS);
  const errors = eligible.map(s => Math.min(1, s.falsePrompts / s.sessions));
  const gini = giniCoefficient(errors);
  const disable = new Set<string>();
  if (eligible.length >= GINI_MIN_MEMBERS && gini >= GINI_DISABLE_THRESHOLD) {
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    eligible.forEach((s, i) => {
      if (errors[i] >= OUTLIER_FACTOR * mean && errors[i] >= MIN_OUTLIER_ERROR) disable.add(s.personId);
    });
  }
  for (const s of valid) if (Number.isFinite(s.recentFalsePrompts) && s.recentFalsePrompts >= ABSOLUTE_DISABLE_FALSE_PROMPTS) disable.add(s.personId);
  return { gini, disable: [...disable].sort() };
}
